// Rendering of the rendered view (DOM side): header widgets and folds come from a StateField (they change
// the vertical layout), per-line decorations (indentation, status icons, badges) from a ViewPlugin that only
// looks at the visible lines, so typing stays cheap in documents with thousands of lines.

import { EditorState, RangeSet, RangeSetBuilder, StateField, Transaction } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from '@codemirror/view';
import type { ViewConfig } from '../rendered/protocol';
import { statusIconSvg, UI_ICONS } from './icons';
import { findLinks } from './links';
import { configField, foldField, remoteAnnotation, structureField } from './state';
import {
    analyzeLine, BoxSection, BULLET_GLYPHS, BOX_BORDER_REGEX, DAY_HEADER_REGEX, displayNumber, headerHasRoom, inListSection, listDepth, dayContaining, DaySection, dayLabel, directSubtaskStatuses, DocStructure, isToday,
    StatusKind, statusKind, statusLabel, subtreeEnd, summarizeDay
} from './structure';

import { dbmActions } from './actions';
import { LogBarWidget } from './logbar';
export { dbmActions };
export type { DbmActions } from './actions';

const LOCKED_TOOLTIP = 'Status is set from sub-tasks';

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className) {
        node.className = className;
    }
    if (text !== undefined) {
        node.textContent = text;
    }
    return node;
}

function chevron(): HTMLElement {
    const node = element('span', 'dbm-chev');
    node.innerHTML = UI_ICONS.chevronDown;
    node.setAttribute('aria-hidden', 'true');
    return node;
}

/** Makes a header toggle its fold on click, without moving the editor's selection or focus */
function foldOnClick(node: HTMLElement, view: EditorView, key: string) {
    node.addEventListener('mousedown', event => {
        if (event.button === 0) {
            event.preventDefault();
        }
    });
    node.addEventListener('click', event => {
        event.preventDefault();
        view.state.facet(dbmActions)?.toggleFold(view, key);
    });
}

function plural(count: number, word: string) {
    return `${count} ${word}${count === 1 ? '' : 's'}`;
}

// ---------------------------------------------------------------------------------------------
// Box headers (block widgets)

interface BoxProps {
    kind: BoxSection['kind'];
    title: string;
    key: string;
    folded: boolean;
    meta: string;
    firstList: boolean;
    /** Breathing room above (it follows content, not another header or a folded section) */
    spaced: boolean;
}

/** The Daily Log box's lines when the toolbar is pinned: nothing (the toolbar panel in logbar.ts stands for them) */
class HiddenBlockWidget extends WidgetType {
    eq() {
        return true;
    }

    get estimatedHeight() {
        return 0;
    }

    toDOM(): HTMLElement {
        const block = element('div', 'dbm-hidden-block');
        block.setAttribute('aria-hidden', 'true');
        return block;
    }

    ignoreEvent() {
        return true;
    }
}

const hiddenBlock = new HiddenBlockWidget();
const logBarWidget = new LogBarWidget();

class BoxWidget extends WidgetType {
    constructor(readonly props: BoxProps) {
        super();
    }

    eq(other: BoxWidget) {
        const a = this.props, b = other.props;
        return a.kind === b.kind && a.title === b.title && a.key === b.key && a.folded === b.folded && a.meta === b.meta && a.firstList === b.firstList &&
            a.spaced === b.spaced;
    }

    get estimatedHeight() {
        const spaced = this.props.spaced;
        switch (this.props.kind) {
            case 'year': return spaced ? 60 : 48;
            case 'month': return spaced ? 44 : 34;
            default: return (this.props.firstList ? (spaced ? 53 : 41) : 0) + (spaced ? 34 : 27);
        }
    }

