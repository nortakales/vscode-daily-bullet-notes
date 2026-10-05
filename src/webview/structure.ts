// Pure structure of a .dbm document for the rendered view: box headers, days, foldable sections and
// line kinds. No DOM and no @codemirror/view imports, so it can be unit tested in Node.

import { getIndentWidth } from '../taskLogic';
import type { StatusKey } from '../rendered/protocol';

// Copied exactly from documentParser.ts, so the view agrees with the extension host
export const BOX_BORDER_REGEX = /^\+\-{20,100}\+/;
export const DAILY_LOG_TITLE_REGEX = /^\|\s+Daily Log\s+\|/;
export const YEAR_TITLE_REGEX = /^\|\s+(\d{4})\s+\|/;
export const MONTH_TITLE_REGEX = /^\|\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+\|/;
export const LIST_TITLE_REGEX = /^\|\s+([^\s]+.*?)\s+\|/;
export const DAY_HEADER_REGEX = /^\d{1,2}(\/(\d{1,2}))? \-{20,100}( < Today)?/;
// Copied from taskLogic.ts
export const TASK_REGEX = /^(\s*)\[(.?)\]/;

/** The day header regex does not capture the first number, so read both numbers with this one */
const DAY_NUMBERS_REGEX = /^(\d{1,2})(?:\/(\d{1,2}))?/;

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ---------------------------------------------------------------------------------------------
// Statuses

export type StatusKind = StatusKey | 'unknown';

export const STATUS_ORDER: readonly StatusKey[] = ['open', 'done', 'progress', 'blocked', 'removed', 'tomorrow'];

export const STATUS_INFO: Readonly<Record<StatusKey, { label: string; char: string; hint: string }>> = {
    open: { label: 'Open', char: ' ', hint: 'Space' },
    done: { label: 'Done', char: 'x', hint: 'X' },
    progress: { label: 'In progress', char: '+', hint: '+' },
    blocked: { label: 'Blocked', char: '/', hint: '/' },
    removed: { label: 'Removed', char: '-', hint: '-' },
    tomorrow: { label: 'Tomorrow', char: '>', hint: '>' },
};

/** Keys that pick a status in the picker (the characters that go in the box) */
export const STATUS_KEYS: Readonly<Record<string, StatusKey>> = {
    ' ': 'open', 'x': 'done', 'X': 'done', '+': 'progress', '/': 'blocked', '-': 'removed', '>': 'tomorrow',
};

/** Status of a box's contents. `[]` and `[ ]` are both open. */
export function statusKind(boxContent: string): StatusKind {
    switch (boxContent) {
        case '': case ' ': case '\t': return 'open';
        case 'x': case 'X': return 'done';
        case '+': return 'progress';
        case '/': return 'blocked';
        case '-': return 'removed';
        case '>': return 'tomorrow';
        default: return 'unknown';
    }
}

export function statusLabel(kind: StatusKind): string {
    return kind === 'unknown' ? 'Unknown' : STATUS_INFO[kind].label;
}

// ---------------------------------------------------------------------------------------------
// Lines

export interface ListMarker {
    /** '-' or '*' bullets, or a number followed by '.' */
    kind: 'bullet' | 'number';
    /** The marker as typed, without its space: "-", "*", "12." */
    text: string;
    /** Numbered items: the number as typed */
    number: number;
}

export interface LineInfo {
    kind: 'task' | 'note' | 'blank';
    /** Number of leading whitespace characters */
    indentLength: number;
    /** Visual width of the leading whitespace (tabs expanded) */
    indentWidth: number;
    /** Tasks: character range of the box, e.g. "[ ]" */
    boxStart: number;
    boxEnd: number;
    /** Tasks: the box contents ('' for "[]") */
    status: string;
    /** Notes that are list items ("- ", "* ", "1. " after the indentation): the marker, which starts at indentLength */
    list?: ListMarker;
    /**
     * Character where the editable text starts: after the indentation, after the box plus one space for tasks,
     * and after the marker plus its space for list items
     */
    textStart: number;
}

/** A list item marker at the start of a note's text: "- ", "* " or a number, a dot and a space */
const LIST_MARKER_REGEX = /^(?:([-*])|(\d{1,9})\.) /;

