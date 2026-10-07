import * as assert from 'assert';
import { EditorSelection, EditorState, TransactionSpec } from '@codemirror/state';
import type { LineChange, ViewConfig } from '../rendered/protocol';
import { applyLineChanges } from '../rendered/lineChanges';
import { enterCommand, setStatusCommand } from '../webview/commands';
import { dbmStateExtensions, remoteAnnotation } from '../webview/state';
import { diffChanges } from '../webview/sync';
import { TypingBuffer, typingLine } from '../webview/typing';
import { sampleLines } from './webviewStructure.test';

const CONFIG: ViewConfig = { automaticStatusUpdates: true, tabSize: 4, insertSpaces: true, today: { year: 2026, month: 10, day: 4 }, centered: true, cursor: { style: 'line', width: 0, blinking: 'blink' }, pinToolbar: true, pinHeaders: true, tabs: false };

const TEXT = sampleLines([
    '#box Daily Log', '#box 2026', '#box October', '#day 10/4',
    '[ ] parent',
    '    [ ] child one',
    '    [ ] child two',
    'a note',
    '',
    '#box List',
    'item',
]).join('\n');

/** An editor state, a typing buffer and a simulated host that applies every edit it receives */
class Harness {
    state: EditorState;
    host: string;
    readonly sent: LineChange[][] = [];
    readonly buffer: TypingBuffer;
    now = 0;

    constructor(text = TEXT) {
        this.state = EditorState.create({ doc: text, extensions: dbmStateExtensions(CONFIG) });
        this.host = text;
        this.buffer = new TypingBuffer(changes => {
            this.sent.push(changes);
            const result = applyLineChanges(this.host, changes);
            assert.ok(result !== undefined, 'the host could apply the edit');
            this.host = result!;
        });
    }

    dispatch(spec: TransactionSpec) {
        const tr = this.state.update(spec);
        this.state = tr.state;
        this.now += 100;
        return this.buffer.handleTransaction(tr, this.now);
    }

    lineStart(text: string) {
        const index = this.state.doc.toString().indexOf(text);
        assert.ok(index >= 0, text);
        return index;
    }

    /** Types characters one transaction at a time at the cursor */
    type(text: string) {
        for (const ch of text) {
            const head = this.state.selection.main.head;
            this.dispatch({ changes: { from: head, insert: ch }, selection: EditorSelection.cursor(head + 1), userEvent: 'input.type' });
        }
    }

    backspace(count = 1) {
        for (let i = 0; i < count; i++) {
            const head = this.state.selection.main.head;
            this.dispatch({ changes: { from: head - 1, to: head }, selection: EditorSelection.cursor(head - 1), userEvent: 'delete.backward' });
        }
    }

    cursorTo(pos: number) {
        return this.dispatch({ selection: EditorSelection.cursor(pos), userEvent: 'select' });
    }

    /** An outside change: the host's text changes and the webview gets an 'update' */
    external(text: string) {
        this.host = text;
        const changes = this.buffer.rebase(this.state.doc, text);
        if (changes) {
            this.dispatch({ changes, annotations: remoteAnnotation.of(true) });
        }
    }

    converged() {
        this.buffer.flush();
        assert.strictEqual(this.host, this.state.doc.toString());
    }
}

