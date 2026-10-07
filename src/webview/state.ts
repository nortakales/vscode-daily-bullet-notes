// Editor state for the rendered view: config, document structure, folds and the transaction filter that
// keeps headers intact, keeps the cursor out of hidden syntax and recomputes parent statuses.
// Only depends on @codemirror/state (no DOM), so it can be unit tested in Node.

import { Annotation, ChangeSet, EditorSelection, EditorState, StateEffect, StateField, Text, Transaction, TransactionSpec } from '@codemirror/state';
import type { ViewConfig } from '../rendered/protocol';
import { computeParentStatusUpdates } from '../taskLogic';
import {
    analyzeLine, BOX_BORDER_REGEX, BoxSection, countListItems, DAY_HEADER_REGEX, DaySection, DocStructure,
    outermostFolded, parseStructure, Section, sectionsContaining, sectionsOf, updateScopesTouching
} from './structure';
import { findLinks, linkForPaste } from './links';

/** Marks transactions that adopt the host's text ('update'): never sent back, never filtered */
export const remoteAnnotation = Annotation.define<boolean>();

// ---------------------------------------------------------------------------------------------
// Config

export const DEFAULT_CONFIG: ViewConfig = {
    automaticStatusUpdates: true,
    tabSize: 4,
    insertSpaces: true,
    today: { year: 1970, month: 1, day: 1 },
    centered: true,
    cursor: { style: 'line', width: 0, blinking: 'blink' },
    pinToolbar: true,
    pinHeaders: true,
    tabs: false,
};

export const setConfigEffect = StateEffect.define<ViewConfig>();

export const configField = StateField.define<ViewConfig>({
    create: () => DEFAULT_CONFIG,
    update(value, tr) {
        for (const effect of tr.effects) {
            if (effect.is(setConfigEffect)) {
                value = effect.value;
            }
        }
        return value;
    },
});

export function tabSizeOf(state: EditorState): number {
    const tabSize = state.field(configField, false)?.tabSize ?? 4;
    return tabSize > 0 ? tabSize : 4;
}

// ---------------------------------------------------------------------------------------------
// Structure, updated incrementally while typing

export const structureField = StateField.define<DocStructure>({
    create: state => parseStructure(state.doc.toJSON()),
    update: (value, tr) => tr.docChanged ? updateStructure(value, tr.startState.doc, tr.newDoc, tr.changes) : value,
});

/** True if any line from `first` to `last` (1-based) can affect headers */
function touchesHeaders(doc: Text, first: number, last: number, skipFirst: boolean): boolean {
    for (let n = first; n <= last; n++) {
        if (n === first && skipFirst && first !== last) {
            continue;
        }
        const text = doc.line(n).text;
        if (BOX_BORDER_REGEX.test(text) || DAY_HEADER_REGEX.test(text)) {
            return true;
        }
        // A box title only matters right under a border
        if (text.charCodeAt(0) === 124 && n > 1 && BOX_BORDER_REGEX.test(doc.line(n - 1).text)) {
            return true;
        }
    }
    return false;
}

/**
 * Updates the structure after a change. Changes that don't touch header lines only shift line numbers
 * (and recount touched lists), anything else reparses the document.
 */