export function analyzeLine(text: string, tabSize: number): LineInfo {
    const match = TASK_REGEX.exec(text);
    if (match) {
        const indentLength = match[1].length;
        const boxEnd = match[0].length;
        return {
            kind: 'task',
            indentLength,
            indentWidth: getIndentWidth(text, tabSize),
            boxStart: indentLength,
            boxEnd,
            status: match[2],
            textStart: boxEnd + (text.charCodeAt(boxEnd) === 32 ? 1 : 0),
        };
    }
    const indentLength = leadingWhitespace(text);
    const info: LineInfo = {
        kind: indentLength === text.length ? 'blank' : 'note',
        indentLength,
        indentWidth: getIndentWidth(text, tabSize),
        boxStart: -1,
        boxEnd: -1,
        status: '',
        textStart: indentLength,
    };
    const marker = info.kind === 'note' ? LIST_MARKER_REGEX.exec(text.slice(indentLength)) : null;
    if (marker) {
        const markerText = marker[0].slice(0, -1);
        info.list = marker[1] ? { kind: 'bullet', text: markerText, number: 0 } : { kind: 'number', text: markerText, number: +marker[2] };
        info.textStart = indentLength + marker[0].length;
    }
    return info;
}

export function leadingWhitespace(text: string): number {
    const match = /^\s*/.exec(text);
    return match ? match[0].length : 0;
}

/** True for lines that can change the header structure (box borders, box titles, day headers) */
export function isHeaderLike(text: string): boolean {
    return BOX_BORDER_REGEX.test(text) || DAY_HEADER_REGEX.test(text) || text.charCodeAt(0) === 124 /* | */;
}

// ---------------------------------------------------------------------------------------------
// Document structure

export type BoxKind = 'dailyLog' | 'year' | 'month' | 'list';

export interface BoxSection {
    kind: BoxKind;
    /** 0-based line of the top border; the box is this line and the next two */
    line: number;
    /** Last line of the section this box starts (inclusive). The daily log box is just its 3 lines. */
    end: number;
    title: string;
    /** Stable identity used for fold state, e.g. "year:2026", "month:2026-10", "list:Backburner" */
    key: string;
    /** Year boxes: the year. Month boxes: the enclosing year, if any. */
    year?: number;
    /** Month boxes: 1-12 */
    month?: number;
    /** Years and months: number of days inside */
    dayCount: number;
    /** Years: titles of the months inside */
    monthTitles: string[];
    /** Lists: number of top level (not indented) items */
    itemCount: number;
    /** The first list box, which also shows the "Lists" heading */
    firstList: boolean;
}

export interface DaySection {
    /** 0-based line of the day header */
    line: number;
    /** Last line of the day (inclusive): the line before the next day header or box border, or the last line */
    end: number;
    day: number;
    month?: number;
    year?: number;
    /** Stable identity used for fold state, e.g. "day:2026-10-04" */
    key: string;
}

export interface DocStructure {
    /** Changes whenever headers, sections or list counts change (not when lines just shift) */
    revision: number;
    lineCount: number;
    boxes: readonly BoxSection[];
    days: readonly DaySection[];
}

export function isBoxAt(lines: readonly string[], i: number): boolean {
    return i + 2 < lines.length && BOX_BORDER_REGEX.test(lines[i]) && LIST_TITLE_REGEX.test(lines[i + 1]) && BOX_BORDER_REGEX.test(lines[i + 2]);
}

function pad2(n: number | undefined): string {
    return n === undefined || isNaN(n) ? '??' : (n < 10 ? '0' + n : String(n));
}

/**
 * Parses the headers of a document. Boxes need all three lines (border, title, border) to match, anything
 * else stays a plain line. Days end before the next day header or any box border, like documentParser.
 */
