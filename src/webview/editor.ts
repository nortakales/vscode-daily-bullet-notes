// Assembles the CodeMirror editor for the rendered view: extensions, keymap and the actions behind
// widgets (fold toggles, the status picker, standup view).

import { Compartment, EditorSelection, EditorState, Extension, Prec, TransactionSpec } from '@codemirror/state';
import { drawSelection, dropCursor, EditorView, KeyBinding, keymap, ViewUpdate } from '@codemirror/view';
import { defaultKeymap } from '@codemirror/commands';
import { openSearchPanel, search, searchKeymap } from '@codemirror/search';
import type { HostCommand, RevealTarget, ViewConfig } from '../rendered/protocol';
import {
    arrowLeftCommand, backspaceCommand, deleteForwardCommand, enterCommand, indentCommand, moveLinesCommand, setStatusCommand, textStartOf
} from './commands';
import { blockField, dbmActions, DbmActions, findStatusIcon, IS_MAC, isLockedTask, linePlugin, linkAtEvent, linkPlugin } from './decorations';
import { StatusPicker } from './picker';
import { caretLayer } from './caret';
import { logBar } from './logbar';
import { pinnedHeaders } from './pinned';
import {
    activeTab, clampCursor, configField, dbmStateExtensions, foldEffect, foldField, listsStartLine, Region, regionAt, sectionsOnTab, setFoldsEffect,
    setTabEffect, structureField, tabField, TabId, tabOfLine, tabSizeOf, tabVisibleRange
} from './state';
import { analyzeLine, sectionsContaining, sectionsOf, standupDays, standupFoldKeys, STATUS_INFO, statusKind } from './structure';

export const tabSizeCompartment = new Compartment();

function run(command: (state: EditorState) => TransactionSpec | undefined) {
    return (view: EditorView) => {
        const spec = command(view.state);
        if (!spec) {
            return false;
        }
        view.dispatch(spec);
        return true;
    };
}

function always(command: (state: EditorState) => TransactionSpec) {
    return (view: EditorView) => {
        view.dispatch(command(view.state));
        return true;
    };
}

/** Home goes to the start of the line's text (after the hidden indentation and box) */
function home(view: EditorView, extend: boolean): boolean {
    const selection = view.state.selection;
    if (selection.ranges.length !== 1) {
        return false;
    }
    const range = selection.main;
    const line = view.state.doc.lineAt(range.head);
    if (regionAt(view.state, range.head)) {
        // Headers have nowhere else to go
        return true;
    }
    const textStart = textStartOf(view.state, line);
    if (textStart === line.from) {
        return false;
    }
    let target = view.moveToLineBoundary(range, false).head;
    if (target < textStart) {
        target = textStart;
    }
    view.dispatch({
        selection: extend ? EditorSelection.range(range.anchor, target) : EditorSelection.cursor(target),
        scrollIntoView: true,
        userEvent: 'select',
    });
    return true;
}

/** Folds the innermost section around the cursor */
function foldAtCursor(view: EditorView): boolean {
    const state = view.state;
    const line = state.doc.lineAt(state.selection.main.head).number - 1;
    const sections = sectionsContaining(state.field(structureField), line).filter(section => !state.field(foldField).has(section.key));
    const innermost = sections[sections.length - 1];
    if (innermost) {
        toggleFold(view, innermost.key);
    }
    return true;
}

/** Unfolds a folded section next to the cursor */
function unfoldAtCursor(view: EditorView): boolean {
    const state = view.state;
    const head = state.selection.main.head;
    for (const pos of [head, head - 1, head + 1]) {
        if (pos < 0 || pos > state.doc.length) {
            continue;
        }
        const region = regionAt(state, pos);
        if (region && region.kind === 'folded') {
            view.dispatch({ effects: foldEffect.of({ keys: [region.key], folded: false }) });
            return true;
        }
    }
    return true;
}

export function toggleFold(view: EditorView, key: string) {
    const folded = view.state.field(foldField).has(key);
    view.dispatch({ effects: foldEffect.of({ keys: [key], folded: !folded }) });
    moveCursorOutOfFolds(view);
}

/**
 * If folding hid the cursor, move it to the start of the text of the nearest visible line of text. Not next to a
 * header, where the caret would be drawn as tall as the header. With no such line, the editor gives up focus.
 */
