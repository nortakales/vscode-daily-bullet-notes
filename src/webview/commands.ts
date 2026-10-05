// Smart editing for the rendered view, as pure functions from an EditorState to a transaction spec.
// They return undefined when the default CodeMirror behavior should run instead, and an empty spec
// when the key is handled but nothing should change. No DOM, so they can be unit tested in Node.

import { ChangeSet, ChangeSpec, EditorSelection, EditorState, Line, TransactionSpec } from '@codemirror/state';
import type { StatusKey } from '../rendered/protocol';
import { analyzeLine, displayNumber, headerAt, previousNumberedSibling, STATUS_INFO, statusKind, subtreeEnd } from './structure';
import { configField, foldEffect, foldedSections, regionAt, structureField } from './state';

const NEW_TASK = '[ ] ';

function cursor(pos: number) {
    return EditorSelection.cursor(pos);
}

function settings(state: EditorState) {
    const config = state.field(configField);
    return { tabSize: config.tabSize > 0 ? config.tabSize : 4, insertSpaces: config.insertSpaces };
}

/** The change that indents (direction 1) or outdents (-1) a line by one level, or undefined */
export function indentLineChange(line: Line, direction: 1 | -1, tabSize: number, insertSpaces: boolean): ChangeSpec | undefined {
    const info = analyzeLine(line.text, tabSize);
    if (direction > 0) {
        const target = (Math.floor(info.indentWidth / tabSize) + 1) * tabSize;
        return { from: line.from + info.indentLength, insert: insertSpaces ? ' '.repeat(target - info.indentWidth) : '\t' };
    }
    if (info.indentWidth === 0) {
        return undefined;
    }
    // Keep the longest part of the indentation that fits in one level less
    const target = (Math.ceil(info.indentWidth / tabSize) - 1) * tabSize;
    let keep = 0, width = 0;
    for (let i = 0; i < info.indentLength; i++) {
        const w = line.text[i] === '\t' ? tabSize - (width % tabSize) : 1;
        if (width + w > target) {
            break;
        }
        width += w;
        keep = i + 1;
    }
    return { from: line.from + keep, to: line.from + info.indentLength };
}

/**
 * indentLineChange, and for a numbered list item also its new number: 1 when it starts a new list at its new
 * level, or the number after the numbered item it now follows. (The file's numbers aren't otherwise rewritten;
 * the view numbers items like markdown.)
 */
function indentListItemChange(state: EditorState, line: Line, direction: 1 | -1): ChangeSpec | undefined {
    const { tabSize, insertSpaces } = settings(state);
    const change = indentLineChange(line, direction, tabSize, insertSpaces) as { from: number; to?: number; insert?: string } | undefined;
    const info = analyzeLine(line.text, tabSize);
    if (!change || info.list?.kind !== 'number') {
        return change;
    }
    const width = direction > 0 ? (Math.floor(info.indentWidth / tabSize) + 1) * tabSize : (Math.ceil(info.indentWidth / tabSize) - 1) * tabSize;
    const getLine = (i: number) => state.doc.line(i + 1).text;
    const sibling = previousNumberedSibling(getLine, line.number - 1, width, tabSize);
    const number = String(sibling < 0 ? 1 : displayNumber(getLine, sibling, tabSize) + 1);
    const digits = info.list.text.slice(0, -1);
    if (number === digits) {
        return change;
    }
    // The indentation change ends where the number starts: one change for both
    const digitsFrom = line.from + info.indentLength;
    return { from: change.from, to: digitsFrom + digits.length, insert: (change.insert ?? '') + number };
}

/** Lines (1-based) that are box headers, day headers or inside a folded section */
function isProtectedLine(state: EditorState, lineNumber: number): boolean {
    const line = lineNumber - 1;
    return headerAt(state.field(structureField), line) !== undefined ||
        foldedSections(state).some(section => section.line <= line && line <= section.end);
}

// ---------------------------------------------------------------------------------------------
// Enter