export function parseStructure(lines: readonly string[], revision = 0): DocStructure {
    const boxes: BoxSection[] = [];
    const days: DaySection[] = [];
    const usedKeys = new Map<string, number>();
    const uniqueKey = (key: string) => {
        const count = (usedKeys.get(key) ?? 0) + 1;
        usedKeys.set(key, count);
        return count === 1 ? key : `${key}#${count}`;
    };

    let currentYear: number | undefined;
    let currentMonth: number | undefined;
    let openDay: DaySection | undefined;
    const closeDay = (lastLine: number) => {
        if (openDay) {
            openDay.end = Math.max(openDay.line, lastLine);
            openDay = undefined;
        }
    };

    const n = lines.length;
    for (let i = 0; i < n; i++) {
        const text = lines[i];
        if (BOX_BORDER_REGEX.test(text)) {
            closeDay(i - 1);
            if (!isBoxAt(lines, i)) {
                continue;
            }
            const titleLine = lines[i + 1];
            const title = LIST_TITLE_REGEX.exec(titleLine)![1];
            let box: BoxSection;
            const base = { line: i, end: i + 2, title, dayCount: 0, monthTitles: [] as string[], itemCount: 0, firstList: false };
            const yearMatch = YEAR_TITLE_REGEX.exec(titleLine);
            const monthMatch = MONTH_TITLE_REGEX.exec(titleLine);
            if (DAILY_LOG_TITLE_REGEX.test(titleLine)) {
                box = { ...base, kind: 'dailyLog', title: 'Daily Log', key: uniqueKey('log') };
            } else if (yearMatch) {
                currentYear = +yearMatch[1];
                currentMonth = undefined;
                box = { ...base, kind: 'year', title: yearMatch[1], year: currentYear, key: uniqueKey(`year:${yearMatch[1]}`) };
            } else if (monthMatch) {
                currentMonth = MONTH_NAMES.indexOf(monthMatch[1]) + 1;
                box = {
                    ...base, kind: 'month', title: monthMatch[1], year: currentYear, month: currentMonth,
                    key: uniqueKey(`month:${currentYear ?? '?'}-${pad2(currentMonth)}`)
                };
            } else {
                currentYear = undefined;
                currentMonth = undefined;
                box = { ...base, kind: 'list', key: uniqueKey(`list:${title}`) };
            }
            boxes.push(box);
            i += 2;
            continue;
        }
        if (DAY_HEADER_REGEX.test(text)) {
            closeDay(i - 1);
            const numbers = DAY_NUMBERS_REGEX.exec(text)!;
            const month = numbers[2] !== undefined ? +numbers[1] : currentMonth;
            const day = numbers[2] !== undefined ? +numbers[2] : +numbers[1];
            openDay = {
                line: i, end: i, day, month, year: currentYear,
                key: uniqueKey(`day:${currentYear ?? '?'}-${pad2(month)}-${pad2(day)}`)
            };
            days.push(openDay);
        }
    }
    closeDay(n - 1);

    // Section ends: years run until the next box that is not a month, months and lists until the next box
    for (let b = 0; b < boxes.length; b++) {
        const box = boxes[b];
        if (box.kind === 'dailyLog') {
            continue;
        }
        let end = n - 1;
        for (let next = b + 1; next < boxes.length; next++) {
            if (box.kind !== 'year' || boxes[next].kind !== 'month') {
                end = boxes[next].line - 1;
                break;
            }
        }
        box.end = Math.max(box.line + 2, end);
    }

    // Derived counts
    let firstListSeen = false;
    for (const box of boxes) {
        if (box.kind === 'month') {
            box.dayCount = countDays(days, box.line, box.end);
        } else if (box.kind === 'year') {
            box.dayCount = countDays(days, box.line, box.end);
            box.monthTitles = boxes.filter(m => m.kind === 'month' && m.line > box.line && m.line <= box.end).map(m => m.title);
        } else if (box.kind === 'list') {
            box.itemCount = countListItems(lines, box.line + 3, box.end);
            box.firstList = !firstListSeen;
            firstListSeen = true;
        }
    }

    return { revision, lineCount: n, boxes, days };
}

function countDays(days: readonly DaySection[], from: number, to: number): number {
    let count = 0;
    for (const day of days) {
        if (day.line > from && day.line <= to) {
            count++;
        }
    }
    return count;
}

/** Top level items of a list: non-blank lines that are not indented */
export function countListItems(lines: readonly string[] | ((i: number) => string), from: number, to: number): number {
    const get = typeof lines === 'function' ? lines : (i: number) => lines[i];
    let count = 0;
    for (let i = from; i <= to; i++) {
        const text = get(i);
        if (text.length > 0 && !/^\s/.test(text)) {
            count++;
        }
    }
    return count;
}

