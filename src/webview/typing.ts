// Groups bursts of plain typing into one 'edit' message, so VS Code makes one undo step of them.
// Pure (no DOM, no timers): main.ts owns the timers and keyboard/window events and calls into this.
//
// A pending group holds the document as of the last edit sent (base) and the composed changes since.
// Anything that isn't plain typing on the group's line sends the group first, then itself, in order.

import { Annotation, ChangeSet, EditorSelection, EditorState, Text, Transaction, TransactionSpec } from '@codemirror/state';
import type { LineChange } from '../rendered/protocol';
import { configField, lineSignature, remoteAnnotation } from './state';
import { diffChanges, toLineChanges } from './sync';

/** Marks the buffer's own local transactions (reverting or re-applying a group, rebasing on an update) */
export const typingBufferAnnotation = Annotation.define<boolean>();

/**
 * The 1-based line a transaction typed on, if it is plain typing: a local typing or character deletion
 * whose changes stay within one line, insert no line break, and don't change what the line is (task or
 * note, status, indentation). Undefined for anything else.
 */
export function typingLine(tr: Transaction): number | undefined {
    if (!tr.docChanged || tr.annotation(remoteAnnotation)) {
        return undefined;
    }
    if (!(tr.isUserEvent('input.type') || tr.isUserEvent('delete.backward') || tr.isUserEvent('delete.forward') || tr.isUserEvent('delete.selection'))) {
        return undefined;
    }
    const startDoc = tr.startState.doc;
    let line = -1;
    let plain = true;
    tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        if (!plain) {
            return;
        }
        const first = startDoc.lineAt(fromA).number;
        if (inserted.lines > 1 || startDoc.lineAt(toA).number !== first || (line >= 0 && first !== line)) {
            plain = false;
            return;
        }
        line = first;
    });
    if (!plain || line < 0) {
        return undefined;
    }
    const tabSize = tr.startState.field(configField, false)?.tabSize ?? 4;
    if (lineSignature(startDoc.line(line).text, tabSize) !== lineSignature(tr.newDoc.line(line).text, tabSize)) {
        return undefined;
    }
    return line;
}

export interface PendingTyping {
    /** The document as of the last edit sent to the host */
    base: Text;
    /** Composed changes from base to the current document */
    changes: ChangeSet;
    /** 1-based line being typed on (typing never adds or removes lines, so base and current agree) */
    line: number;
    /** Selection before the burst, in base coordinates (restored when the burst is undone) */
    selectionBefore: EditorSelection;
    /** When the burst started (ms, caller's clock) */
    startedAt: number;
}

function firstChangedLine(doc: Text, changes: ChangeSet): number {
    let line = -1;
    changes.iterChangedRanges(fromA => {
        if (line < 0) {
            line = doc.lineAt(fromA).number;
        }
    });
    return line;
}

export type TransactionResult =
    /** Held back in the pending group (a new group if `started`) */
    | { kind: 'grouped'; started: boolean }
    /** Sent (after sending any pending group first) */
    | { kind: 'sent' }
    /** Nothing to do with sending (selection moves, remote changes) */
    | { kind: 'none' };

export class TypingBuffer {
    private group: PendingTyping | undefined;
    /** A burst reverted by a local undo, until anything else changes the document */
    private reverted: { changes: ChangeSet; selectionAfter: EditorSelection; line: number } | undefined;

    /** `send` posts one 'edit' with changes in coordinates of the document as of the previous edit */
    constructor(private readonly send: (changes: LineChange[]) => void) { }

    get pending(): PendingTyping | undefined {
        return this.group;
    }

    get canRedo(): boolean {
        return this.reverted !== undefined;
    }

    reset() {
        this.group = undefined;
        this.reverted = undefined;
    }

    /** Call for every transaction the view applied, in order */
    handleTransaction(tr: Transaction, now: number): TransactionResult {
        if (tr.annotation(typingBufferAnnotation)) {
            return { kind: 'none' };
        }
        if (tr.annotation(remoteAnnotation)) {
            if (tr.docChanged) {
                this.reverted = undefined;
            }
            return { kind: 'none' };
        }
        if (!tr.docChanged) {
            if (this.group && tr.selection && tr.newDoc.lineAt(tr.newSelection.main.head).number !== this.group.line) {
                this.flush();
            }
            return { kind: 'none' };
        }

        this.reverted = undefined;
        const line = typingLine(tr);
        if (line !== undefined && this.group && this.group.line === line) {
            this.group.changes = this.group.changes.compose(tr.changes);
            if (this.group.changes.empty) {
                // Typed and deleted back to the base: nothing to send
                this.group = undefined;
            }
            return { kind: 'grouped', started: false };
        }
        this.flush();
        if (line !== undefined) {
            this.group = { base: tr.startState.doc, changes: tr.changes, line, selectionBefore: tr.startState.selection, startedAt: now };
            return { kind: 'grouped', started: true };
        }
        this.send(toLineChanges(tr.startState.doc, tr.changes));
        return { kind: 'sent' };
    }

    /** Sends the pending group, if any */
    flush() {
        const group = this.group;
        this.group = undefined;
        if (group && !group.changes.empty) {
            this.send(toLineChanges(group.base, group.changes));
        }
    }

    /**
     * Undo of the current burst: a local transaction (never sent) back to the document as of the last
     * edit. Undefined when no burst is pending (VS Code's undo should run instead).
     */
    revert(state: EditorState): TransactionSpec | undefined {
        const group = this.group;
        if (!group) {
            return undefined;
        }
        this.group = undefined;
        this.reverted = { changes: group.changes, selectionAfter: state.selection, line: group.line };
        return {
            changes: group.changes.invert(group.base),
            selection: group.selectionBefore,
            annotations: [remoteAnnotation.of(true), typingBufferAnnotation.of(true), Transaction.addToHistory.of(false)],
            scrollIntoView: true,
        };
    }

    /** Redo right after a local undo: re-applies the burst as a new pending group */
    redo(state: EditorState, now: number): TransactionSpec | undefined {
        const reverted = this.reverted;
        if (!reverted) {
            return undefined;
        }
        this.reverted = undefined;
        this.flush();
        this.group = { base: state.doc, changes: reverted.changes, line: reverted.line, selectionBefore: state.selection, startedAt: now };
        return {
            changes: reverted.changes,
            selection: reverted.selectionAfter,
            annotations: [remoteAnnotation.of(true), typingBufferAnnotation.of(true), Transaction.addToHistory.of(false)],
            scrollIntoView: true,
        };
    }

    /**
     * Adopts the host's text while keeping the pending burst: with E the change from the base to the
     * new text and P the burst, the document gets E mapped over P, and the burst becomes P mapped over E
     * (based on the new text). Returns the changes to apply to the current document (as a remote
     * transaction), or undefined if there is nothing to change.
     */
    rebase(doc: Text, text: string): ChangeSet | undefined {
        this.reverted = undefined;
        const group = this.group;
        const base = group ? group.base : doc;
        // A line diff, so lines the external change didn't touch (like the one being typed on) stay intact
        const external = ChangeSet.of(diffChanges(base.toString(), text), base.length);
        if (!group) {
            return external.empty ? undefined : external;
        }
        const pending = group.changes.map(external);
        const toApply = external.map(group.changes, true);
        const newBase = external.apply(group.base);
        if (pending.empty) {
            this.group = undefined;
        } else {
            this.group = {
                base: newBase,
                changes: pending,
                line: firstChangedLine(newBase, pending),
                selectionBefore: group.selectionBefore.map(external),
                startedAt: group.startedAt,
            };
        }
        return toApply.empty ? undefined : toApply;
    }
}