    toDOM(view: EditorView): HTMLElement {
        const { kind, title, key, folded, meta, firstList } = this.props;
        const root = element('div', `dbm-box dbm-${kind}${folded ? ' dbm-folded' : ''}${this.props.spaced ? ' dbm-spaced' : ''}`);
        if (kind === 'list' && firstList) {
            root.appendChild(element('div', 'dbm-lists-heading', 'Lists'));
        }
        const header = element('div', 'dbm-header');
        header.setAttribute('role', 'button');
        header.setAttribute('aria-expanded', String(!folded));
        header.title = folded ? 'Unfold' : 'Fold';
        header.appendChild(chevron());
        if (kind === 'list') {
            const icon = element('span', 'dbm-list-icon');
            icon.innerHTML = UI_ICONS.list;
            header.appendChild(icon);
        }
        header.appendChild(element('span', 'dbm-title', title));
        if (meta) {
            header.appendChild(element('span', 'dbm-meta', meta));
        }
        header.setAttribute('aria-label', `${title}${meta ? ', ' + meta : ''}`);
        foldOnClick(header, view, key);
        root.appendChild(header);
        return root;
    }

    ignoreEvent() {
        return true;
    }
}

function boxProps(box: BoxSection, folded: boolean, spaced: boolean): BoxProps {
    let meta = '';
    if ((box.kind === 'year' || box.kind === 'month') && folded) {
        // Only when folded: an open year or month shows its days
        meta = plural(box.dayCount, 'day');
    } else if (box.kind === 'list') {
        meta = String(box.itemCount);
    }
    return { kind: box.kind, title: box.title, key: box.key, folded, meta, firstList: box.firstList, spaced };
}

// ---------------------------------------------------------------------------------------------
// Day headers (inline widgets replacing the header line, or the whole day when folded)

interface DayProps {
    key: string;
    weekday?: string;
    date: string;
    long: string;
    today: boolean;
    folded: boolean;
    statuses: StatusKind[];
    summary: string;
}

const MAX_STRIP = 12;

class DayWidget extends WidgetType {
    constructor(readonly props: DayProps) {
        super();
    }

    eq(other: DayWidget) {
        const a = this.props, b = other.props;
        return a.key === b.key && a.weekday === b.weekday && a.date === b.date && a.today === b.today && a.folded === b.folded &&
            a.summary === b.summary && a.statuses.join() === b.statuses.join();
    }

    toDOM(view: EditorView): HTMLElement {
        const { key, weekday, date, long, today, folded, statuses, summary } = this.props;
        const root = element('span', `dbm-day${folded ? ' dbm-folded' : ''}${today ? ' dbm-today' : ''}`);
        root.setAttribute('role', 'button');
        root.setAttribute('aria-expanded', String(!folded));
        root.setAttribute('aria-label', `${long}${today ? ', today' : ''}${folded ? ', folded: ' + summary : ''}`);
        root.title = folded ? 'Unfold' : 'Fold';
        root.appendChild(chevron());
        const label = element('span', 'dbm-day-date');
        if (weekday) {
            label.appendChild(element('span', 'dbm-wd', weekday + ','));
            label.appendChild(document.createTextNode(' '));
        }
        label.appendChild(element('b', undefined, date));
        root.appendChild(label);
        if (today) {
            root.appendChild(element('span', 'dbm-pill', 'Today'));
        }
        root.appendChild(element('span', 'dbm-rule'));
        if (folded) {
            const summaryNode = element('span', 'dbm-daysum');
            if (statuses.length > 0) {
                const strip = element('span', 'dbm-strip');
                strip.setAttribute('aria-hidden', 'true');
                strip.innerHTML = statuses.slice(0, MAX_STRIP).map(status => `<span class="dbm-st-${status}">${statusIconSvg(status)}</span>`).join('') +
                    (statuses.length > MAX_STRIP ? `<span class="dbm-strip-more">+${statuses.length - MAX_STRIP}</span>` : '');
                summaryNode.appendChild(strip);
            }
            summaryNode.appendChild(element('span', undefined, summary));
            root.appendChild(summaryNode);
        }
        foldOnClick(root, view, key);
        return root;
    }