// ---------------------------------------------------------------------------------------------
// Sections (for folding)

export type SectionKind = 'year' | 'month' | 'list' | 'day';

export interface Section {
    kind: SectionKind;
    key: string;
    /** First header line */
    line: number;
    /** Last header line (box: line + 2, day: line) */
    headerEnd: number;
    /** Last line of the section, inclusive */
    end: number;
}

const sectionCache = new WeakMap<DocStructure, readonly Section[]>();

/** All foldable sections (years, months, lists, days) in document order */
export function sectionsOf(structure: DocStructure): readonly Section[] {
    let sections = sectionCache.get(structure);
    if (!sections) {
        const list: Section[] = [];
        for (const box of structure.boxes) {
            if (box.kind !== 'dailyLog') {
                list.push({ kind: box.kind, key: box.key, line: box.line, headerEnd: box.line + 2, end: box.end });
            }
        }
        for (const day of structure.days) {
            list.push({ kind: 'day', key: day.key, line: day.line, headerEnd: day.line, end: day.end });
        }
        list.sort((a, b) => a.line - b.line);
        sections = list;
        sectionCache.set(structure, sections);
    }
    return sections;
}

/** Sections that contain the given line (its year, month, list and day), outermost first */
export function sectionsContaining(structure: DocStructure, line: number): Section[] {
    return sectionsOf(structure).filter(section => section.line <= line && line <= section.end);
}

/** Folded sections that are not inside another folded section */
export function outermostFolded(structure: DocStructure, folds: ReadonlySet<string>): Section[] {
    const result: Section[] = [];
    let coveredUntil = -1;
    for (const section of sectionsOf(structure)) {
        if (section.line <= coveredUntil || !folds.has(section.key)) {
            continue;
        }
        result.push(section);
        coveredUntil = section.end;
    }
    return result;
}