suite('Webview typing groups: what counts as typing', () => {

    function classify(spec: (state: EditorState) => TransactionSpec, text = TEXT): number | undefined {
        const state = EditorState.create({ doc: text, extensions: dbmStateExtensions(CONFIG) });
        return typingLine(state.update(spec(state)));
    }
    const at = (text: string, offset = 0) => TEXT.indexOf(text) + offset;
    const line = (text: string) => TEXT.slice(0, TEXT.indexOf(text)).split('\n').length;

    test('typing, deleting characters and typing over a selection on one line', () => {
        assert.strictEqual(classify(() => ({ changes: { from: at('child one', 5), insert: 'x' }, userEvent: 'input.type' })), line('child one'));
        assert.strictEqual(classify(() => ({ changes: { from: at('child one', 5), to: at('child one', 6) }, userEvent: 'delete.backward' })), line('child one'));
        assert.strictEqual(classify(() => ({ changes: { from: at('a note'), to: at('a note', 6), insert: 'memo' }, userEvent: 'input.type' })), line('a note'));
        assert.strictEqual(classify(() => ({ changes: { from: at('item', 4), insert: 'é' }, userEvent: 'input.type.compose' })), line('item'));
    });

    test('not typing: line breaks, other lines, structure, status, paste, remote', () => {
        assert.strictEqual(classify(() => ({ changes: { from: at('a note', 6), insert: '\n' }, userEvent: 'input.type' })), undefined);
        assert.strictEqual(classify(() => ({ changes: { from: at('a note') - 1, to: at('a note') }, userEvent: 'delete.backward' })), undefined);
        assert.strictEqual(classify(() => ({ changes: [{ from: at('child one'), insert: 'x' }, { from: at('child two'), insert: 'y' }], userEvent: 'input.type' })), undefined);
        // Typing box syntax turns a note into a task, Backspace on a box turns a task into a note
        assert.strictEqual(classify(() => ({ changes: { from: at('a note'), insert: '[]' }, userEvent: 'input.type' })), undefined);
        assert.strictEqual(classify(() => ({ changes: { from: at('[ ] parent'), to: at('[ ] parent', 4) }, userEvent: 'delete.backward' })), undefined);
        assert.strictEqual(classify(() => ({ changes: { from: at('a note'), insert: '    ' }, userEvent: 'input.type' })), undefined);
        assert.strictEqual(classify(state => setStatusCommand(state, line('child one'), 'done')!), undefined);
        assert.strictEqual(classify(() => ({ changes: { from: at('item', 4), insert: 'x' }, userEvent: 'input.paste' })), undefined);
        assert.strictEqual(classify(() => ({ changes: { from: at('item', 4), insert: 'x' }, annotations: remoteAnnotation.of(true), userEvent: 'input.type' })), undefined);
    });
});