    ignoreEvent() {
        return true;
    }
}

// ---------------------------------------------------------------------------------------------
// Status icons and sub-task badges

class StatusIconWidget extends WidgetType {
    constructor(readonly kind: StatusKind, readonly locked: boolean) {
        super();
    }

    eq(other: StatusIconWidget) {
        return other.kind === this.kind && other.locked === this.locked;
    }

    toDOM(view: EditorView): HTMLElement {
        const button = element('button', `dbm-icon dbm-st-${this.kind}${this.locked ? ' dbm-locked' : ''}`);
        button.type = 'button';
        button.tabIndex = -1;
        button.innerHTML = statusIconSvg(this.kind);
        const label = statusLabel(this.kind);
        if (this.locked) {
            button.setAttribute('aria-disabled', 'true');
            button.setAttribute('aria-label', `Status: ${label}. ${LOCKED_TOOLTIP}`);
            button.title = LOCKED_TOOLTIP;
        } else {
            button.setAttribute('aria-label', `Status: ${label}`);
            button.setAttribute('aria-haspopup', 'menu');
            button.title = `${label}: click to change`;
        }
        button.addEventListener('mousedown', event => {
            event.preventDefault();
        });
        button.addEventListener('click', event => {
            event.preventDefault();
            const actions = view.state.facet(dbmActions);
            if (this.locked) {
                actions?.announce(LOCKED_TOOLTIP);
                return;
            }
            const line = view.state.doc.lineAt(view.posAtDOM(button)).number;
            actions?.openPicker(view, line, button);
        });
        return button;
    }

    ignoreEvent() {
        return true;
    }
}

/** A list item's marker in the checkbox column: a bullet that varies by depth, or the displayed number */
class ListMarkerWidget extends WidgetType {
    constructor(readonly text: string, readonly kind: 'bullet' | 'number') {
        super();
    }

    eq(other: ListMarkerWidget) {
        return other.text === this.text && other.kind === this.kind;
    }

    toDOM(): HTMLElement {
        const marker = element('span', `dbm-marker dbm-marker-${this.kind}${this.text === '▪' ? ' dbm-marker-square' : ''}`, this.text);
        marker.setAttribute('aria-hidden', 'true');
        return marker;
    }

    ignoreEvent() {
        return false;
    }
}

class BadgeWidget extends WidgetType {
    constructor(readonly done: number, readonly total: number) {
        super();
    }

    eq(other: BadgeWidget) {
        return other.done === this.done && other.total === this.total;
    }

    toDOM(): HTMLElement {
        const badge = element('span', 'dbm-badge', `${this.done}/${this.total}`);
        badge.title = `${this.done} of ${plural(this.total, 'sub-task')} done`;
        return badge;
    }
}

// ---------------------------------------------------------------------------------------------
// Block decorations: box headers, day headers and folded sections

interface BlockValue {
    decos: DecorationSet;
    atomic: DecorationSet;
    revision: number;
    folds: ReadonlySet<string>;
    config: ViewConfig;
}

const hidden = Decoration.replace({});