/** The day containing the given line, from the parsed structure */
export function dayContaining(structure: DocStructure, line: number): DaySection | undefined {
    const days = structure.days;
    let low = 0, high = days.length - 1, found = -1;
    while (low <= high) {
        const mid = (low + high) >> 1;
        if (days[mid].line <= line) {
            found = mid;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }
    if (found < 0) {
        return undefined;
    }
    const day = days[found];
    return line <= day.end ? day : undefined;
}

/** Header line kind at a line: 'box' for any of a box's three lines, 'day' for a day header */
export function headerAt(structure: DocStructure, line: number): { kind: 'box'; box: BoxSection } | { kind: 'day'; day: DaySection } | undefined {
    const boxes = structure.boxes;
    let low = 0, high = boxes.length - 1;
    while (low <= high) {
        const mid = (low + high) >> 1;
        const box = boxes[mid];
        if (line < box.line) {
            high = mid - 1;
        } else if (line > box.line + 2) {
            low = mid + 1;
        } else {
            return { kind: 'box', box };
        }
    }
    const day = dayContaining(structure, line);
    if (day && day.line === line) {
        return { kind: 'day', day };
    }
    return undefined;
}

/**
 * Keys to fold for the standup view: everything except the two most recent days of the daily log
 * and the year and month around them.
 */
export function standupFoldKeys(structure: DocStructure): string[] {
    const lists = structure.boxes.filter(box => box.kind === 'list');
    const logDays = structure.days.filter(day => !lists.some(list => day.line > list.line && day.line <= list.end));
    const keep = new Set<string>();
    for (const day of logDays.slice(-2)) {
        for (const section of sectionsContaining(structure, day.line)) {
            keep.add(section.key);
        }
    }
    return sectionsOf(structure).map(section => section.key).filter(key => !keep.has(key));
}

/** The two most recent days of the daily log (oldest first), for scrolling after the standup view */
export function standupDays(structure: DocStructure): DaySection[] {
    const lists = structure.boxes.filter(box => box.kind === 'list');
    return structure.days.filter(day => !lists.some(list => day.line > list.line && day.line <= list.end)).slice(-2);
}

// ---------------------------------------------------------------------------------------------
// Dates

export interface DayLabel {
    /** "Sun" when the full date is known */
    weekday?: string;
    /** "Oct 4", or just the day number when the month is unknown */
    date: string;
    /** "Sunday, October 4, 2026" for screen readers */
    long: string;
}

export function dayLabel(day: { day: number; month?: number; year?: number }): DayLabel {
    const { year, month } = day;
    const validMonth = month !== undefined && month >= 1 && month <= 12;
    const date = validMonth ? `${MONTH_SHORT[month - 1]} ${day.day}` : `Day ${day.day}`;
    let weekday: string | undefined;
    let long = validMonth ? `${MONTH_NAMES[month - 1]} ${day.day}` : `Day ${day.day}`;
    if (validMonth && year !== undefined) {
        const value = new Date(year, month - 1, day.day);
        if (value.getFullYear() === year && value.getMonth() === month - 1 && value.getDate() === day.day) {
            weekday = WEEKDAY_SHORT[value.getDay()];
            long = `${WEEKDAY_LONG[value.getDay()]}, ${long}, ${year}`;
        }
    }
    return { weekday, date, long };
}

export function isToday(day: { day: number; month?: number; year?: number }, today: { year: number; month: number; day: number }): boolean {
    return day.day === today.day && day.month === today.month && day.year === today.year;
}

// ---------------------------------------------------------------------------------------------
// Task trees, summaries and sub-task counts

interface Node {
    index: number;
    status?: string;
    children: Node[];
}

/** Same tree as taskLogic's buildLineTree: a line's parent is the closest line above with a smaller indent */
function buildTree(lines: readonly string[], tabSize: number): Node[] {
    const roots: Node[] = [];
    const stack: { indent: number; node: Node }[] = [];
    lines.forEach((text, index) => {
        if (text.trim() === '') {
            return;
        }
        const indent = getIndentWidth(text, tabSize);
        while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
            stack.pop();
        }
        const match = TASK_REGEX.exec(text);
        const node: Node = { index, status: match ? match[2] : undefined, children: [] };
        (stack.length > 0 ? stack[stack.length - 1].node.children : roots).push(node);
        stack.push({ indent, node });
    });
    return roots;
}

/** The closest tasks among the given nodes, looking through notes (like computeParentStatusUpdates) */
function closestTasks(nodes: Node[], out: Node[] = []): Node[] {
    for (const node of nodes) {
        if (node.status !== undefined) {
            out.push(node);
        } else {
            closestTasks(node.children, out);
        }
    }
    return out;
}

export interface DaySummary {
    /** Statuses of the day's top level tasks, in order */
    statuses: StatusKind[];
    done: number;
    blocked: number;
    /** Top level tasks that are not done or removed (they carry over to the next day) */
    carried: number;
    /** e.g. "1 done · 1 blocked · 3 carried" */
    text: string;
}

export function summarizeDay(lines: readonly string[], tabSize: number): DaySummary {
    const tasks = closestTasks(buildTree(lines, tabSize));
    const statuses = tasks.map(task => statusKind(task.status!));
    const done = statuses.filter(status => status === 'done').length;
    const blocked = statuses.filter(status => status === 'blocked').length;
    const carried = statuses.filter(status => status !== 'done' && status !== 'removed').length;
    const parts: string[] = [];
    if (done) {
        parts.push(`${done} done`);
    }
    if (blocked) {
        parts.push(`${blocked} blocked`);
    }
    if (carried) {
        parts.push(`${carried} carried`);
    }
    if (tasks.length === 0) {
        parts.push(lines.some(line => line.trim() !== '') ? 'Notes only' : 'Empty');
    }
    return { statuses, done, blocked, carried, text: parts.join(' · ') };
}

/**
 * Statuses of a task's direct sub-tasks (the closest tasks indented under it, looking through notes).
 * lines[0] is the task itself, followed by the lines below it in the same section.
 */
export function directSubtaskStatuses(lines: readonly string[], tabSize: number): string[] {
    const roots = buildTree(lines, tabSize);
    if (roots.length === 0 || roots[0].index !== 0) {
        return [];
    }
    return closestTasks(roots[0].children).map(task => task.status!);
}