function moveCursorOutOfFolds(view: EditorView) {
    const state = view.state;
    const region = regionAt(state, state.selection.main.head);
    if (!region || region.kind !== 'folded') {
        return;
    }
    const target = nearestTextPosition(state, region);
    if (target === undefined) {
        view.contentDOM.blur();
        return;
    }
    view.dispatch({ selection: EditorSelection.cursor(target), userEvent: 'select' });
}

function nearestTextPosition(state: EditorState, region: Region): number | undefined {
    const doc = state.doc;
    const tabSize = tabSizeOf(state);
    const textStart = (lineNumber: number) => {
        const line = doc.line(lineNumber);
        if (regionAt(state, line.from) || regionAt(state, line.to)) {
            return undefined;
        }
        return line.from + analyzeLine(line.text, tabSize).textStart;
    };
    for (let lineNumber = doc.lineAt(region.to).number + 1; lineNumber <= doc.lines; lineNumber++) {
        const position = textStart(lineNumber);
        if (position !== undefined) {
            return position;
        }
    }
    for (let lineNumber = doc.lineAt(region.from).number - 1; lineNumber >= 1; lineNumber--) {
        const position = textStart(lineNumber);
        if (position !== undefined) {
            return position;
        }
    }
    return undefined;
}

/** The first line in view (as a position), to come back to it */
function topPosition(view: EditorView): number {
    const top = view.scrollDOM.getBoundingClientRect().top - view.documentTop;
    return view.lineBlockAtHeight(Math.max(0, top)).from;
}

/** Where each tab was scrolled to when it was last left (a position at the top of the view) */
const tabScroll = new WeakMap<EditorView, Partial<Record<TabId, number>>>();

/**
 * Shows a tab. With `restore` (clicking a tab), the cursor and scroll position go back to where they were on
 * that tab; otherwise the caller places them (reveals, search).
 */
export function switchTab(view: EditorView, tab: TabId, restore = true) {
    const current = activeTab(view.state);
    if (!current || current === tab) {
        return;
    }
    const scroll = tabScroll.get(view) ?? {};
    scroll[current] = topPosition(view);
    tabScroll.set(view, scroll);
    view.dispatch({ effects: setTabEffect.of(tab) });
    if (!restore) {
        return;
    }
    const state = view.state;
    const visible = tabVisibleRange(state);
    const clip = (pos: number) => Math.min(Math.max(pos, visible.from), visible.to);
    const remembered = state.field(tabField).cursors[tab];
    const pos = remembered !== undefined ? clip(remembered) : visible.from;
    const top = scroll[tab] !== undefined ? clip(scroll[tab]!) : visible.from;
    const cursor = clampCursor(state, pos, pos - 1);
    view.dispatch({
        selection: EditorSelection.cursor(cursor),
        effects: EditorView.scrollIntoView(top, { y: 'start', yMargin: 0 }),
        userEvent: 'select',
    });
    // Nowhere to type when everything on the tab is folded (or there are no lists)
    const region = regionAt(view.state, cursor);
    if ((region && region.kind !== 'day') || visible.from === visible.to) {
        view.contentDOM.blur();
    } else {
        view.focus();
    }
}

/** Shows the tab a 0-based line is on */
function showTabOf(view: EditorView, line: number) {
    if (activeTab(view.state)) {
        switchTab(view, tabOfLine(view.state, line), false);
    }
}

/** Folds everything except the two most recent days, and scrolls to them */
export function applyStandupView(view: EditorView) {
    showTabOf(view, 0);
    const structure = view.state.field(structureField);
    let keys = standupFoldKeys(structure);
    if (activeTab(view.state)) {
        // The lists are on their own tab, out of the way: they keep their folds
        const state = view.state;
        const listKeys = new Set(sectionsOf(structure).filter(section => tabOfLine(state, section.line) === 'lists').map(section => section.key));
        keys = [...keys.filter(key => !listKeys.has(key)), ...[...state.field(foldField)].filter(key => listKeys.has(key))];
    }
    view.dispatch({ effects: setFoldsEffect.of(keys) });
    const days = standupDays(structure);
    if (days.length === 0) {
        return;
    }
    const doc = view.state.doc;
    const first = days[0], last = days[days.length - 1];
    let line = last.end;
    while (line > last.line && doc.line(line + 1).text.trim() === '') {
        line--;
    }
    const cursor = clampCursor(view.state, doc.line(line + 1).to, doc.line(line + 1).to - 1);
    const from = doc.line(first.line + 1).from;
    const to = doc.line(last.end + 1).to;
    const height = view.lineBlockAt(to).bottom - view.lineBlockAt(from).top;
    const fits = height < view.scrollDOM.clientHeight * 0.8;
    view.dispatch({
        selection: EditorSelection.cursor(cursor),
        effects: EditorView.scrollIntoView(fits ? EditorSelection.range(from, to) : from, fits ? { y: 'center' } : { y: 'start', yMargin: 48 }),
    });
}