export function enterCommand(state: EditorState): TransactionSpec | undefined {
    if (state.selection.ranges.length !== 1) {
        return undefined;
    }
    const { from, to } = state.selection.main;
    const doc = state.doc;
    const line = doc.lineAt(from);
    if (doc.lineAt(to).number !== line.number) {
        return undefined;
    }

    const region = regionAt(state, from);
    if (region) {
        if (region.kind === 'day' && from === region.to) {
            // Right after a day header: a new empty task as the first line of the day
            return { changes: { from: region.to, insert: '\n' + NEW_TASK }, selection: cursor(region.to + 1 + NEW_TASK.length), userEvent: 'input', scrollIntoView: true };
        }
        if (region.kind === 'folded') {
            return { effects: foldEffect.of({ keys: [region.key], folded: false }) };
        }
        if (region.kind === 'box' && from === region.to) {
            return { changes: { from: region.to, insert: '\n' }, selection: cursor(region.to + 1), userEvent: 'input', scrollIntoView: true };
        }
        if (region.kind === 'box' && from === region.from) {
            return { changes: { from: region.from, insert: '\n' }, selection: cursor(region.from), userEvent: 'input', scrollIntoView: true };
        }
        return {};
    }

    const { tabSize, insertSpaces } = settings(state);
    const info = analyzeLine(line.text, tabSize);
    const indent = line.text.slice(0, info.indentLength);
    const textStart = line.from + info.textStart;
    const start = Math.max(from, textStart);
    const end = Math.max(to, textStart);
    const after = doc.sliceString(end, line.to);
    const skip = after.length - after.trimStart().length;

    if (info.kind === 'task') {
        if (line.text.slice(info.textStart).trim() === '') {
            // Empty task: outdent it, or turn it into an empty line when it isn't indented
            if (info.indentWidth > 0) {
                const changes = ChangeSet.of(indentLineChange(line, -1, tabSize, insertSpaces)!, doc.length);
                return { changes, selection: cursor(changes.mapPos(textStart, 1)), userEvent: 'delete.dedent' };
            }
            return { changes: { from: line.from + info.boxStart, to: line.to }, selection: cursor(line.from + info.boxStart), userEvent: 'delete' };
        }
        if (start === textStart && end === textStart) {
            // At the start of the text: a new empty task above, the cursor stays with this task
            const insert = indent + NEW_TASK + '\n';
            return { changes: { from: line.from, insert }, selection: cursor(textStart + insert.length), userEvent: 'input', scrollIntoView: true };
        }
        const insert = '\n' + indent + NEW_TASK;
        return { changes: { from: start, to: end + skip, insert }, selection: cursor(start + insert.length), userEvent: 'input', scrollIntoView: true };
    }

    if (info.list) {
        const getLine = (i: number) => doc.line(i + 1).text;
        if (line.text.slice(info.textStart).trim() === '') {
            // Empty list item: outdent it, or remove the marker when it isn't indented
            if (info.indentWidth > 0) {
                const changes = ChangeSet.of(indentListItemChange(state, line, -1)!, doc.length);
                return { changes, selection: cursor(changes.mapPos(textStart, 1)), userEvent: 'delete.dedent' };
            }
            return { changes: { from: line.from + info.indentLength, to: line.to }, selection: cursor(line.from + info.indentLength), userEvent: 'delete' };
        }
        const number = info.list.kind === 'number' ? displayNumber(getLine, line.number - 1, tabSize) : 0;
        if (start === textStart && end === textStart) {
            // At the start of the text: a new empty item above, the cursor stays with this item
            const insert = indent + (info.list.kind === 'number' ? `${number}.` : info.list.text) + ' \n';
            return { changes: { from: line.from, insert }, selection: cursor(textStart + insert.length), userEvent: 'input', scrollIntoView: true };
        }
        const insert = '\n' + indent + (info.list.kind === 'number' ? `${number + 1}.` : info.list.text) + ' ';
        return { changes: { from: start, to: end + skip, insert }, selection: cursor(start + insert.length), userEvent: 'input', scrollIntoView: true };
    }

    // Notes and blank lines: a new line with the same indentation
    const insert = '\n' + indent;
    return { changes: { from: start, to: end + skip, insert }, selection: cursor(start + insert.length), userEvent: 'input', scrollIntoView: true };
}

// ---------------------------------------------------------------------------------------------
// Backspace and Delete