/** Lines of a task's subtree: the lines after `line` until a non-blank line that is not indented deeper */
export function subtreeEnd(getLine: (i: number) => string, line: number, lastLine: number, tabSize: number): number {
    const base = getIndentWidth(getLine(line), tabSize);
    let end = line;
    for (let i = line + 1; i <= lastLine; i++) {
        const text = getLine(i);
        if (text.trim() === '') {
            continue;
        }
        if (getIndentWidth(text, tabSize) <= base || BOX_BORDER_REGEX.test(text) || DAY_HEADER_REGEX.test(text)) {
            break;
        }
        end = i;
    }
    return end;
}

// ---------------------------------------------------------------------------------------------
// Day boundaries without a full parse (used while filtering a transaction)

/** The day containing `line`: scans up to its header and down to its end. Same boundaries as documentParser. */
export function findDayAt(getLine: (i: number) => string, lineCount: number, line: number): { line: number; end: number } | undefined {
    let header = -1;
    for (let i = line; i >= 0; i--) {
        const text = getLine(i);
        if (DAY_HEADER_REGEX.test(text)) {
            header = i;
            break;
        }
        if (BOX_BORDER_REGEX.test(text)) {
            return undefined;
        }
    }
    if (header < 0) {
        return undefined;
    }
    return { line: header, end: findDayEnd(getLine, lineCount, header) };
}

function findDayEnd(getLine: (i: number) => string, lineCount: number, header: number): number {
    for (let i = header + 1; i < lineCount; i++) {
        const text = getLine(i);
        if (DAY_HEADER_REGEX.test(text) || BOX_BORDER_REGEX.test(text)) {
            return i - 1;
        }
    }
    return lineCount - 1;
}

/** All days that contain any line from `fromLine` to `toLine` */
export function daysTouching(getLine: (i: number) => string, lineCount: number, fromLine: number, toLine: number): { line: number; end: number }[] {
    const result: { line: number; end: number }[] = [];
    const first = findDayAt(getLine, lineCount, fromLine);
    let i = fromLine;
    if (first) {
        result.push(first);
        i = first.end + 1;
    }
    while (i <= toLine && i < lineCount) {
        if (DAY_HEADER_REGEX.test(getLine(i))) {
            const day = { line: i, end: findDayEnd(getLine, lineCount, i) };
            result.push(day);
            i = day.end + 1;
        } else {
            i++;
        }
    }
    return result;
}

// ---------------------------------------------------------------------------------------------
// Lists ("- ", "* ", "1. " notes)

function stopsListScan(text: string): boolean {
    return BOX_BORDER_REGEX.test(text) || DAY_HEADER_REGEX.test(text);
}

/**
 * The previous numbered item at indent width `width` before `line`, in the same list: scanning up, deeper
 * lines (sub-items and their notes) and blank lines are skipped, and any other line at that width, a
 * shallower line or a header ends the list. -1 if there is none.
 */
export function previousNumberedSibling(getLine: (i: number) => string, line: number, width: number, tabSize: number): number {
    for (let i = line - 1; i >= 0; i--) {
        const text = getLine(i);
        if (text.trim() === '') {
            continue;
        }
        if (stopsListScan(text)) {
            return -1;
        }
        const indent = getIndentWidth(text, tabSize);
        if (indent > width) {
            continue;
        }
        if (indent < width) {
            return -1;
        }
        return analyzeLine(text, tabSize).list?.kind === 'number' ? i : -1;
    }
    return -1;
}

/**
 * The number a numbered item is displayed with, like markdown: the first item of its list keeps its own
 * number, and each following sibling counts up from it, whatever number it has in the file.
 */
export function displayNumber(getLine: (i: number) => string, line: number, tabSize: number): number {
    const info = analyzeLine(getLine(line), tabSize);
    let first = info.list?.number ?? 1;
    let count = 0;
    for (let sibling = previousNumberedSibling(getLine, line, info.indentWidth, tabSize); sibling >= 0;
        sibling = previousNumberedSibling(getLine, sibling, info.indentWidth, tabSize)) {
        first = analyzeLine(getLine(sibling), tabSize).list!.number;
        count++;
    }
    return first + count;
}

