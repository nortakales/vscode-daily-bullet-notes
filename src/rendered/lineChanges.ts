// Pure helpers for the rendered view's line/character based changes (no vscode import, unit tested)

import { LineChange } from './protocol';

/** The rendered view always works with '\n' line breaks, whatever the document's EOL */
export function toLf(text: string): string {
    return text.replace(/\r\n/g, '\n');
}

/**
 * Applies changes (sorted, non-overlapping, in coordinates of `text`) to '\n' separated text.
 * Returns undefined if any change refers to a position that doesn't exist.
 */
export function applyLineChanges(text: string, changes: LineChange[]): string | undefined {
    const lineStarts = [0];
    for (let i = 0; i < text.length; i++) {
        if (text.charCodeAt(i) === 10) {
            lineStarts.push(i + 1);
        }
    }
    const offsetOf = (line: number, character: number): number | undefined => {
        if (line < 0 || line >= lineStarts.length || character < 0) {
            return undefined;
        }
        const lineEnd = line + 1 < lineStarts.length ? lineStarts[line + 1] - 1 : text.length;
        if (lineStarts[line] + character > lineEnd) {
            return undefined;
        }
        return lineStarts[line] + character;
    };

    let result = '';
    let copiedUpTo = 0;
    for (const change of changes) {
        const from = offsetOf(change.fromLine, change.fromCharacter);
        const to = offsetOf(change.toLine, change.toCharacter);
        if (from === undefined || to === undefined || from > to || from < copiedUpTo) {
            return undefined;
        }
        result += text.slice(copiedUpTo, from) + change.text;
        copiedUpTo = to;
    }
    return result + text.slice(copiedUpTo);
}
