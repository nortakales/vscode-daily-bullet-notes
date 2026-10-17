// Moving items (tasks and notes) with everything indented under them: by dragging (drag.ts) and with
// Alt+Up / Alt+Down. Only depends on @codemirror/state (no DOM), so it can be unit tested in Node.

import { EditorSelection, EditorState, TransactionSpec } from '@codemirror/state';
import { getIndentWidth } from '../taskLogic';
import { configField, foldedSections, regionAt, structureField, tabHiddenLines, tabSizeOf } from './state';
import { analyzeLine, BOX_BORDER_REGEX, DAY_HEADER_REGEX, headerAt, subtreeEnd, updateScopeAt } from './structure';

/** Lines (0-based, inclusive) of an item and everything indented under it */
export interface ItemBlock {
    first: number;
    last: number;
}

function getLineOf(state: EditorState) {
    return (i: number) => state.doc.line(i + 1).text;
}

function isHeaderText(text: string): boolean {
    return BOX_BORDER_REGEX.test(text) || DAY_HEADER_REGEX.test(text);
}

/** Whether a line is a header or hidden (folded, or on the other tab) */
function isProtected(state: EditorState, line: number): boolean {
    if (headerAt(state.field(structureField), line) !== undefined) {
        return true;
    }
    if (foldedSections(state).some(section => section.line <= line && line <= section.end)) {
        return true;
    }
    const hidden = tabHiddenLines(state);
    return !!hidden && hidden.first <= line && line <= hidden.last;
}

/** The item on a line (a task or note in a day or list) with its subtree, or undefined if it can't move */
export function itemBlockAt(state: EditorState, line: number): ItemBlock | undefined {
    const doc = state.doc;
    if (line < 0 || line >= doc.lines) {
        return undefined;
    }
    const text = doc.line(line + 1).text;
    if (analyzeLine(text, tabSizeOf(state)).kind === 'blank' || isProtected(state, line) || !inSection(state, line)) {
        return undefined;
    }
    return { first: line, last: subtreeEnd(getLineOf(state), line, doc.lines - 1, tabSizeOf(state)) };
}

/** Whether a line is the content of a day or a list (or its header) */
function inSection(state: EditorState, line: number): boolean {
    const structure = state.field(structureField);
    if (structure.boxes.some(box => box.kind === 'list' && box.line + 2 === line)) {
        return true;
    }
    const scope = updateScopeAt(getLineOf(state), state.doc.lines, line);
    return !!scope && line <= scope.end && line >= scope.start - 1;
}

/** Indentation level of a line (indent width in tab stops) */
function levelOf(text: string, tabSize: number): number {
    return Math.floor(getIndentWidth(text, tabSize) / tabSize);
}

/**
 * Whether the block can be dropped in the gap before 0-based line `gap` (gap = line count: the end): the line
 * above must be in a day or a list (or be its header), not inside a folded section or the other tab.
 */
export function canDropAt(state: EditorState, block: ItemBlock, gap: number): boolean {
    const doc = state.doc;
    if (gap <= 0 || gap > doc.lines || (gap > block.first && gap <= block.last)) {
        return false;
    }
    const above = gap - 1;
    if (!inSection(state, above)) {
        return false;
    }
    const hidden = tabHiddenLines(state);
    if (hidden && hidden.first <= above && above <= hidden.last) {
        return false;
    }
    // Not between two lines of the same folded section
    return !foldedSections(state).some(section => section.line <= above && gap <= section.end);
}

/**
 * The levels the block may take in a gap: at most one deeper than the item above (0 under a header), and at
 * least as deep as the item below, so the block doesn't take the following items' parent away from them
 */
export function dropLevels(state: EditorState, block: ItemBlock, gap: number): { min: number; max: number } {
    const doc = state.doc;
    const tabSize = tabSizeOf(state);
    const outside = (i: number) => i < block.first || i > block.last;
    let max = 0;
    for (let i = gap - 1; i >= 0; i--) {
        if (!outside(i)) {
            continue;
        }
        const text = doc.line(i + 1).text;
        if (isHeaderText(text) || (i > 0 && BOX_BORDER_REGEX.test(doc.line(i).text) && /^\|/.test(text))) {
            break;
        }
        if (text.trim() !== '') {
            max = levelOf(text, tabSize) + 1;
            break;
        }
    }
    let min = 0;
    for (let i = gap; i < doc.lines; i++) {
        if (!outside(i)) {
            continue;
        }
        const text = doc.line(i + 1).text;
        if (isHeaderText(text)) {
            break;
        }
        if (text.trim() !== '') {
            min = levelOf(text, tabSize);
            break;
        }
    }
    return { min: Math.min(min, max), max };
}

/** The level of the block's first line */
export function blockLevel(state: EditorState, block: ItemBlock): number {
    return levelOf(state.doc.line(block.first + 1).text, tabSizeOf(state));
}

/** The block's lines re-indented so its first line is at `level` (the rest keep their depth under it) */
function reindented(state: EditorState, block: ItemBlock, level: number): string[] {
    const tabSize = tabSizeOf(state);
    const insertSpaces = state.field(configField).insertSpaces;
    const doc = state.doc;
    const baseWidth = getIndentWidth(doc.line(block.first + 1).text, tabSize);
    const delta = level * tabSize - baseWidth;
    const lines: string[] = [];
    for (let i = block.first; i <= block.last; i++) {
        const text = doc.line(i + 1).text;
        const info = analyzeLine(text, tabSize);
        if (info.kind === 'blank' || delta === 0) {
            lines.push(text);
            continue;
        }
        const width = Math.max(0, info.indentWidth + delta);
        const indent = insertSpaces ? ' '.repeat(width) : '\t'.repeat(Math.floor(width / tabSize)) + ' '.repeat(width % tabSize);
        lines.push(indent + text.slice(info.indentLength));
    }
    return lines;
}