function buildBlocks(state: EditorState): BlockValue {
    const structure = state.field(structureField);
    const folds = state.field(foldField);
    const config = state.field(configField);
    const doc = state.doc;
    const tabSize = config.tabSize > 0 ? config.tabSize : 4;
    const decos = new RangeSetBuilder<Decoration>();
    const atomic = new RangeSetBuilder<Decoration>();
    const lineFrom = (line: number) => doc.line(line + 1).from;
    const lineTo = (line: number) => doc.line(line + 1).to;
    const getLine = (line: number) => doc.line(line + 1).text;

    // The last line of the latest folded section: headers right after it stay compact
    let hiddenUntil = -1;
    const { boxes, days } = structure;
    for (let b = 0, d = 0; b < boxes.length || d < days.length;) {
        const box: BoxSection | undefined = boxes[b];
        const day: DaySection | undefined = days[d];
        if (box && (!day || box.line < day.line)) {
            b++;
            if (box.line <= hiddenUntil || box.line + 2 >= doc.lines) {
                continue;
            }
            const folded = box.kind !== 'dailyLog' && folds.has(box.key);
            const from = lineFrom(box.line);
            const to = folded ? lineTo(box.end) : lineTo(box.line + 2);
            const spaced = headerHasRoom(getLine, box.line, hiddenUntil);
            if (folded) {
                hiddenUntil = box.end;
            }
            // The Daily Log box is the toolbar: pinned above the editor (nothing here), or here in the flow
            const widget = box.kind === 'dailyLog' ? (config.pinToolbar === false ? logBarWidget : hiddenBlock) : new BoxWidget(boxProps(box, folded, spaced));
            decos.add(from, to, Decoration.replace({ widget, block: true, folded }));
            atomic.add(from, to, hidden);
        } else if (day) {
            d++;
            if (day.line <= hiddenUntil || day.line >= doc.lines) {
                continue;
            }
            const folded = folds.has(day.key);
            const from = lineFrom(day.line);
            const to = folded ? lineTo(day.end) : lineTo(day.line);
            const spaced = headerHasRoom(getLine, day.line, hiddenUntil);
            let statuses: StatusKind[] = [];
            let summary = '';
            if (folded) {
                hiddenUntil = day.end;
                const lines: string[] = [];
                for (let i = day.line + 1; i <= day.end; i++) {
                    lines.push(doc.line(i + 1).text);
                }
                const result = summarizeDay(lines, tabSize);
                statuses = result.statuses;
                summary = result.text;
            }
            const label = dayLabel(day);
            const widget = new DayWidget({
                key: day.key, weekday: label.weekday, date: label.date, long: label.long,
                today: isToday(day, config.today), folded, statuses, summary,
            });
            decos.add(from, from, Decoration.line({ class: `dbm-day-line${folded ? ' dbm-day-line-folded' : ''}${spaced ? ' dbm-day-spaced' : ''}` }));
            decos.add(from, to, Decoration.replace({ widget, folded }));
            atomic.add(from, to, hidden);
        }
    }
    return { decos: decos.finish(), atomic: atomic.finish(), revision: structure.revision, folds, config };
}

function touchesFolded(decos: DecorationSet, tr: Transaction): boolean {
    let touched = false;
    tr.changes.iterChangedRanges((fromA, toA) => {
        if (!touched) {
            decos.between(fromA, toA, (_from, _to, deco) => {
                if (deco.spec.folded) {
                    touched = true;
                    return false;
                }
                return undefined;
            });
        }
    });
    return touched;
}

/**
 * Whether a change can turn the content right above a header into no content (or back), which changes the
 * header's spacing: lines added or removed, or a line becoming blank or not, followed by a header.
 */
function affectsHeaderSpacing(tr: Transaction): boolean {
    const oldDoc = tr.startState.doc, newDoc = tr.newDoc;
    let affects = false;
    tr.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
        if (affects) {
            return;
        }
        const oldA = oldDoc.lineAt(fromA).number, oldB = oldDoc.lineAt(toA).number;
        const newA = newDoc.lineAt(fromB).number, newB = newDoc.lineAt(toB).number;
        let changed = oldB - oldA !== newB - newA;
        for (let i = 0; !changed && i <= newB - newA; i++) {
            changed = (oldDoc.line(oldA + i).text.trim() === '') !== (newDoc.line(newA + i).text.trim() === '');
        }
        if (!changed) {
            return;
        }
        for (let n = newB + 1; n <= newDoc.lines && n <= newB + 50; n++) {
            const text = newDoc.line(n).text;
            if (text.trim() !== '') {
                affects = BOX_BORDER_REGEX.test(text) || DAY_HEADER_REGEX.test(text);
                return;
            }
        }
    });
    return affects;
}