export function updateStructure(structure: DocStructure, oldDoc: Text, newDoc: Text, changes: ChangeSet): DocStructure {
    const ranges: { a: number; b: number; delta: number; newA: number; newB: number }[] = [];
    let reparse = false;
    changes.iterChangedRanges((fromA, toA, fromB, toB) => {
        if (reparse) {
            return;
        }
        const oldA = oldDoc.lineAt(fromA), oldB = oldDoc.lineAt(toA);
        const newA = newDoc.lineAt(fromB), newB = newDoc.lineAt(toB);
        if (touchesHeaders(oldDoc, oldA.number, oldB.number, fromA === oldA.to) ||
            touchesHeaders(newDoc, newA.number, newB.number, fromB === newA.to)) {
            reparse = true;
            return;
        }
        ranges.push({
            a: oldA.number - 1, b: oldB.number - 1,
            delta: (newB.number - newA.number) - (oldB.number - oldA.number),
            newA: newA.number - 1, newB: newB.number - 1,
        });
    });
    if (reparse || ranges.length > 64) {
        return parseStructure(newDoc.toJSON(), structure.revision + 1);
    }

    let boxes = structure.boxes as BoxSection[];
    let days = structure.days as DaySection[];
    // Later changes first, so earlier line numbers are still in old coordinates
    for (let r = ranges.length - 1; r >= 0; r--) {
        const { a, b, delta } = ranges[r];
        if (delta === 0) {
            continue;
        }
        const shift = <T extends { line: number; end: number }>(item: T): T =>
            (item.line > b || item.end >= a) ? { ...item, line: item.line > b ? item.line + delta : item.line, end: item.end >= a ? item.end + delta : item.end } : item;
        boxes = boxes.map(shift);
        days = days.map(shift);
    }

    // Lists show their item count, so recount lists that were edited
    let revision = structure.revision;
    const getLine = (i: number) => newDoc.line(i + 1).text;
    boxes = boxes.map(box => {
        if (box.kind !== 'list' || !ranges.some(r => r.newB >= box.line + 3 && r.newA <= box.end)) {
            return box;
        }
        const itemCount = countListItems(getLine, box.line + 3, Math.min(box.end, newDoc.lines - 1));
        if (itemCount === box.itemCount) {
            return box;
        }
        revision++;
        return { ...box, itemCount };
    });

    if (boxes === structure.boxes && days === structure.days && revision === structure.revision && newDoc.lines === structure.lineCount) {
        return structure;
    }
    return { revision, lineCount: newDoc.lines, boxes, days };
}

// ---------------------------------------------------------------------------------------------
// Folds, keyed by section identity ("day:2026-10-04", "month:2026-10", "year:2026", "list:Title")

export const setFoldsEffect = StateEffect.define<readonly string[]>();
export const foldEffect = StateEffect.define<{ keys: readonly string[]; folded: boolean }>();

export const foldField = StateField.define<ReadonlySet<string>>({
    create: () => new Set<string>(),
    update(value, tr) {
        let next = value;
        for (const effect of tr.effects) {
            if (effect.is(setFoldsEffect)) {
                next = new Set(effect.value);
            } else if (effect.is(foldEffect)) {
                const copy = new Set(next);
                for (const key of effect.value.keys) {
                    if (effect.value.folded) {
                        copy.add(key);
                    } else {
                        copy.delete(key);
                    }
                }
                next = copy;
            }
        }
        // User edits inside folded sections unfold them, so no change is hidden
        if (tr.docChanged && next.size > 0 && !tr.annotation(remoteAnnotation)) {
            const structure = tr.state.field(structureField);
            const keys = new Set<string>();
            tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
                const first = tr.state.doc.lineAt(fromB).number - 1, last = tr.state.doc.lineAt(toB).number - 1;
                for (const section of sectionsContaining(structure, first).concat(first === last ? [] : sectionsContaining(structure, last))) {
                    if (next.has(section.key) && last > section.headerEnd) {
                        keys.add(section.key);
                    }
                }
            });
            if (keys.size > 0) {
                const copy = new Set(next);
                keys.forEach(key => copy.delete(key));
                next = copy;
            }
        }
        // Search results inside folded sections unfold them
        if (tr.selection && next.size > 0 && tr.isUserEvent('select.search')) {
            const line = tr.state.doc.lineAt(tr.selection.main.head).number - 1;
            const keys = sectionsContaining(tr.state.field(structureField), line).map(section => section.key).filter(key => next.has(key));
            if (keys.length > 0) {
                const copy = new Set(next);
                keys.forEach(key => copy.delete(key));
                next = copy;
            }
        }
        return next;
    },
});

// ---------------------------------------------------------------------------------------------
// Tabs (config.tabs): the Daily Log tab shows the document up to the first list, the Lists tab the rest

export type TabId = 'log' | 'lists';

export interface TabState {
    tab: TabId;
    /** Where the cursor was in each tab when it was last left */
    cursors: Partial<Record<TabId, number>>;
}