/** How many list items a line is nested under (for bullets: •, then ◦, then ▪) */
export function listDepth(getLine: (i: number) => string, line: number, tabSize: number): number {
    let width = getIndentWidth(getLine(line), tabSize);
    let depth = 0;
    for (let i = line - 1; i >= 0 && width > 0; i--) {
        const text = getLine(i);
        if (text.trim() === '') {
            continue;
        }
        if (stopsListScan(text)) {
            break;
        }
        const indent = getIndentWidth(text, tabSize);
        if (indent < width) {
            if (analyzeLine(text, tabSize).list) {
                depth++;
            }
            width = indent;
        }
    }
    return depth;
}

export const BULLET_GLYPHS = ['•', '◦', '▪'];

// ---------------------------------------------------------------------------------------------
// Header spacing

/**
 * Whether a header gets breathing room above it: only when what shows right before it is content (a task,
 * note or list item, possibly followed by blank lines). Right after another header, a folded section
 * (`hiddenUntil`: the last line of the folded section before it, or -1) or at the top it stays compact,
 * so a stack of folded headers is dense.
 */
export function headerHasRoom(getLine: (i: number) => string, line: number, hiddenUntil: number): boolean {
    let previous = line - 1;
    while (previous >= 0 && previous > hiddenUntil && getLine(previous).trim() === '') {
        previous--;
    }
    if (previous < 0 || previous <= hiddenUntil) {
        return false;
    }
    const text = getLine(previous);
    return !(BOX_BORDER_REGEX.test(text) || DAY_HEADER_REGEX.test(text));
}

// ---------------------------------------------------------------------------------------------
// Where parent statuses are kept up to date: days, and list sections

export interface UpdateScope {
    kind: 'day' | 'list';
    /** First and last line of the content (for days, the line after the header) */
    start: number;
    end: number;
}

function isListBoxTitle(text: string): boolean {
    return LIST_TITLE_REGEX.test(text) && !DAILY_LOG_TITLE_REGEX.test(text) && !YEAR_TITLE_REGEX.test(text) && !MONTH_TITLE_REGEX.test(text);
}

/**
 * The section around a line whose parent statuses follow their sub-tasks: a list section (the lines after a list
 * box up to the line before the next box border, or the end of the file), or else a day (as documentParser).
 * Scans without a full parse, so it can run while filtering a transaction.
 */
export function updateScopeAt(getLine: (i: number) => string, lineCount: number, line: number): UpdateScope | undefined {
    let dayHeader = -1;
    for (let i = line; i >= 0; i--) {
        const text = getLine(i);
        if (BOX_BORDER_REGEX.test(text)) {
            if (i < line && i >= 2 && isListBoxTitle(getLine(i - 1)) && BOX_BORDER_REGEX.test(getLine(i - 2))) {
                let end = lineCount - 1;
                for (let j = i + 1; j < lineCount; j++) {
                    if (BOX_BORDER_REGEX.test(getLine(j))) {
                        end = j - 1;
                        break;
                    }
                }
                return { kind: 'list', start: i + 1, end };
            }
            break;
        }
        if (dayHeader < 0 && DAY_HEADER_REGEX.test(text)) {
            dayHeader = i;
        }
    }
    return dayHeader < 0 ? undefined : { kind: 'day', start: dayHeader + 1, end: findDayEnd(getLine, lineCount, dayHeader) };
}

/** All update scopes that contain any line from `fromLine` to `toLine` */
export function updateScopesTouching(getLine: (i: number) => string, lineCount: number, fromLine: number, toLine: number): UpdateScope[] {
    const scopes: UpdateScope[] = [];
    for (let i = fromLine; i <= toLine && i < lineCount;) {
        const scope = updateScopeAt(getLine, lineCount, i);
        if (scope && scope.end >= i) {
            scopes.push(scope);
            i = scope.end + 1;
        } else {
            i++;
        }
    }
    return scopes;
}

/** Whether a line is in a list section of the parsed structure (where parent statuses are kept up to date) */
export function inListSection(structure: DocStructure, line: number): boolean {
    return structure.boxes.some(box => box.kind === 'list' && line > box.line + 2 && line <= box.end);
}