export const blockField = StateField.define<BlockValue>({
    create: buildBlocks,
    update(value, tr) {
        const structure = tr.state.field(structureField);
        if (structure.revision !== value.revision || tr.state.field(foldField) !== value.folds || tr.state.field(configField) !== value.config) {
            return buildBlocks(tr.state);
        }
        if (!tr.docChanged) {
            return value;
        }
        if (tr.annotation(remoteAnnotation) || touchesFolded(value.decos, tr) || affectsHeaderSpacing(tr)) {
            return buildBlocks(tr.state);
        }
        return { ...value, decos: value.decos.map(tr.changes), atomic: value.atomic.map(tr.changes) };
    },
    provide: field => [
        EditorView.decorations.from(field, value => value.decos),
        EditorView.atomicRanges.of(view => view.state.field(field).atomic),
    ],
});

// ---------------------------------------------------------------------------------------------
// Line decorations for the visible lines: indentation, status icons, sub-task badges, text styles


function lineDecoration(classes: string, level: number) {
    return Decoration.line(level > 0 ? { class: classes, attributes: { style: `--dbm-indent: ${+level.toFixed(3)}` } } : { class: classes });
}

function coveredByBlock(blocks: DecorationSet, from: number, to: number): boolean {
    let covered = false;
    blocks.between(from, to, (rangeFrom, rangeTo) => {
        if (rangeFrom < rangeTo && rangeFrom <= from && rangeTo >= to) {
            covered = true;
            return false;
        }
        return undefined;
    });
    return covered;
}

function buildLines(view: EditorView): { decorations: DecorationSet; atomic: DecorationSet } {
    const state = view.state;
    const doc = state.doc;
    const config = state.field(configField);
    const tabSize = config.tabSize > 0 ? config.tabSize : 4;
    const structure: DocStructure = state.field(structureField);
    const blocks = state.field(blockField).decos;
    const decorations = new RangeSetBuilder<Decoration>();
    const atomic = new RangeSetBuilder<Decoration>();
    const getLine = (i: number) => doc.line(i + 1).text;
    let lastLine = 0;

    for (const { from, to } of view.visibleRanges) {
        for (let pos = from; pos <= to;) {
            const line = doc.lineAt(pos);
            pos = line.to + 1;
            if (line.number <= lastLine) {
                continue;
            }
            lastLine = line.number;
            if (coveredByBlock(blocks, line.from, line.to)) {
                continue;
            }
            const info = analyzeLine(line.text, tabSize);
            const level = info.indentWidth / tabSize;

            if (info.kind === 'task') {
                const kind = statusKind(info.status);
                const end = subtreeEnd(getLine, line.number - 1, doc.lines - 1, tabSize);
                const subtasks: string[] = [];
                if (end > line.number - 1) {
                    const lines: string[] = [];
                    for (let i = line.number - 1; i <= end; i++) {
                        lines.push(getLine(i));
                    }
                    subtasks.push(...directSubtaskStatuses(lines, tabSize));
                }
                const counted = subtasks.filter(status => statusKind(status) !== 'removed');
                const done = counted.filter(status => statusKind(status) === 'done').length;
                const locked = subtasks.length > 0 && config.automaticStatusUpdates &&
                    (dayContaining(structure, line.number - 1) !== undefined || inListSection(structure, line.number - 1));
                decorations.add(line.from, line.from, lineDecoration(`dbm-line dbm-task dbm-task-${kind}${counted.length ? ' dbm-has-badge' : ''}`, level));
                if (info.indentLength > 0) {
                    decorations.add(line.from, line.from + info.indentLength, hidden);
                }
                decorations.add(line.from + info.boxStart, line.from + info.textStart, Decoration.replace({ widget: new StatusIconWidget(kind, locked) }));
                if (counted.length > 0) {
                    decorations.add(line.to, line.to, Decoration.widget({ widget: new BadgeWidget(done, counted.length), side: 1 }));
                }
                atomic.add(line.from, line.from + info.textStart, hidden);
            } else if (info.kind === 'note') {
                const list = info.list;
                decorations.add(line.from, line.from, lineDecoration(list ? 'dbm-line dbm-note dbm-list-item' : 'dbm-line dbm-note', level));
                if (info.indentLength > 0) {
                    decorations.add(line.from, line.from + info.indentLength, hidden);
                }
                if (list) {
                    const marker = list.kind === 'number'
                        ? `${displayNumber(getLine, line.number - 1, tabSize)}.`
                        : BULLET_GLYPHS[listDepth(getLine, line.number - 1, tabSize) % BULLET_GLYPHS.length];
                    decorations.add(line.from + info.indentLength, line.from + info.textStart, Decoration.replace({ widget: new ListMarkerWidget(marker, list.kind) }));
                }
                if (info.textStart > 0) {
                    atomic.add(line.from, line.from + info.textStart, hidden);
                }
            } else {
                decorations.add(line.from, line.from, lineDecoration('dbm-line dbm-blank', level));
                if (info.indentLength > 0) {
                    decorations.add(line.from, line.to, hidden);
                    atomic.add(line.from, line.to, hidden);
                }
            }
        }
    }
    return { decorations: decorations.finish(), atomic: atomic.finish() };
}