suite('Webview typing groups: buffering', () => {

    test('a burst on one line is held back and sent as one edit', () => {
        const h = new Harness();
        h.cursorTo(h.lineStart('child one') + 'child one'.length);
        h.type(' now');
        h.backspace();
        h.type('w!');
        assert.strictEqual(h.sent.length, 0);
        h.buffer.flush();
        assert.strictEqual(h.sent.length, 1);
        assert.deepStrictEqual(h.sent[0].map(change => change.text), [' now!']);
        assert.strictEqual(h.host, h.state.doc.toString());
    });

    test('typing then deleting it all sends nothing', () => {
        const h = new Harness();
        h.cursorTo(h.lineStart('a note') + 6);
        h.type('xyz');
        h.backspace(3);
        assert.strictEqual(h.buffer.pending, undefined);
        h.buffer.flush();
        assert.strictEqual(h.sent.length, 0);
        assert.strictEqual(h.host, h.state.doc.toString());
    });

    test('typing on another line sends the first burst and starts a new one', () => {
        const h = new Harness();
        h.cursorTo(h.lineStart('a note') + 6);
        h.type('AAA');
        const other = h.lineStart('item') + 4;
        const result = h.dispatch({ changes: { from: other, insert: 'B' }, selection: EditorSelection.cursor(other + 1), userEvent: 'input.type' });
        assert.deepStrictEqual(result, { kind: 'grouped', started: true });
        assert.deepStrictEqual(h.sent.map(changes => changes[0].text), ['AAA']);
        h.converged();
        assert.strictEqual(h.sent.length, 2);
    });

    test('moving the cursor to another line sends the burst, moving along the line does not', () => {
        const h = new Harness();
        h.cursorTo(h.lineStart('a note') + 6);
        h.type('xy');
        h.cursorTo(h.lineStart('a note') + 2);
        assert.strictEqual(h.sent.length, 0);
        h.cursorTo(h.lineStart('item'));
        assert.strictEqual(h.sent.length, 1);
        assert.strictEqual(h.host, h.state.doc.toString());
    });

    test('Enter sends the burst first, then itself', () => {
        const h = new Harness();
        h.cursorTo(h.lineStart('child two') + 'child two'.length);
        h.type(' done');
        assert.deepStrictEqual(h.dispatch(enterCommand(h.state)!), { kind: 'sent' });
        assert.strictEqual(h.sent.length, 2);
        assert.deepStrictEqual(h.sent[0].map(change => change.text), [' done']);
        assert.ok(h.sent[1].some(change => change.text === '\n    [ ] '));
        assert.strictEqual(h.host, h.state.doc.toString());
    });

    test('a status change sends the burst first, then the status with its parent updates', () => {
        const h = new Harness();
        h.cursorTo(h.lineStart('a note') + 6);
        h.type('!!');
        const childLine = h.state.doc.lineAt(h.lineStart('child one')).number;
        h.dispatch(setStatusCommand(h.state, childLine, 'done')!);
        assert.strictEqual(h.sent.length, 2);
        assert.deepStrictEqual(h.sent[1].map(change => change.text), ['+', 'x']);
        assert.strictEqual(h.host, h.state.doc.toString());
    });

    test('undo reverts the burst locally and redo brings it back as a pending burst', () => {
        const h = new Harness();
        const before = h.state.doc.toString();
        const start = h.lineStart('a note') + 6;
        h.cursorTo(start);
        h.type(' typed');
        const typed = h.state.doc.toString();
        const undo = h.buffer.revert(h.state)!;
        assert.ok(undo);
        h.dispatch(undo);
        assert.strictEqual(h.state.doc.toString(), before);
        assert.strictEqual(h.state.selection.main.head, start);
        assert.strictEqual(h.sent.length, 0);
        assert.ok(h.buffer.canRedo);
        h.dispatch(h.buffer.redo(h.state, h.now)!);
        assert.strictEqual(h.state.doc.toString(), typed);
        assert.strictEqual(h.state.selection.main.head, start + ' typed'.length);
        assert.ok(h.buffer.pending);
        h.converged();
        assert.strictEqual(h.sent.length, 1);
    });

    test('nothing to undo or redo locally without a burst or after another change', () => {
        const h = new Harness();
        assert.strictEqual(h.buffer.revert(h.state), undefined);
        h.cursorTo(h.lineStart('a note') + 6);
        h.type('x');
        h.dispatch(h.buffer.revert(h.state)!);
        h.type('y');
        assert.ok(!h.buffer.canRedo);
        assert.strictEqual(h.buffer.redo(h.state, h.now), undefined);
        h.converged();
    });

    test('an update while a burst is pending keeps the burst, rebased onto the new text', () => {
        const h = new Harness();
        h.cursorTo(h.lineStart('child two') + 'child two'.length);
        h.type(' kept');
        h.external(h.host.replace('[ ] parent', '[ ] parent renamed').replace('a note', 'a note\nan inserted line'));
        assert.strictEqual(h.state.doc.toString(), h.host.replace('child two', 'child two kept'));
        assert.strictEqual(h.sent.length, 0);
        h.type('!');
        h.converged();
        assert.ok(h.host.includes('    [ ] child two kept!') && h.host.includes('[ ] parent renamed') && h.host.includes('an inserted line'));
        assert.strictEqual(h.sent.length, 1);
    });

    test('an update that edits the same line still converges', () => {
        const h = new Harness();
        const start = h.lineStart('a note') + 2;
        h.cursorTo(start);
        h.type('XY');
        h.external(h.host.replace('a note', 'a long note'));
        h.converged();
        assert.ok(h.host.includes('XY'), h.host);
    });

    test('without a burst, an update is just the minimal change', () => {
        const h = new Harness();
        const changes = h.buffer.rebase(h.state.doc, TEXT.replace('item', 'items'))!;
        const parts: [number, number, string][] = [];
        changes.iterChanges((from, to, _fromB, _toB, inserted) => parts.push([from, to, inserted.toString()]));
        assert.deepStrictEqual(parts, [[TEXT.indexOf('item') + 4, TEXT.indexOf('item') + 4, 's']]);
        assert.strictEqual(h.buffer.rebase(h.state.doc, TEXT), undefined);
    });

    test('random typing, structure edits, updates, undo and redo always converge', () => {
        let seed = 11;
        const random = (n: number) => {
            seed = (seed * 1103515245 + 12345) % 2147483648;
            return seed % n;
        };
        for (let run = 0; run < 150; run++) {
            const h = new Harness();
            for (let step = 0; step < 40; step++) {
                const doc = h.state.doc;
                const action = random(10);
                if (action < 4) {
                    // Typing somewhere: sometimes on the same line, sometimes elsewhere
                    if (random(3) === 0) {
                        const line = doc.line(1 + random(doc.lines));
                        h.cursorTo(line.to);
                    }
                    if (random(4) === 0 && h.state.selection.main.head > doc.lineAt(h.state.selection.main.head).from) {
                        h.backspace();
                    } else {
                        h.type('abc'[random(3)]);
                    }
                } else if (action === 4) {
                    const spec = enterCommand(h.state);
                    if (spec) {
                        h.dispatch(spec);
                    }
                } else if (action === 5) {
                    // An outside change somewhere in the host's text
                    const text = h.host;
                    const at = random(text.length + 1);
                    h.external(text.slice(0, at) + ['Z', '\n', ''][random(3)] + text.slice(Math.min(text.length, at + random(3))));
                } else if (action === 6) {
                    h.buffer.flush();
                } else if (action === 7) {
                    const undo = h.buffer.revert(h.state);
                    if (undo) {
                        h.dispatch(undo);
                    }
                } else if (action === 8) {
                    const redo = h.buffer.redo(h.state, h.now);
                    if (redo) {
                        h.dispatch(redo);
                    }
                } else {
                    const lineNumber = 1 + random(doc.lines);
                    const spec = setStatusCommand(h.state, lineNumber, 'done');
                    if (spec) {
                        h.dispatch(spec);
                    }
                }
                if (!h.buffer.pending) {
                    assert.strictEqual(h.host, h.state.doc.toString(), `run ${run} step ${step}: in sync when nothing is held back`);
                }
            }
            h.converged();
        }
    });
});