export const setTabEffect = StateEffect.define<TabId>();

export const tabField = StateField.define<TabState>({
    create: () => ({ tab: 'log', cursors: {} }),
    update(value, tr) {
        let next = value;
        if (tr.docChanged && (value.cursors.log !== undefined || value.cursors.lists !== undefined)) {
            const cursors: Partial<Record<TabId, number>> = {};
            for (const tab of ['log', 'lists'] as const) {
                const pos = value.cursors[tab];
                if (pos !== undefined) {
                    cursors[tab] = tr.changes.mapPos(pos);
                }
            }
            next = { ...next, cursors };
        }
        for (const effect of tr.effects) {
            if (effect.is(setTabEffect) && effect.value !== next.tab) {
                next = { tab: effect.value, cursors: { ...next.cursors, [next.tab]: tr.changes.mapPos(tr.startState.selection.main.head) } };
            }
        }
        return next;
    },
});

/** 0-based line where the Lists tab starts: the first list box after the Daily Log box */
export function listsStartLine(structure: DocStructure): number | undefined {
    const log = structure.boxes.find(box => box.kind === 'dailyLog');
    return log ? structure.boxes.find(box => box.kind === 'list' && box.line > log.line)?.line : undefined;
}

/** The active tab, or undefined when there are no tabs (turned off, or no Daily Log box) */
export function activeTab(state: EditorState): TabId | undefined {
    const config = state.field(configField, false);
    const tabs = state.field(tabField, false);
    if (!config?.tabs || !tabs || !state.field(structureField).boxes.some(box => box.kind === 'dailyLog')) {
        return undefined;
    }
    return tabs.tab;
}

/** The tab a 0-based line is on */
export function tabOfLine(state: EditorState, line: number): TabId {
    const start = listsStartLine(state.field(structureField));
    return start !== undefined && line >= start ? 'lists' : 'log';
}

/** The lines (0-based, inclusive) the active tab hides, if any */
export function tabHiddenLines(state: EditorState): { first: number; last: number } | undefined {
    const tab = activeTab(state);
    if (!tab) {
        return undefined;
    }
    const start = listsStartLine(state.field(structureField));
    const lastLine = state.doc.lines - 1;
    if (tab === 'log') {
        return start === undefined ? undefined : { first: start, last: lastLine };
    }
    return start === undefined ? { first: 0, last: lastLine } : { first: 0, last: start - 1 };
}

/** The part of the document the active tab shows (all of it without tabs; empty at the end when nothing) */
export function tabVisibleRange(state: EditorState): { from: number; to: number } {
    const doc = state.doc;
    const hidden = tabHiddenLines(state);
    if (!hidden) {
        return { from: 0, to: doc.length };
    }
    if (hidden.first > 0) {
        return { from: 0, to: doc.line(hidden.first).to };
    }
    if (hidden.last >= doc.lines - 1) {
        return { from: doc.length, to: doc.length };
    }
    return { from: doc.line(hidden.last + 2).from, to: doc.length };
}

/** Sections (years, months, days, lists) on the active tab, or all of them without tabs */
export function sectionsOnTab(state: EditorState): readonly Section[] {
    const sections = sectionsOf(state.field(structureField));
    const tab = activeTab(state);
    return tab ? sections.filter(section => tabOfLine(state, section.line) === tab) : sections;
}

const foldedCache = new WeakMap<DocStructure, { folds: ReadonlySet<string>; sections: Section[] }>();

/** Outermost folded sections (cached per structure and fold set) */
export function foldedSections(state: EditorState): Section[] {
    const structure = state.field(structureField);
    const folds = state.field(foldField);
    const cached = foldedCache.get(structure);
    if (cached && cached.folds === folds) {
        return cached.sections;
    }
    const sections = outermostFolded(structure, folds);
    foldedCache.set(structure, { folds, sections });
    return sections;
}

// ---------------------------------------------------------------------------------------------
// Protected regions: box headers, day header lines and folded sections