export function backspaceCommand(state: EditorState): TransactionSpec | undefined {
    if (state.selection.ranges.length !== 1 || !state.selection.main.empty) {
        return undefined;
    }
    const pos = state.selection.main.head;
    const doc = state.doc;
    if (regionAt(state, pos)) {
        // Never delete into a header or a folded section
        return {};
    }
    const line = doc.lineAt(pos);
    const { tabSize, insertSpaces } = settings(state);
    const info = analyzeLine(line.text, tabSize);
    const textStart = line.from + info.textStart;
    if (pos > textStart) {
        return undefined;
    }
    if (info.kind === 'task') {
        // Remove the box and its space: the task becomes a note
        return { changes: { from: line.from + info.boxStart, to: textStart }, selection: cursor(line.from + info.boxStart), userEvent: 'delete.backward' };
    }
    if (info.list) {
        // Remove the list marker and its space: the item becomes a plain note
        return { changes: { from: line.from + info.indentLength, to: textStart }, selection: cursor(line.from + info.indentLength), userEvent: 'delete.backward' };
    }
    if (info.indentWidth > 0) {
        const changes = ChangeSet.of(indentLineChange(line, -1, tabSize, insertSpaces)!, doc.length);
        return { changes, selection: cursor(changes.mapPos(textStart, 1)), userEvent: 'delete.dedent' };
    }
    if (line.number === 1) {
        return {};
    }
    const previous = doc.line(line.number - 1);
    const previousRegion = regionAt(state, previous.to);
    if (previousRegion) {
        // Never join a line into a header. An empty line can still be deleted.
        if (line.length > 0) {
            return {};
        }
        if (previousRegion.kind !== 'day' && line.number < doc.lines) {
            // Under a box: delete the line forward, so the cursor stays below the box
            const next = doc.line(line.number + 1);
            const nextRegion = regionAt(state, next.from);
            const offset = nextRegion ? (nextRegion.kind === 'day' ? next.length : 0) : analyzeLine(next.text, tabSize).textStart;
            return { changes: { from: line.to, to: line.to + 1 }, selection: cursor(line.from + offset), userEvent: 'delete.backward' };
        }
        return { changes: { from: previous.to, to: line.to }, selection: cursor(previous.to), userEvent: 'delete.backward' };
    }
    return { changes: { from: previous.to, to: line.from }, selection: cursor(previous.to), userEvent: 'delete.backward' };
}

export function deleteForwardCommand(state: EditorState): TransactionSpec | undefined {
    if (state.selection.ranges.length !== 1 || !state.selection.main.empty) {
        return undefined;
    }
    const pos = state.selection.main.head;
    const doc = state.doc;
    const line = doc.lineAt(pos);
    const here = regionAt(state, pos);
    if (pos !== line.to) {
        return here ? {} : undefined;
    }
    if (line.number === doc.lines) {
        return {};
    }
    const next = doc.line(line.number + 1);
    if (here) {
        // At the end of a header: only an empty next line can be removed
        if (next.length === 0 && !regionAt(state, next.from)) {
            return { changes: { from: line.to, to: next.from }, userEvent: 'delete.forward' };
        }
        return {};
    }
    if (regionAt(state, next.from)) {
        if (line.length > 0) {
            return {};
        }
        if (line.number > 1) {
            return { changes: { from: line.from - 1, to: line.to }, selection: cursor(line.from - 1), userEvent: 'delete.forward' };
        }
        return { changes: { from: line.from, to: next.from }, userEvent: 'delete.forward' };
    }
    // Join the next line's text onto this one, without its indentation and box
    const nextInfo = analyzeLine(next.text, settings(state).tabSize);
    return { changes: { from: line.to, to: next.from + nextInfo.textStart }, selection: cursor(line.to), userEvent: 'delete.forward' };
}

// ---------------------------------------------------------------------------------------------
// Tab and Shift+Tab

/** Indents (1) or outdents (-1) the selected lines. A single line takes its subtree along. */
export function indentCommand(state: EditorState, direction: 1 | -1): TransactionSpec {
    const doc = state.doc;
    const { tabSize, insertSpaces } = settings(state);
    const lineNumbers = new Set<number>();
    for (const range of state.selection.ranges) {
        const first = doc.lineAt(range.from).number;
        let last = doc.lineAt(range.to).number;
        if (range.to > range.from && last > first && doc.line(last).from === range.to) {
            last--;
        }
        for (let n = first; n <= last; n++) {
            lineNumbers.add(n);
        }
    }

    let targets: number[];
    if (lineNumbers.size === 1) {
        const n = [...lineNumbers][0];
        if (isProtectedLine(state, n)) {
            return {};
        }
        const line = doc.line(n);
        if (direction < 0 && analyzeLine(line.text, tabSize).indentWidth === 0) {
            return {};
        }
        targets = [n];
        if (line.text.trim() !== '') {
            const end = subtreeEnd(i => doc.line(i + 1).text, n - 1, doc.lines - 1, tabSize);
            for (let i = n + 1; i <= end + 1; i++) {
                if (doc.line(i).text.trim() !== '') {
                    targets.push(i);
                }
            }
        }
    } else {
        targets = [...lineNumbers].sort((a, b) => a - b)
            .filter(n => doc.line(n).text.trim() !== '' && !isProtectedLine(state, n));
    }

    // A single numbered item gets the number of its new place; the lines moving along keep theirs
    const single = lineNumbers.size === 1;
    const changes = targets.map((n, index) => single && index === 0 ? indentListItemChange(state, doc.line(n), direction) : indentLineChange(doc.line(n), direction, tabSize, insertSpaces))
        .filter((change): change is ChangeSpec => !!change);
    if (changes.length === 0) {
        return {};
    }
    const changeSet = ChangeSet.of(changes, doc.length);
    return {
        changes: changeSet,
        selection: state.selection.map(changeSet, 1),
        userEvent: direction > 0 ? 'input.indent' : 'delete.dedent',
        scrollIntoView: true,
    };
}