class LineDecorations {
    decorations: DecorationSet;
    atomic: DecorationSet;

    constructor(view: EditorView) {
        ({ decorations: this.decorations, atomic: this.atomic } = buildLines(view));
    }

    update(update: ViewUpdate) {
        const now = update.state, before = update.startState;
        if (update.docChanged || update.viewportChanged ||
            now.field(configField) !== before.field(configField) ||
            now.field(foldField) !== before.field(foldField) ||
            now.field(structureField).revision !== before.field(structureField).revision) {
            ({ decorations: this.decorations, atomic: this.atomic } = buildLines(update.view));
        }
    }
}

export const linePlugin = ViewPlugin.fromClass(LineDecorations, {
    decorations: plugin => plugin.decorations,
    provide: plugin => EditorView.atomicRanges.of(view => view.plugin(plugin)?.atomic ?? RangeSet.empty),
});

// ---------------------------------------------------------------------------------------------
// Links: markdown links show only their text, unless the cursor or selection touches them (then the raw
// markdown shows, so it can be edited). Bare URLs are styled as links.

export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
const OPEN_HINT = `${IS_MAC ? 'Cmd' : 'Ctrl'}+Click to open`;
const linkSyntax = Decoration.mark({ class: 'dbm-link-syntax' });

function linkMark(href: string) {
    return Decoration.mark({ class: 'dbm-link', attributes: { 'data-href': href, title: `${href}\n${OPEN_HINT}` } });
}