export interface Region {
    from: number;
    to: number;
    /** hidden: the part of the document the active tab doesn't show */
    kind: 'box' | 'day' | 'folded' | 'hidden';
    key: string;
}

/** Regions within a line of the range [from, to] */
export function regionsNear(state: EditorState, from: number, to: number): Region[] {
    const doc = state.doc;
    const structure = state.field(structureField);
    const lastLine = doc.lines - 1;
    const l0 = Math.max(0, doc.lineAt(from).number - 2);
    const l1 = Math.min(lastLine, doc.lineAt(to).number);
    const lineFrom = (line: number) => doc.line(Math.min(line, lastLine) + 1).from;
    const lineTo = (line: number) => doc.line(Math.min(line, lastLine) + 1).to;
    const regions: Region[] = [];

    const hidden = tabHiddenLines(state);
    if (hidden && hidden.first <= l1 && hidden.last >= l0) {
        regions.push({ from: lineFrom(hidden.first), to: lineTo(hidden.last), kind: 'hidden', key: 'tab' });
    }
    for (const section of foldedSections(state)) {
        if (section.line > l1) {
            break;
        }
        if (section.end >= l0) {
            regions.push({ from: lineFrom(section.line), to: lineTo(section.end), kind: 'folded', key: section.key });
        }
    }
    const boxes = structure.boxes;
    for (let i = firstIndex(boxes, box => box.line + 2 >= l0); i < boxes.length && boxes[i].line <= l1; i++) {
        regions.push({ from: lineFrom(boxes[i].line), to: lineTo(boxes[i].line + 2), kind: 'box', key: boxes[i].key });
    }
    const days = structure.days;
    for (let i = firstIndex(days, day => day.line >= l0); i < days.length && days[i].line <= l1; i++) {
        regions.push({ from: lineFrom(days[i].line), to: lineTo(days[i].line), kind: 'day', key: days[i].key });
    }
    return regions;
}

/** Index of the first item matching a predicate that is false then true over the array */
function firstIndex<T>(items: readonly T[], predicate: (item: T) => boolean): number {
    let low = 0, high = items.length;
    while (low < high) {
        const mid = (low + high) >> 1;
        if (predicate(items[mid])) {
            high = mid;
        } else {
            low = mid + 1;
        }
    }
    return low;
}

/** The largest region containing the position (boundaries included) */
export function regionAt(state: EditorState, pos: number): Region | undefined {
    let best: Region | undefined;
    for (const region of regionsNear(state, pos, pos)) {
        if (region.from <= pos && pos <= region.to && (!best || region.to - region.from > best.to - best.from)) {
            best = region;
        }
    }
    return best;
}

/**
 * Where a cursor may rest: never inside a box or folded section, only at the end of a day header
 * line, and never inside the hidden indentation and box of a line. Comparing with `oldHead` gives the
 * direction of travel; when there is nowhere to go that way, the other direction is used.
 */
export function clampCursor(state: EditorState, pos: number, oldHead: number, retry = true): number {
    const doc = state.doc;
    const tabSize = tabSizeOf(state);
    const forward = oldHead <= pos;
    const start = pos;
    for (let iteration = 0; iteration < 64; iteration++) {
        const region = regionAt(state, pos);
        if (region && region.kind === 'day') {
            if (pos === region.to) {
                return pos;
            }
            // Moving left off the start of the header goes to the previous line, anything else to its end
            if (!forward && iteration === 0 && oldHead <= region.to && region.from > 0) {
                pos = region.from - 1;
                continue;
            }
            return region.to;
        }
        if (region) {
            if (forward ? region.to < doc.length : region.from > 0) {
                pos = forward ? region.to + 1 : region.from - 1;
                continue;
            }
            return retry ? clampCursor(state, start, forward ? start + 1 : start - 1, false) : start;
        }
        const line = doc.lineAt(pos);
        const textStart = line.from + analyzeLine(line.text, tabSize).textStart;
        if (pos < textStart) {
            if (!forward && iteration === 0 && oldHead >= textStart && oldHead <= line.to && line.from > 0) {
                pos = line.from - 1;
                continue;
            }
            return textStart;
        }
        return pos;
    }
    return pos;
}