// ---------------------------------------------------------------------------------------------
// Status

/** Replaces only the status character(s) inside a task's box. lineNumber is 1-based. */
export function setStatusCommand(state: EditorState, lineNumber: number, status: StatusKey): TransactionSpec | undefined {
    if (lineNumber < 1 || lineNumber > state.doc.lines) {
        return undefined;
    }
    const line = state.doc.line(lineNumber);
    const info = analyzeLine(line.text, settings(state).tabSize);
    if (info.kind !== 'task' || statusKind(info.status) === status) {
        return undefined;
    }
    return {
        changes: { from: line.from + info.boxStart + 1, to: line.from + info.boxEnd - 1, insert: STATUS_INFO[status].char },
        userEvent: 'input.status',
    };
}

// ---------------------------------------------------------------------------------------------
// Cursor movement

/** Start of a line's editable text (after its indentation and box) */
export function textStartOf(state: EditorState, line: Line): number {
    return line.from + analyzeLine(line.text, settings(state).tabSize).textStart;
}

/** ArrowLeft at the start of a line's text skips the hidden indentation and box to the previous line */
export function arrowLeftCommand(state: EditorState): TransactionSpec | undefined {
    const main = state.selection.main;
    if (state.selection.ranges.length !== 1 || !main.empty) {
        return undefined;
    }
    const line = state.doc.lineAt(main.head);
    const textStart = textStartOf(state, line);
    if (main.head !== textStart || textStart === line.from || regionAt(state, main.head)) {
        return undefined;
    }
    if (line.number === 1) {
        return {};
    }
    return { selection: cursor(line.from - 1), scrollIntoView: true, userEvent: 'select' };
}

// ---------------------------------------------------------------------------------------------
// Alt+Up / Alt+Down

/** Moves the selected lines past the line above or below, treating a header or folded section as one line */
export function moveLinesCommand(state: EditorState, direction: -1 | 1): TransactionSpec {
    if (state.selection.ranges.length !== 1) {
        return {};
    }
    const doc = state.doc;
    const main = state.selection.main;
    const first = doc.lineAt(main.from).number;
    let last = doc.lineAt(main.to).number;
    if (main.to > main.from && last > first && doc.line(last).from === main.to) {
        last--;
    }
    for (let n = first; n <= last; n++) {
        if (isProtectedLine(state, n)) {
            return {};
        }
    }
    const blockFrom = doc.line(first).from, blockTo = doc.line(last).to;
    const block = doc.sliceString(blockFrom, blockTo);

    if (direction < 0) {
        if (first === 1) {
            return {};
        }
        const above = doc.line(first - 1);
        const region = regionAt(state, above.from);
        const unitFrom = region ? doc.lineAt(region.from).from : above.from;
        const unit = doc.sliceString(unitFrom, above.to);
        const shift = -(unit.length + 1);
        return {
            changes: { from: unitFrom, to: blockTo, insert: block + '\n' + unit },
            selection: EditorSelection.range(main.anchor + shift, main.head + shift),
            userEvent: 'move.line', scrollIntoView: true,
        };
    }
    if (last === doc.lines) {
        return {};
    }
    const below = doc.line(last + 1);
    const region = regionAt(state, below.to);
    const unitTo = region ? doc.lineAt(region.to).to : below.to;
    const unit = doc.sliceString(below.from, unitTo);
    const shift = unit.length + 1;
    return {
        changes: { from: blockFrom, to: unitTo, insert: unit + '\n' + block },
        selection: EditorSelection.range(main.anchor + shift, main.head + shift),
        userEvent: 'move.line', scrollIntoView: true,
    };
}
