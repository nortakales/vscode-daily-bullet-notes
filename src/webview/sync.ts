// Conversions between CodeMirror changes and the host protocol. Pure (no DOM), unit tested in Node.

import { ChangeSet, Text } from '@codemirror/state';
import type { LineChange } from '../rendered/protocol';

/**
 * Converts all of a transaction's changes to the protocol's line/character changes, in coordinates of
 * the document before the transaction. CodeMirror reports them sorted and non-overlapping.
 */
export function toLineChanges(startDoc: Text, changes: ChangeSet): LineChange[] {
    const result: LineChange[] = [];
    changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        const fromLine = startDoc.lineAt(fromA);
        const toLine = startDoc.lineAt(toA);
        result.push({
            fromLine: fromLine.number - 1,
            fromCharacter: fromA - fromLine.from,
            toLine: toLine.number - 1,
            toCharacter: toA - toLine.from,
            text: inserted.toString(),
        });
    });
    return result;
}

/** The smallest single replacement (common prefix and suffix removed) that turns `from` into `to` */
export function minimalReplacement(from: string, to: string): { from: number; to: number; insert: string } | undefined {
    if (from === to) {
        return undefined;
    }
    const max = Math.min(from.length, to.length);
    let prefix = 0;
    while (prefix < max && from.charCodeAt(prefix) === to.charCodeAt(prefix)) {
        prefix++;
    }
    let suffix = 0;
    while (suffix < max - prefix && from.charCodeAt(from.length - 1 - suffix) === to.charCodeAt(to.length - 1 - suffix)) {
        suffix++;
    }
    return { from: prefix, to: from.length - suffix, insert: to.slice(prefix, to.length - suffix) };
}

/** Above this many differing lines a diff is just one replacement (Myers' algorithm is O((N+M)D)) */
const MAX_DIFF_LINES = 500;

/**
 * Small changes (sorted, non-overlapping, in coordinates of `from`) that turn `from` into `to`: a line diff
 * (Myers), each changed run of lines trimmed to the characters that differ. Unchanged lines between
 * changes stay untouched, so a pending local change on them maps over these changes intact.
 */
export function diffChanges(from: string, to: string): { from: number; to: number; insert: string }[] {
    if (from === to) {
        return [];
    }
    const a = from.split('\n'), b = to.split('\n');
    // Trim common lines at both ends before the expensive part
    let prefix = 0;
    while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) {
        prefix++;
    }
    let suffix = 0;
    while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) {
        suffix++;
    }
    const hunks = lineHunks(a.slice(prefix, a.length - suffix), b.slice(prefix, b.length - suffix));
    if (!hunks) {
        const single = minimalReplacement(from, to);
        return single ? [single] : [];
    }

    const starts: number[] = [];
    for (let i = 0, offset = 0; i < a.length; i++) {
        starts.push(offset);
        offset += a[i].length + 1;
    }
    const lineEnd = (i: number) => starts[i] + a[i].length;
    const changes: { from: number; to: number; insert: string }[] = [];
    for (const [aStart, aEnd, bStart, bEnd] of hunks) {
        const i = aStart + prefix, j = aEnd + prefix;
        const inserted = b.slice(bStart + prefix, bEnd + prefix).join('\n');
        let change: { from: number; to: number; insert: string };
        if (i < j && bStart < bEnd) {
            change = { from: starts[i], to: lineEnd(j - 1), insert: inserted };
        } else if (i < j) {
            // Lines removed: take a line break along
            change = j < a.length ? { from: starts[i], to: starts[j], insert: '' } : i > 0 ? { from: lineEnd(i - 1), to: from.length, insert: '' } : { from: 0, to: from.length, insert: '' };
        } else {
            // Lines added
            change = i < a.length ? { from: starts[i], to: starts[i], insert: inserted + '\n' } : { from: from.length, to: from.length, insert: '\n' + inserted };
        }
        const trimmed = minimalReplacement(from.slice(change.from, change.to), change.insert);
        if (trimmed) {
            changes.push({ from: change.from + trimmed.from, to: change.from + trimmed.to, insert: trimmed.insert });
        }
    }
    return changes;
}

/** Myers' diff of two line arrays: the runs that differ as [aStart, aEnd, bStart, bEnd], or undefined if too many */
function lineHunks(a: string[], b: string[]): [number, number, number, number][] | undefined {
    const n = a.length, m = b.length;
    const maxD = Math.min(n + m, MAX_DIFF_LINES);
    const offset = maxD + 1;
    const v = new Int32Array(2 * maxD + 3);
    const trace: Int32Array[] = [];
    let done = -1;
    for (let d = 0; d <= maxD && done < 0; d++) {
        trace.push(v.slice());
        for (let k = -d; k <= d; k += 2) {
            let x = (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) ? v[offset + k + 1] : v[offset + k - 1] + 1;
            let y = x - k;
            while (x < n && y < m && a[x] === b[y]) {
                x++;
                y++;
            }
            v[offset + k] = x;
            if (x >= n && y >= m) {
                done = d;
                break;
            }
        }
    }
    if (done < 0) {
        return undefined;
    }
    // Walk back to collect the matching lines
    const matches: [number, number][] = [];
    let x = n, y = m;
    for (let d = done; d >= 0; d--) {
        const previous = trace[d];
        const k = x - y;
        const previousK = (k === -d || (k !== d && previous[offset + k - 1] < previous[offset + k + 1])) ? k + 1 : k - 1;
        const previousX = d === 0 ? 0 : previous[offset + previousK];
        const previousY = d === 0 ? 0 : previousX - previousK;
        while (x > previousX && y > previousY) {
            x--;
            y--;
            matches.push([x, y]);
        }
        x = previousX;
        y = previousY;
    }
    matches.reverse();
    const hunks: [number, number, number, number][] = [];
    let ai = 0, bi = 0;
    for (const [mx, my] of matches) {
        if (mx > ai || my > bi) {
            hunks.push([ai, mx, bi, my]);
        }
        ai = mx + 1;
        bi = my + 1;
    }
    if (ai < n || bi < m) {
        hunks.push([ai, n, bi, m]);
    }
    return hunks;
}