suite('Webview typing groups: line diff for updates', () => {

    function apply(text: string, changes: { from: number; to: number; insert: string }[]): string {
        let result = '', last = 0;
        for (const change of changes) {
            assert.ok(change.from >= last && change.to >= change.from, 'sorted and non-overlapping');
            result += text.slice(last, change.from) + change.insert;
            last = change.to;
        }
        return result + text.slice(last);
    }

    test('changes on both sides of a line leave that line untouched', () => {
        const before = 'one\ntwo\nkeep me\nthree\nfour';
        const after = 'one!\ntwo\nkeep me\nthree\nadded\nfour';
        const changes = diffChanges(before, after);
        assert.strictEqual(apply(before, changes), after);
        const keep = before.indexOf('keep me');
        assert.ok(changes.every(change => change.to <= keep || change.from >= keep + 7), JSON.stringify(changes));
        assert.deepStrictEqual(changes, [{ from: 3, to: 3, insert: '!' }, { from: 22, to: 22, insert: 'added\n' }]);
    });

    test('random line edits always produce the new text', () => {
        let seed = 3;
        const random = (n: number) => {
            seed = (seed * 1103515245 + 12345) % 2147483648;
            return seed % n;
        };
        const words = ['a', 'b', 'c', '', 'dd', '[ ] e'];
        for (let run = 0; run < 500; run++) {
            const lines = Array.from({ length: random(12) }, () => words[random(words.length)]);
            const changed = [...lines];
            for (let edit = random(5); edit > 0; edit--) {
                const at = random(changed.length + 1);
                const kind = random(3);
                if (kind === 0) {
                    changed.splice(at, 0, words[random(words.length)]);
                } else if (kind === 1) {
                    changed.splice(at, 1);
                } else if (at < changed.length) {
                    changed[at] += 'x';
                }
            }
            const before = lines.join('\n'), after = changed.join('\n');
            assert.strictEqual(apply(before, diffChanges(before, after)), after, JSON.stringify([before, after]));
        }
    });

    test('a complete rewrite falls back to one replacement', () => {
        const before = Array.from({ length: 1200 }, (_, i) => `line ${i}`).join('\n');
        const after = Array.from({ length: 1200 }, (_, i) => `other ${i}`).join('\n');
        const changes = diffChanges(before, after);
        assert.strictEqual(changes.length, 1);
        assert.strictEqual(apply(before, changes), after);
    });
});