// ---------------------------------------------------------------------------------------------
// Header integrity

interface SimpleChange {
    from: number;
    to: number;
    insert: string;
}

interface FixedChange extends SimpleChange {
    /** The text the user inserted, without the line breaks added to protect a header */
    typed: string;
    prepended: boolean;
    modified: boolean;
}

/**
 * Makes user changes keep headers whole: deletions that partially overlap a header (or folded section)
 * are expanded to cover it, insertions at a header's start or end get their own line, and search
 * replacements skip header lines. Returns undefined when nothing needed fixing.
 */
export function protectHeaders(state: EditorState, changes: ChangeSet, isReplace: boolean): { changes: SimpleChange[]; cursor?: number } | undefined {
    const doc = state.doc;
    const input: SimpleChange[] = [];
    changes.iterChanges((from, to, _fromB, _toB, inserted) => input.push({ from, to, insert: inserted.toString() }));

    // Search and replace may change text inside folded sections (they unfold), only header lines are kept
    const near = (from: number, to: number): Region[] =>
        regionsNear(state, from, to).filter(region => region.kind !== 'hidden' && (!isReplace || region.kind !== 'folded'));
    // Changes stay on the active tab (search and replace covers the whole document, like find)
    const visible = isReplace ? undefined : tabVisibleRange(state);
    let modified = false;
    const output: FixedChange[] = [];
    for (const change of input) {
        let { from, to, insert } = change;
        if (visible && (from < visible.from || to > visible.to)) {
            modified = true;
            if (to < visible.from || from > visible.to) {
                continue;
            }
            from = Math.max(from, visible.from);
            to = Math.min(to, visible.to);
        }
        const overlaps = (region: Region) => (from < region.to && to > region.from) || (from === to && from > region.from && from < region.to);
        if (isReplace && near(from, to).some(overlaps)) {
            modified = true;
            continue;
        }

        // Expand deletions that cut into a header, until stable
        for (let again = from < to; again;) {
            again = false;
            for (const region of near(from, to)) {
                if (from < region.to && to > region.from && (from > region.from || to < region.to)) {
                    from = Math.min(from, region.from);
                    to = Math.max(to, region.to);
                    again = true;
                }
            }
        }
        // Insertions can't land inside a header: move them after it
        for (const region of near(from, to)) {
            if (from === to && from > region.from && from < region.to) {
                from = to = region.to;
            }
        }
        // Text must not end up on the same line as a header
        let prepended = false;
        const regions = near(from, to);
        if (regions.some(region => region.from === to)) {
            const before = doc.sliceString(doc.lineAt(from).from, from) + insert;
            if (before !== '' && !before.endsWith('\n')) {
                insert += '\n';
            }
        }
        if (regions.some(region => region.to === from)) {
            const after = insert + doc.sliceString(to, doc.lineAt(to).to);
            if (after !== '' && !after.startsWith('\n')) {
                insert = '\n' + insert;
                prepended = true;
            }
        }

        const changed = from !== change.from || to !== change.to || insert !== change.insert;
        modified = modified || changed;
        if (doc.sliceString(from, to) === insert) {
            continue;
        }
        output.push({ from, to, insert, typed: change.insert, prepended, modified: changed });
    }
    if (!modified) {
        return undefined;
    }

    // Expanded changes may now overlap: merge them
    output.sort((a, b) => a.from - b.from);
    const merged: FixedChange[] = [];
    for (const change of output) {
        const last = merged[merged.length - 1];
        if (last && change.from < last.to) {
            last.to = Math.max(last.to, change.to);
            last.insert += change.insert;
            last.modified = true;
        } else {
            merged.push({ ...change });
        }
    }

    // Put the cursor after the text the user typed in the last fixed change
    let cursor: number | undefined;
    const lastModified = [...merged].reverse().find(change => change.modified);
    if (lastModified && state.selection.ranges.length === 1) {
        const set = ChangeSet.of(merged, doc.length);
        cursor = set.mapPos(lastModified.from, -1) + (lastModified.prepended ? 1 : 0) + lastModified.typed.length;
    } else if (!lastModified && merged.length === 0) {
        cursor = state.selection.main.head;
    }
    return { changes: merged.map(({ from, to, insert }) => ({ from, to, insert })), cursor };
}