/** Unfolds everything (on the active tab, with tabs) */
export function expandAll(view: EditorView) {
    const keys = new Set(sectionsOnTab(view.state).map(section => section.key));
    view.dispatch({ effects: setFoldsEffect.of([...view.state.field(foldField)].filter(key => !keys.has(key))) });
}

/** Folds every section at every level (years, months, days and lists; on the active tab), like VS Code's Fold All */
export function collapseAll(view: EditorView) {
    const keys = new Set(view.state.field(foldField));
    sectionsOnTab(view.state).forEach(section => keys.add(section.key));
    view.dispatch({ effects: setFoldsEffect.of([...keys]) });
    moveCursorOutOfFolds(view);
}

/** Unfolds the sections around a line, puts the cursor on it and scrolls it to the middle */
export function reveal(view: EditorView, target: RevealTarget) {
    const doc = view.state.doc;
    const lineNumber = Math.min(Math.max(target.line + 1, 1), doc.lines);
    showTabOf(view, lineNumber - 1);
    const folds = view.state.field(foldField);
    const keys = sectionsContaining(view.state.field(structureField), lineNumber - 1).map(section => section.key).filter(key => folds.has(key));
    if (keys.length > 0) {
        view.dispatch({ effects: foldEffect.of({ keys, folded: false }) });
    }
    const line = view.state.doc.line(lineNumber);
    let pos = target.atEnd ? line.to : textStartOf(view.state, line);
    pos = clampCursor(view.state, pos, pos - 1);
    view.dispatch({ selection: EditorSelection.cursor(pos), effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
    view.focus();
}

export interface EditorOptions {
    config: ViewConfig;
    picker: StatusPicker;
    announce(message: string): void;
    onUpdate(update: ViewUpdate): void;
    /** Ctrl/Cmd+Click on a link */
    openLink(href: string): void;
    /** Runs an extension command */
    runCommand(command: HostCommand): void;
}

export function openPicker(view: EditorView, lineNumber: number, anchor: DOMRect, options: EditorOptions) {
    const line = view.state.doc.line(lineNumber);
    const info = analyzeLine(line.text, view.state.tabSize);
    if (info.kind !== 'task') {
        return;
    }
    options.picker.open({
        anchor,
        current: statusKind(info.status),
        taskName: line.text.slice(info.textStart).trim() || 'task',
        onPick: status => {
            const spec = setStatusCommand(view.state, lineNumber, status);
            if (spec) {
                view.dispatch(spec);
            }
            options.announce(`Status: ${STATUS_INFO[status].label}`);
            view.focus();
        },
        onCancel: () => view.focus(),
    });
}

/** Mod-Enter: the status picker for the task on the cursor line */
function openPickerAtCursor(view: EditorView, options: EditorOptions): boolean {
    const state = view.state;
    const line = state.doc.lineAt(state.selection.main.head);
    if (analyzeLine(line.text, state.tabSize).kind !== 'task' || regionAt(state, line.from)) {
        return true;
    }
    if (isLockedTask(state, line.number)) {
        options.announce('Status is set from sub-tasks');
        return true;
    }
    view.dispatch({ effects: EditorView.scrollIntoView(line.from) });
    const icon = findStatusIcon(view, line.number);
    let anchor = icon?.getBoundingClientRect();
    if (!anchor) {
        const coords = view.coordsAtPos(textStartOf(state, line));
        anchor = coords ? new DOMRect(coords.left - 26, coords.top, 22, coords.bottom - coords.top) : view.contentDOM.getBoundingClientRect();
    }
    openPicker(view, line.number, anchor, options);
    return true;
}

const REPLACED_DEFAULT_KEYS = new Set(['Mod-Enter', 'Alt-ArrowUp', 'Alt-ArrowDown', 'Mod-[', 'Mod-]', 'Mod-Alt-\\']);

export function createExtensions(options: EditorOptions): Extension[] {
    const actions: DbmActions = {
        openPicker: (view, lineNumber, anchor) => openPicker(view, lineNumber, anchor.getBoundingClientRect(), options),
        standupView: applyStandupView,
        expandAll,
        collapseAll,
        toggleFold,
        announce: options.announce,
        openLink: options.openLink,
        runCommand: options.runCommand,
        switchTab,
    };
    const dbmKeymap: KeyBinding[] = [
        { key: 'Enter', run: run(enterCommand) },
        { key: 'Backspace', run: run(backspaceCommand) },
        { key: 'Delete', run: run(deleteForwardCommand) },
        { key: 'Tab', run: always(state => indentCommand(state, 1)), shift: always(state => indentCommand(state, -1)) },
        { key: 'Mod-]', run: always(state => indentCommand(state, 1)) },
        { key: 'Mod-[', run: always(state => indentCommand(state, -1)) },
        { key: 'Mod-Enter', run: view => openPickerAtCursor(view, options) },
        { key: 'ArrowLeft', run: run(arrowLeftCommand) },
        { key: 'Home', run: view => home(view, false), shift: view => home(view, true) },
        { key: 'Alt-ArrowUp', run: always(state => moveLinesCommand(state, -1)) },
        { key: 'Alt-ArrowDown', run: always(state => moveLinesCommand(state, 1)) },
        { key: 'Mod-Shift-[', run: foldAtCursor },
        { key: 'Mod-Shift-]', run: unfoldAtCursor },
        { key: 'Mod-f', run: openSearchPanel },
    ];
    return [
        dbmStateExtensions(options.config),
        tabSizeCompartment.of(EditorState.tabSize.of(options.config.tabSize)),
        blockField,
        linePlugin,
        linkPlugin,
        dbmActions.of(actions),
        // Before search(), so the toolbar sits above the search panel
        logBar,
        pinnedHeaders,
        // Ctrl/Cmd+Click opens a link; a plain click just places the cursor
        EditorView.domEventHandlers({
            mousedown(event, view) {
                if (event.button !== 0 || !(IS_MAC ? event.metaKey : event.ctrlKey)) {
                    return false;
                }
                const href = linkAtEvent(view, event);
                if (!href) {
                    return false;
                }
                event.preventDefault();
                options.openLink(href);
                return true;
            },
        }),
        // A centered column of limited width, or the full width of the panel
        EditorView.editorAttributes.compute([configField], state => ({ class: state.field(configField).centered === false ? 'dbm-full-width' : 'dbm-centered' })),
        // An empty Lists tab has nowhere to type
        EditorView.editable.compute([tabField, structureField, configField], state =>
            !(activeTab(state) === 'lists' && listsStartLine(state.field(structureField)) === undefined)),
        EditorView.lineWrapping,
        // drawSelection draws the selection; caret.ts draws the cursor like VS Code's
        drawSelection(),
        caretLayer,
        dropCursor(),
        search({ top: true, scrollToMatch: range => EditorView.scrollIntoView(range, { y: 'center' }) }),
        EditorView.contentAttributes.of({ 'aria-label': 'Daily Bullet Notes', spellcheck: 'false', autocorrect: 'off', autocapitalize: 'off' }),
        Prec.high(keymap.of(dbmKeymap)),
        keymap.of(searchKeymap),
        keymap.of(defaultKeymap.filter(binding => !binding.key || !REPLACED_DEFAULT_KEYS.has(binding.key))),
        EditorView.updateListener.of(options.onUpdate),
        // With nothing but folded headers (everything collapsed), a click above or beside them leaves the cursor at
        // a header, where there is nothing to type on: give up focus instead of drawing a caret there
        EditorView.updateListener.of(update => {
            if (!(update.selectionSet || update.focusChanged) || !update.view.hasFocus) {
                return;
            }
            const state = update.state;
            const head = state.selection.main;
            const region = head.empty ? regionAt(state, head.head) : undefined;
            if (region && region.kind !== 'day') {
                queueMicrotask(() => update.view.contentDOM.blur());
            }
        }),
    ];
}