/**
 * Moves the block to the gap before 0-based line `gap` at `level`, as one change (the parent statuses of both
 * places follow in the same transaction). The cursor goes to the end of the moved item's first line.
 */
export function moveBlockSpec(state: EditorState, block: ItemBlock, gap: number, level: number, userEvent = 'move.drop'): TransactionSpec | undefined {
    const doc = state.doc;
    const text = reindented(state, block, level).join('\n');
    const blockFrom = doc.line(block.first + 1).from, blockTo = doc.line(block.last + 1).to;
    if (gap === block.first || gap === block.last + 1) {
        if (text === doc.sliceString(blockFrom, blockTo)) {
            return undefined;
        }
        const firstLength = text.indexOf('\n') < 0 ? text.length : text.indexOf('\n');
        return {
            changes: { from: blockFrom, to: blockTo, insert: text },
            selection: EditorSelection.cursor(blockFrom + firstLength),
            userEvent, scrollIntoView: true,
        };
    }
    // Remove the block with one line break: the one after it, or before it at the end of the document
    const removal = block.last + 1 < doc.lines
        ? { from: blockFrom, to: doc.line(block.last + 2).from }
        : { from: doc.line(block.first).to, to: blockTo };
    const insertion = gap < doc.lines
        ? { from: doc.line(gap + 1).from, insert: text + '\n' }
        : { from: doc.length, insert: '\n' + text };
    const changes = state.changes([removal, insertion]);
    const start = changes.mapPos(insertion.from, -1) + (gap < doc.lines ? 0 : 1);
    const firstLength = text.indexOf('\n') < 0 ? text.length : text.indexOf('\n');
    return { changes, selection: EditorSelection.cursor(start + firstLength), userEvent, scrollIntoView: true };
}

// ---------------------------------------------------------------------------------------------
// Alt+Up / Alt+Down

/**
 * Moves the item on the cursor line (or the selected items) with everything under it, past the previous or next
 * item at the same level with everything under that, like outliners do. Next to anything else (a parent, a blank
 * line, a header) it moves past that one line, and across a header or folded section as a whole. Undefined when
 * the cursor isn't on an item.
 */
export function moveItemCommand(state: EditorState, direction: -1 | 1): TransactionSpec | undefined {
    if (state.selection.ranges.length !== 1) {
        return undefined;
    }
    const doc = state.doc;
    const tabSize = tabSizeOf(state);
    const main = state.selection.main;
    const firstLine = doc.lineAt(main.from).number - 1;
    let lastLine = doc.lineAt(main.to).number - 1;
    if (main.to > main.from && lastLine > firstLine && doc.line(lastLine + 1).from === main.to) {
        lastLine--;
    }
    const first = itemBlockAt(state, firstLine);
    if (!first) {
        return undefined;
    }
    // Every selected line with its subtree
    let last = first.last;
    for (let i = firstLine; i <= lastLine; i++) {
        if (isProtected(state, i)) {
            return undefined;
        }
        if (analyzeLine(doc.line(i + 1).text, tabSize).kind !== 'blank') {
            last = Math.max(last, subtreeEnd(getLineOf(state), i, doc.lines - 1, tabSize));
        }
    }
    const block: ItemBlock = { first: firstLine, last };
    const baseWidth = getIndentWidth(doc.line(firstLine + 1).text, tabSize);
    const offset = main.head - doc.line(firstLine + 1).from;
    const anchorOffset = main.anchor - doc.line(firstLine + 1).from;

    let unitFrom: number, unitTo: number;
    if (direction < 0) {
        if (firstLine === 0) {
            return undefined;
        }
        const region = regionAt(state, doc.line(firstLine).from);
        unitFrom = unitTo = firstLine - 1;
        if (region) {
            unitFrom = doc.lineAt(region.from).number - 1;
        } else {
            // The previous sibling with its subtree, if there is one
            for (let i = firstLine - 1; i >= 0; i--) {
                const text = doc.line(i + 1).text;
                if (text.trim() === '') {
                    continue;
                }
                if (isHeaderText(text) || isProtected(state, i)) {
                    break;
                }
                const width = getIndentWidth(text, tabSize);
                if (width === baseWidth) {
                    unitFrom = i;
                }
                if (width <= baseWidth) {
                    break;
                }
            }
        }
    } else {
        if (last + 1 >= doc.lines) {
            return undefined;
        }
        const region = regionAt(state, doc.line(last + 2).from);
        unitFrom = unitTo = last + 1;
        if (region) {
            unitTo = doc.lineAt(region.to).number - 1;
        } else {
            const text = doc.line(last + 2).text;
            if (text.trim() !== '' && getIndentWidth(text, tabSize) === baseWidth) {
                unitTo = subtreeEnd(getLineOf(state), last + 1, doc.lines - 1, tabSize);
            }
        }
    }

    // Swap the block and the unit
    const from = doc.line(Math.min(block.first, unitFrom) + 1).from;
    const to = doc.line(Math.max(block.last, unitTo) + 1).to;
    const blockText = doc.sliceString(doc.line(block.first + 1).from, doc.line(block.last + 1).to);
    const unitText = doc.sliceString(doc.line(unitFrom + 1).from, doc.line(unitTo + 1).to);
    const insert = direction < 0 ? blockText + '\n' + unitText : unitText + '\n' + blockText;
    const newFirstFrom = direction < 0 ? from : from + unitText.length + 1;
    return {
        changes: { from, to, insert },
        selection: EditorSelection.range(newFirstFrom + anchorOffset, newFirstFrom + offset),
        userEvent: 'move.line', scrollIntoView: true,
    };
}