// ---------------------------------------------------------------------------------------------
// Parent statuses

/** What matters to parent statuses about a line: blank, or its indent width and task status */
export function lineSignature(text: string, tabSize: number): string {
    if (text.trim() === '') {
        return 'b';
    }
    const info = analyzeLine(text, tabSize);
    const kind = info.kind === 'task' ? '[' + info.status : info.list ? (info.list.kind === 'number' ? '#' : '-') : 'n';
    return `${info.indentWidth}:${kind}`;
}

/**
 * Box replacements that make every parent task in the days touched by `changes` reflect its sub-tasks,
 * in coordinates of `newDoc`. Only computed when the changes affect task structure or statuses.
 */
export function parentStatusChanges(oldDoc: Text, newDoc: Text, changes: ChangeSet, tabSize: number): SimpleChange[] {
    let structural = false;
    const touched: [number, number][] = [];
    changes.iterChangedRanges((fromA, toA, fromB, toB) => {
        const oldA = oldDoc.lineAt(fromA).number, oldB = oldDoc.lineAt(toA).number;
        const newA = newDoc.lineAt(fromB).number, newB = newDoc.lineAt(toB).number;
        touched.push([newA - 1, newB - 1]);
        if (structural) {
            return;
        }
        if (oldB - oldA !== newB - newA) {
            structural = true;
            return;
        }
        for (let i = 0; i <= oldB - oldA; i++) {
            if (lineSignature(oldDoc.line(oldA + i).text, tabSize) !== lineSignature(newDoc.line(newA + i).text, tabSize)) {
                structural = true;
                return;
            }
        }
    });
    if (!structural) {
        return [];
    }

    // Days and list sections
    const getLine = (i: number) => newDoc.line(i + 1).text;
    const scopes = new Map<number, { start: number; end: number }>();
    for (const [a, b] of touched) {
        for (const scope of updateScopesTouching(getLine, newDoc.lines, a, b)) {
            scopes.set(scope.start, scope);
        }
    }

    const result: SimpleChange[] = [];
    for (const scope of [...scopes.values()].sort((x, y) => x.start - y.start)) {
        const lines: string[] = [];
        for (let i = scope.start; i <= scope.end; i++) {
            lines.push(getLine(i));
        }
        for (const update of computeParentStatusUpdates(lines, tabSize)) {
            const line = newDoc.line(scope.start + 1 + update.lineIndex);
            // Only replace the status character(s) inside the box
            result.push({ from: line.from + update.boxStart + 1, to: line.from + update.boxEnd - 1, insert: update.newBox.slice(1, -1) });
        }
    }
    return result;
}

// ---------------------------------------------------------------------------------------------
// The transaction filter

function clampSelection(tr: Transaction): EditorSelection | undefined {
    const selection = tr.selection!;
    if (selection.ranges.length !== 1 || !selection.main.empty) {
        return undefined;
    }
    const pos = selection.main.head;
    const target = clampCursor(tr.startState, pos, tr.startState.selection.main.head);
    return target === pos ? undefined : EditorSelection.single(target);
}

/**
 * Keeps selections on the active tab. A search match or a selection set by the app (not the user moving the
 * cursor) on the other tab switches to it instead.
 */