function buildLinks(view: EditorView): { decorations: DecorationSet; atomic: DecorationSet } {
    const state = view.state;
    const doc = state.doc;
    const tabSize = state.field(configField).tabSize > 0 ? state.field(configField).tabSize : 4;
    const blocks = state.field(blockField).decos;
    const ranges = state.selection.ranges;
    const decorations = new RangeSetBuilder<Decoration>();
    const atomic = new RangeSetBuilder<Decoration>();
    let lastLine = 0;
    for (const { from, to } of view.visibleRanges) {
        for (let pos = from; pos <= to;) {
            const line = doc.lineAt(pos);
            pos = line.to + 1;
            if (line.number <= lastLine || line.length === 0) {
                continue;
            }
            lastLine = line.number;
            // Quick rejection: every link has a "](" or a ":"
            if ((line.text.indexOf('](') < 0 && line.text.indexOf(':') < 0) || coveredByBlock(blocks, line.from, line.to)) {
                continue;
            }
            for (const link of findLinks(line.text, analyzeLine(line.text, tabSize).textStart)) {
                const linkFrom = line.from + link.from, linkTo = line.from + link.to;
                const textFrom = line.from + link.textFrom, textTo = line.from + link.textTo;
                if (link.kind === 'url') {
                    decorations.add(linkFrom, linkTo, linkMark(link.href));
                } else if (ranges.some(range => range.from <= linkTo && range.to >= linkFrom)) {
                    decorations.add(linkFrom, textFrom, linkSyntax);
                    decorations.add(textFrom, textTo, linkMark(link.href));
                    decorations.add(textTo, linkTo, linkSyntax);
                } else {
                    decorations.add(linkFrom, textFrom, hidden);
                    decorations.add(textFrom, textTo, linkMark(link.href));
                    decorations.add(textTo, linkTo, hidden);
                    atomic.add(linkFrom, textFrom, hidden);
                    atomic.add(textTo, linkTo, hidden);
                }
            }
        }
    }
    return { decorations: decorations.finish(), atomic: atomic.finish() };
}

class LinkDecorations {
    decorations: DecorationSet;
    atomic: DecorationSet;

    constructor(view: EditorView) {
        ({ decorations: this.decorations, atomic: this.atomic } = buildLinks(view));
    }

    update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged || update.selectionSet ||
            update.state.field(blockField) !== update.startState.field(blockField) ||
            update.state.field(configField) !== update.startState.field(configField)) {
            ({ decorations: this.decorations, atomic: this.atomic } = buildLinks(update.view));
        }
    }
}

export const linkPlugin = ViewPlugin.fromClass(LinkDecorations, {
    decorations: plugin => plugin.decorations,
    provide: plugin => EditorView.atomicRanges.of(view => view.plugin(plugin)?.atomic ?? RangeSet.empty),
});

/** The link under a mouse event: a rendered or raw link's text, or anywhere in a raw markdown link */
export function linkAtEvent(view: EditorView, event: MouseEvent): string | undefined {
    const marked = (event.target as HTMLElement | null)?.closest?.('[data-href]') as HTMLElement | null;
    if (marked && view.contentDOM.contains(marked)) {
        return marked.dataset.href;
    }
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos === null) {
        return undefined;
    }
    const line = view.state.doc.lineAt(pos);
    return findLinks(line.text).find(link => line.from + link.from <= pos && pos < line.from + link.to)?.href;
}

/** Icon element of the task on the given line, if it is rendered */
export function findStatusIcon(view: EditorView, lineNumber: number): HTMLElement | undefined {
    const line = view.state.doc.line(lineNumber);
    for (const icon of Array.from(view.contentDOM.querySelectorAll<HTMLElement>('.dbm-icon'))) {
        const pos = view.posAtDOM(icon);
        if (pos >= line.from && pos <= line.to) {
            return icon;
        }
    }
    return undefined;
}

/** Whether the task on a line is a parent whose status is computed (its icon is not interactive) */
export function isLockedTask(state: EditorState, lineNumber: number): boolean {
    const config = state.field(configField);
    if (!config.automaticStatusUpdates) {
        return false;
    }
    const tabSize = config.tabSize > 0 ? config.tabSize : 4;
    const doc = state.doc;
    const structure = state.field(structureField);
    if (dayContaining(structure, lineNumber - 1) === undefined && !inListSection(structure, lineNumber - 1)) {
        return false;
    }
    const getLine = (i: number) => doc.line(i + 1).text;
    const end = subtreeEnd(getLine, lineNumber - 1, doc.lines - 1, tabSize);
    if (end <= lineNumber - 1) {
        return false;
    }
    const lines: string[] = [];
    for (let i = lineNumber - 1; i <= end; i++) {
        lines.push(getLine(i));
    }
    return directSubtaskStatuses(lines, tabSize).length > 0;
}