function selectionOnTab(tr: Transaction): TransactionSpec | undefined {
    const state = tr.startState;
    if (!activeTab(state)) {
        return undefined;
    }
    const selection = tr.selection!;
    const visible = tabVisibleRange(state);
    if (selection.ranges.every(range => range.from >= visible.from && range.to <= visible.to)) {
        return undefined;
    }
    const programmatic = tr.isUserEvent('select.search') || tr.annotation(Transaction.userEvent) === undefined;
    const target = tabOfLine(state, state.doc.lineAt(selection.main.head).number - 1);
    if (programmatic && target !== activeTab(state)) {
        return { effects: setTabEffect.of(target) };
    }
    const clip = (pos: number) => Math.min(Math.max(pos, visible.from), visible.to);
    const clipped = EditorSelection.create(selection.ranges.map(range => EditorSelection.range(clip(range.anchor), clip(range.head))), selection.mainIndex);
    if (clipped.main.empty && clipped.ranges.length === 1) {
        const pos = clipped.main.head;
        return { selection: EditorSelection.single(clampCursor(state, pos, state.selection.main.head)) };
    }
    return { selection: clipped };
}

/**
 * Pasting a URL over selected text in a line's text makes a markdown link of it, as one change. Undefined for any
 * other paste (pasted normally).
 */
export function pasteAsLink(tr: Transaction): TransactionSpec | undefined {
    const state = tr.startState;
    const selection = state.selection;
    if (!tr.isUserEvent('input.paste') || selection.ranges.length !== 1 || selection.main.empty) {
        return undefined;
    }
    const { from, to } = selection.main;
    let pasted: string | undefined;
    let changeCount = 0;
    tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        changeCount++;
        if (fromA === from && toA === to) {
            pasted = inserted.toString();
        }
    });
    if (changeCount !== 1 || pasted === undefined) {
        return undefined;
    }
    const line = state.doc.lineAt(from);
    if (state.doc.lineAt(to).number !== line.number || regionAt(state, from) || regionAt(state, to)) {
        return undefined;
    }
    // Only within the text: not the hidden indentation, box or list marker, and not touching another markdown link
    const textStart = line.from + analyzeLine(line.text, tabSizeOf(state)).textStart;
    if (from < textStart || findLinks(line.text).some(link => link.kind === 'markdown' && from - line.from <= link.to && to - line.from >= link.from)) {
        return undefined;
    }
    const insert = linkForPaste(state.doc.sliceString(from, to), pasted);
    if (!insert) {
        return undefined;
    }
    return { changes: { from, to, insert }, selection: EditorSelection.cursor(from + insert.length), userEvent: 'input.paste', scrollIntoView: true };
}

export const dbmTransactionFilter = EditorState.transactionFilter.of(tr => {
    if (tr.annotation(remoteAnnotation)) {
        return tr;
    }
    const link = pasteAsLink(tr);
    if (link) {
        return link;
    }
    if (!tr.docChanged) {
        if (tr.selection && !tr.effects.some(effect => effect.is(foldEffect) || effect.is(setFoldsEffect) || effect.is(setTabEffect))) {
            const tabbed = selectionOnTab(tr);
            if (tabbed) {
                return [tr, tabbed];
            }
            const selection = clampSelection(tr);
            if (selection) {
                return [tr, { selection }];
            }
        }
        return tr;
    }

    const startState = tr.startState;
    const config = startState.field(configField);
    let first: Transaction | TransactionSpec = tr;
    let base: Transaction = tr;
    const fixed = protectHeaders(startState, tr.changes, tr.isUserEvent('input.replace'));
    if (fixed) {
        const changeSet = ChangeSet.of(fixed.changes, startState.doc.length);
        first = {
            changes: changeSet,
            selection: fixed.cursor !== undefined ? EditorSelection.cursor(fixed.cursor) : startState.selection.map(changeSet, 1),
            effects: tr.effects,
            scrollIntoView: tr.scrollIntoView,
            userEvent: tr.annotation(Transaction.userEvent),
        };
        base = startState.update({ ...first, filter: false });
    }
    if (!config.automaticStatusUpdates || !base.docChanged) {
        return first;
    }
    const updates = parentStatusChanges(startState.doc, base.newDoc, base.changes, tabSizeOf(startState));
    if (updates.length === 0) {
        return first;
    }
    return [first, { changes: updates, sequential: true }];
});

/** All state extensions that don't need the DOM */
export function dbmStateExtensions(config: ViewConfig) {
    return [
        configField.init(() => config),
        structureField,
        foldField,
        tabField,
        dbmTransactionFilter,
    ];
}
