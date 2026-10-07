import * as assert from 'assert';
import { ChangeSet, EditorSelection, EditorState, TransactionSpec } from '@codemirror/state';
import type { ViewConfig } from '../rendered/protocol';
import { applyLineChanges } from '../rendered/lineChanges';
import {
    backspaceCommand, deleteForwardCommand, enterCommand, indentCommand, moveLinesCommand, setStatusCommand
} from '../webview/commands';
import { clampCursor, dbmStateExtensions, foldEffect, foldField, regionAt, remoteAnnotation, setFoldsEffect, structureField } from '../webview/state';
import { BOX_BORDER_REGEX, DAY_HEADER_REGEX, DocStructure, isBoxAt, parseStructure } from '../webview/structure';
import { minimalReplacement, toLineChanges } from '../webview/sync';
import { getBoxHeader, getDailyHeader } from '../strings';
import { largeDocument, sampleLines } from './webviewStructure.test';

const CURSOR = '§';
const CONFIG: ViewConfig = { automaticStatusUpdates: true, tabSize: 4, insertSpaces: true, today: { year: 2026, month: 10, day: 4 }, centered: true, cursor: { style: 'line', width: 0, blinking: 'blink' }, pinToolbar: true, pinHeaders: true, tabs: false };

/** Headers of a day, ending with the day header line (no trailing line break) */
const HEADERS = sampleLines(['#box Daily Log', '#box 2026', '#box October', '#day 10/4']).join('\n');
const DAY = HEADERS + '\n';
const NEXT_DAY = getDailyHeader(10, 5);

function create(text: string, config: ViewConfig = CONFIG, folds: string[] = []): EditorState {
    const pos = text.indexOf(CURSOR);
    let state = EditorState.create({
        doc: text.replace(CURSOR, ''),
        selection: pos >= 0 ? EditorSelection.cursor(pos) : undefined,
        extensions: dbmStateExtensions(config),
    });
    if (folds.length > 0) {
        state = state.update({ effects: setFoldsEffect.of(folds) }).state;
    }
    return state;
}

/** The document with the cursor marked */
function show(state: EditorState): string {
    const doc = state.doc.toString();
    const head = state.selection.main.head;
    return doc.slice(0, head) + CURSOR + doc.slice(head);
}

function apply(state: EditorState, spec: TransactionSpec | undefined) {
    assert.ok(spec, 'expected the command to handle the key');
    const tr = state.update(spec);
    return { state: tr.state, tr };
}

function press(text: string, command: (state: EditorState) => TransactionSpec | undefined, config?: ViewConfig): string {
    return show(apply(create(text, config), command(create(text, config))).state);
}

suite('Webview editing: Enter', () => {

    test('at the end of a task adds an empty task with the same indentation', () => {
        assert.strictEqual(press(DAY + '[ ] first§\n[ ] second', enterCommand), DAY + '[ ] first\n[ ] §\n[ ] second');
        assert.strictEqual(press(DAY + '[ ] parent\n    [ ] child§', enterCommand), DAY + '[ ] parent\n    [ ] child\n    [ ] §');
    });

    test('in the middle of a task splits it, moving the rest to a new open task', () => {
        assert.strictEqual(press(DAY + '[/] split§ here', enterCommand), DAY + '[/] split\n[ ] §here');
    });

    test('at the start of a task adds an empty task above and keeps the cursor with the text', () => {
        assert.strictEqual(press(DAY + '[x] §done thing', enterCommand), DAY + '[ ] \n[x] §done thing');
    });

    test('on an empty indented task outdents it', () => {
        assert.strictEqual(press(DAY + '[ ] parent\n    [ ] §', enterCommand), DAY + '[ ] parent\n[ ] §');
    });

    test('on an empty task that is not indented removes the box', () => {
        assert.strictEqual(press(DAY + '[ ] a\n[ ] §', enterCommand), DAY + '[ ] a\n§');
        assert.strictEqual(press(DAY + '[ ] a\n[]§', enterCommand), DAY + '[ ] a\n§');
    });

    test('on a note keeps the indentation', () => {
        assert.strictEqual(press(DAY + '[ ] a\n    note§ text', enterCommand), DAY + '[ ] a\n    note\n    §text');
        assert.strictEqual(press(DAY + 'plain§', enterCommand), DAY + 'plain\n§');
    });

    test('right after a day header adds an empty task as the first line of the day', () => {
        assert.strictEqual(press(HEADERS + '§\n[ ] existing', enterCommand), HEADERS + '\n[ ] §\n[ ] existing');
    });
});

suite('Webview editing: Backspace and Delete', () => {

    test('Backspace at the start of a task removes its box and keeps the indentation', () => {
        assert.strictEqual(press(DAY + '[ ] a\n    [x] §task', backspaceCommand), DAY + '[ ] a\n    §task');
        assert.strictEqual(press(DAY + '[ ] §', backspaceCommand), DAY + '§');
    });

    test('Backspace at the start of an indented note outdents it', () => {
        assert.strictEqual(press(DAY + '[ ] a\n        §note', backspaceCommand), DAY + '[ ] a\n    §note');
        assert.strictEqual(press(DAY + '[ ] a\n\t§note', backspaceCommand), DAY + '[ ] a\n§note');
    });

    test('Backspace at the start of a line joins it with a previous task or note', () => {
        assert.strictEqual(press(DAY + '[ ] task\n§note', backspaceCommand), DAY + '[ ] task§note');
        assert.strictEqual(press(DAY + '[ ] task\n\n§note', backspaceCommand), DAY + '[ ] task\n§note');
    });

    test('Backspace never merges a line into a header', () => {
        assert.strictEqual(press(HEADERS + '\n§note', backspaceCommand), HEADERS + '\n§note');
        assert.strictEqual(press(HEADERS + '\n§\n[ ] x', backspaceCommand), HEADERS + '§\n[ ] x');
        assert.strictEqual(press(HEADERS + '§\n[ ] x', backspaceCommand), HEADERS + '§\n[ ] x');
        const boxes = getBoxHeader('Daily Log');
        assert.strictEqual(press(boxes + '\n§note', backspaceCommand), boxes + '\n§note');
        assert.strictEqual(press(boxes + '\n§\n[ ] x', backspaceCommand), boxes + '\n[ ] §x');
    });

    test('Delete at the end of a line joins the next line without its indentation and box', () => {
        assert.strictEqual(press(DAY + '[ ] a§\n    [x] b', deleteForwardCommand), DAY + '[ ] a§b');
    });

    test('Delete never merges a header with the next line', () => {
        assert.strictEqual(press(DAY + '[ ] a§\n' + NEXT_DAY, deleteForwardCommand), DAY + '[ ] a§\n' + NEXT_DAY);
        assert.strictEqual(press(DAY + '[ ] a\n§\n' + NEXT_DAY, deleteForwardCommand), DAY + '[ ] a§\n' + NEXT_DAY);
        assert.strictEqual(press(HEADERS + '§\n[ ] a', deleteForwardCommand), HEADERS + '§\n[ ] a');
        assert.strictEqual(press(HEADERS + '§\n\n[ ] a', deleteForwardCommand), HEADERS + '§\n[ ] a');
    });
});

suite('Webview editing: Tab and Shift+Tab', () => {

    test('Tab indents a task with its subtree, and updates the new parent', () => {
        const before = DAY + '[x] a\n[ ] b§\n    [ ] b1\n        note\n\n[ ] d';
        assert.strictEqual(press(before, state => indentCommand(state, 1)),
            DAY + '[ ] a\n    [ ] b§\n        [ ] b1\n            note\n\n[ ] d');
    });

    test('Shift+Tab outdents a task with its subtree', () => {
        assert.strictEqual(press(DAY + '[ ] a\n    [ ] b§\n        [ ] b1\n[ ] c', state => indentCommand(state, -1)),
            DAY + '[ ] a\n[ ] b§\n    [ ] b1\n[ ] c');
    });

    test('never outdents below column 0, and does nothing on headers', () => {
        assert.strictEqual(press(DAY + '[ ] a§\n    [ ] b', state => indentCommand(state, -1)), DAY + '[ ] a§\n    [ ] b');
        assert.strictEqual(press(HEADERS + '§\n[ ] a', state => indentCommand(state, 1)), HEADERS + '§\n[ ] a');
    });

    test('uses a tab when the document does not insert spaces, and outdents mixed indentation to the previous level', () => {
        assert.strictEqual(press(DAY + 'note§', state => indentCommand(state, 1), { ...CONFIG, insertSpaces: false }), DAY + '\tnote§');
        assert.strictEqual(press(DAY + '\t  §note', state => indentCommand(state, -1)), DAY + '\t§note');
        assert.strictEqual(press(DAY + '  §note', state => indentCommand(state, 1)), DAY + '    §note');
    });

    test('a multi-line selection indents each selected line, skipping blank lines and headers', () => {
        const doc = DAY + '[ ] a\n\n[ ] b\n' + NEXT_DAY + '\n[ ] c';
        const from = doc.indexOf('[ ] a');
        const state = create(doc).update({ selection: EditorSelection.range(from, doc.length) }).state;
        const result = state.update(indentCommand(state, 1)).state.doc.toString();
        assert.strictEqual(result, DAY + '    [ ] a\n\n    [ ] b\n' + NEXT_DAY + '\n    [ ] c');
    });
});

suite('Webview editing: statuses', () => {

    test('a status change and the parent updates are one transaction', () => {
        const state = create(DAY + '[ ] parent\n    [ ] one\n    [ ] two\n        [ ] deep\n[x] other');
        const line = state.doc.toString().split('\n').indexOf('    [ ] one') + 1;
        const { state: after, tr } = apply(state, setStatusCommand(state, line, 'done'));
        assert.strictEqual(after.doc.toString(), DAY + '[+] parent\n    [x] one\n    [ ] two\n        [ ] deep\n[x] other');
        const changes = toLineChanges(state.doc, tr.changes);
        assert.deepStrictEqual(changes.map(change => change.text), ['+', 'x']);
        assert.strictEqual(applyLineChanges(state.doc.toString(), changes), after.doc.toString());
    });

    test('nested parents update too, and [] becomes [ ] only when the parent changes', () => {
        const state = create(DAY + '[] top\n    [] mid\n        [] leaf');
        const line = state.doc.lines;
        const after = apply(state, setStatusCommand(state, line, 'blocked')).state;
        assert.strictEqual(after.doc.toString(), DAY + '[/] top\n    [/] mid\n        [/] leaf');
    });

    test('only the status character changes', () => {
        const state = create(DAY + '[] task');
        const { tr } = apply(state, setStatusCommand(state, state.doc.lines, 'tomorrow'));
        assert.deepStrictEqual(toLineChanges(state.doc, tr.changes), [{ fromLine: 10, fromCharacter: 1, toLine: 10, toCharacter: 1, text: '>' }]);
        assert.strictEqual(setStatusCommand(state, state.doc.lines, 'open'), undefined);
    });

    test('no parent updates when automatic status updates are off', () => {
        const config = { ...CONFIG, automaticStatusUpdates: false };
        const state = create(DAY + '[ ] parent\n    [ ] one', config);
        const after = apply(state, setStatusCommand(state, state.doc.lines, 'done')).state;
        assert.strictEqual(after.doc.toString(), DAY + '[ ] parent\n    [x] one');
    });

    test('remote changes never recompute parents', () => {
        const state = create(DAY + '[ ] parent\n    [ ] one');
        const pos = state.doc.toString().lastIndexOf('[ ]') + 1;
        const after = state.update({ changes: { from: pos, to: pos + 1, insert: 'x' }, annotations: remoteAnnotation.of(true) }).state;
        assert.strictEqual(after.doc.toString(), DAY + '[ ] parent\n    [x] one');
    });

    test('typing text does not touch parents, typing box syntax does', () => {
        let state = create(DAY + '[ ] parent\n    [x] one§');
        state = state.update({ changes: { from: state.doc.length, insert: 'z' }, userEvent: 'input.type' }).state;
        assert.strictEqual(state.doc.toString(), DAY + '[ ] parent\n    [x] onez');

        state = create(DAY + '[x] parent\n    [x] one\n    §');
        for (const ch of '[ ] ') {
            const pos = state.selection.main.head;
            state = state.update({ changes: { from: pos, insert: ch }, selection: EditorSelection.cursor(pos + 1), userEvent: 'input.type' }).state;
        }
        assert.strictEqual(show(state), DAY + '[+] parent\n    [x] one\n    [ ] §');
    });

    test('Enter after a done sub-task makes the parent in progress', () => {
        assert.strictEqual(press(DAY + '[x] parent\n    [x] one§', enterCommand), DAY + '[+] parent\n    [x] one\n    [ ] §');
    });

    test('pasting sub-tasks updates the parent in the same transaction', () => {
        const state = create(DAY + '[ ] parent\n§');
        const pos = state.selection.main.head;
        const tr = state.update({ changes: { from: pos, insert: '    [x] a\n    [x] b' }, userEvent: 'input.paste' });
        assert.strictEqual(tr.state.doc.toString(), DAY + '[x] parent\n    [x] a\n    [x] b');
    });
});

suite('Webview editing: header integrity', () => {

    const doc = DAY + 'note A\n' + NEXT_DAY + '\n[ ] b';

    test('deletions that cut into a header remove it whole', () => {
        const state = create(doc);
        const header = doc.indexOf(NEXT_DAY);
        const after = state.update({ changes: { from: doc.indexOf('note A') + 3, to: header + 5 }, userEvent: 'delete' }).state;
        assert.strictEqual(after.doc.toString(), DAY + 'not\n[ ] b');
    });

    test('a deletion inside a box removes the whole box', () => {
        const text = DAY + '[ ] a\n' + getBoxHeader('Backburner') + '\nitem';
        const state = create(text);
        const title = text.indexOf('Backburner');
        const after = state.update({ changes: { from: title - 3, to: title + 4 }, userEvent: 'delete' }).state;
        assert.strictEqual(after.doc.toString(), DAY + '[ ] a\n\nitem');
    });

    test('typing at the end of a header starts a new line', () => {
        const state = create(HEADERS + '§\n[ ] a');
        const pos = state.selection.main.head;
        const after = state.update({ changes: { from: pos, insert: 'x' }, selection: EditorSelection.cursor(pos + 1), userEvent: 'input.type' }).state;
        assert.strictEqual(show(after), HEADERS + '\nx§\n[ ] a');
    });

    test('typing at the start of a box puts the text on its own line', () => {
        const state = create('§' + DAY);
        const after = state.update({ changes: { from: 0, insert: 'hi' }, selection: EditorSelection.cursor(2), userEvent: 'input.type' }).state;
        assert.strictEqual(show(after), 'hi§\n' + DAY);
    });

    test('joining a line onto a header does nothing', () => {
        const state = create(doc);
        const header = doc.indexOf(NEXT_DAY);
        const after = state.update({ changes: { from: header - 1, to: header }, userEvent: 'delete.forward' }).state;
        assert.strictEqual(after.doc.toString(), doc);
    });

    test('search and replace skips headers', () => {
        const state = create(doc);
        const header = doc.indexOf(NEXT_DAY);
        const note = doc.indexOf('note A');
        const after = state.update({
            changes: [{ from: note, to: note + 4, insert: 'memo' }, { from: header + 6, to: header + 8, insert: '' }],
            userEvent: 'input.replace.all',
        }).state;
        assert.strictEqual(after.doc.toString(), doc.replace('note A', 'memo A'));
    });

    test('whole headers can be deleted', () => {
        const state = create(doc);
        const header = doc.indexOf(NEXT_DAY);
        const after = state.update({ changes: { from: header, to: header + NEXT_DAY.length + 1 }, userEvent: 'delete' }).state;
        assert.strictEqual(after.doc.toString(), DAY + 'note A\n[ ] b');
    });

    test('remote changes are applied as they are', () => {
        const state = create(doc);
        const header = doc.indexOf(NEXT_DAY);
        const after = state.update({ changes: { from: header, to: header + 3 }, annotations: remoteAnnotation.of(true) }).state;
        assert.strictEqual(after.doc.toString(), doc.replace(NEXT_DAY, NEXT_DAY.slice(3)));
    });

    test('random user edits never corrupt a header', () => {
        const pieces = ['', 'x', ' ', '\n', '[ ] ', '\n[x] y', '    ', 'abc\ndef', '\n' + NEXT_DAY + '\n', '-'];
        let seed = 7;
        const random = (n: number) => {
            seed = (seed * 1103515245 + 12345) % 2147483648;
            return seed % n;
        };
        for (let run = 0; run < 2000; run++) {
            const state = create(sampleLines([
                '#box Daily Log', '#box 2026', '#box October', '#day 10/3', '[+] a', '    [x] a1', '    [ ] a2', '',
                '#day 10/4', '[ ] b', '    note', '#box List', 'item',
            ]).join('\n'), CONFIG, random(3) === 0 ? ['day:2026-10-03'] : []);
            const length = state.doc.length;
            const from = random(length + 1);
            const to = Math.min(length, from + random(40));
            const events = ['input.type', 'delete', 'input.paste', 'delete.backward'];
            const tr = state.update({ changes: { from, to, insert: pieces[random(pieces.length)] }, userEvent: events[random(events.length)] });
            assertHeadersIntact(state, tr.changes, tr.state);
        }
    });
});

/** Every header of the old state is either still whole lines with the same text, or entirely deleted */
function assertHeadersIntact(before: EditorState, changes: ChangeSet, after: EditorState) {
    const structure = before.field(structureField);
    const spans = [
        ...structure.boxes.map(box => [box.line, box.line + 2]),
        ...structure.days.map(day => [day.line, day.line]),
    ];
    for (const [first, last] of spans) {
        const from = before.doc.line(first + 1).from, to = before.doc.line(last + 1).to;
        const text = before.doc.sliceString(from, to);
        let covered = false;
        changes.iterChangedRanges((fromA, toA) => covered = covered || (fromA <= from && toA >= to));
        if (covered) {
            // Removed whole (possibly replaced by what the user typed)
            continue;
        }
        const newFrom = changes.mapPos(from, 1), newTo = changes.mapPos(to, -1);
        assert.strictEqual(after.doc.sliceString(newFrom, newTo), text, `header changed:\n${after.doc.toString()}`);
        assert.strictEqual(after.doc.lineAt(newFrom).from, newFrom, 'header no longer starts a line');
        assert.strictEqual(after.doc.lineAt(newTo).to, newTo, 'header no longer ends a line');
    }
    // And no new partial headers: every border line is part of a box or stands alone as in the old document
    const lines = after.doc.toJSON();
    lines.forEach((line, i) => {
        if (DAY_HEADER_REGEX.test(line)) {
            assert.ok(/^\d{1,2}(\/\d{1,2})? -{20,100}( < Today)?$/.test(line), `day header with extra text: ${line}`);
        }
        if (BOX_BORDER_REGEX.test(line) && i > 0 && !isBoxAt(lines, i) && !isBoxAt(lines, i - 2)) {
            assert.fail(`broken box at line ${i}:\n${after.doc.toString()}`);
        }
    });
}

suite('Webview editing: cursor placement', () => {

    test('the cursor rests at the end of a day header, never before it', () => {
        const state = create(DAY + '[ ] a');
        const headerLine = state.doc.line(10);
        assert.strictEqual(clampCursor(state, headerLine.from, 0), headerLine.to);
        // Moving left off the header would go before it, but only boxes are there: the cursor stays
        const moved = state.update({ selection: EditorSelection.cursor(headerLine.to) }).state.update({ selection: EditorSelection.cursor(headerLine.from) }).state;
        assert.strictEqual(moved.selection.main.head, headerLine.to);
        // From the first task, moving left goes to the end of the day header
        const task = state.doc.line(11);
        const atTask = state.update({ selection: EditorSelection.cursor(task.from + 4) }).state;
        assert.strictEqual(atTask.update({ selection: EditorSelection.cursor(task.from) }).state.selection.main.head, headerLine.to);
    });

    test('the cursor never rests in a line\'s hidden indentation and box', () => {
        const state = create(DAY + '[ ] a\n    [x] b');
        const line = state.doc.line(state.doc.lines);
        const textStart = line.from + 8;
        assert.strictEqual(state.update({ selection: EditorSelection.cursor(line.from + 2) }).state.selection.main.head, textStart);
        // Moving left from the text goes to the end of the previous line
        const atText = state.update({ selection: EditorSelection.cursor(textStart) }).state;
        assert.strictEqual(atText.update({ selection: EditorSelection.cursor(line.from) }).state.selection.main.head, line.from - 1);
    });

    test('boxes and folded sections are skipped in the direction of travel', () => {
        const text = DAY + '[ ] a\n' + NEXT_DAY + '\n[ ] b\n[ ] c';
        const state = create(text, CONFIG, ['day:2026-10-05']);
        const folded = regionAt(state, text.indexOf('[ ] b'));
        assert.strictEqual(folded?.kind, 'folded');
        assert.strictEqual(clampCursor(state, folded!.from + 2, 0), folded!.to + 1 <= state.doc.length ? folded!.to + 1 : folded!.from - 1);
        assert.strictEqual(clampCursor(state, folded!.from + 2, state.doc.length), folded!.from - 1);
        const box = regionAt(state, 1)!;
        assert.strictEqual(box.kind, 'box');
    });
});

suite('Webview editing: folds and moving lines', () => {

    test('fold effects and search results', () => {
        const text = DAY + '[ ] a\n' + NEXT_DAY + '\n[ ] b';
        let state = create(text);
        state = state.update({ effects: foldEffect.of({ keys: ['day:2026-10-05', 'month:2026-10'], folded: true }) }).state;
        assert.deepStrictEqual([...state.field(foldField)].sort(), ['day:2026-10-05', 'month:2026-10']);
        const match = text.indexOf('[ ] b');
        state = state.update({ selection: EditorSelection.range(match, match + 5), userEvent: 'select.search' }).state;
        assert.deepStrictEqual([...state.field(foldField)], []);
    });

    test('user edits inside a folded section unfold it, remote ones do not', () => {
        const text = DAY + '[ ] a\n' + NEXT_DAY + '\n[ ] b';
        const state = create(text, CONFIG, ['day:2026-10-05']);
        const pos = text.indexOf('[ ] b') + 4;
        const remote = state.update({ changes: { from: pos, insert: 'z' }, annotations: remoteAnnotation.of(true) }).state;
        assert.deepStrictEqual([...remote.field(foldField)], ['day:2026-10-05']);
        const replaced = state.update({ changes: { from: pos, to: pos + 1, insert: 'B' }, userEvent: 'input.replace.all' }).state;
        assert.strictEqual(replaced.doc.toString(), text.replace('[ ] b', '[ ] B'));
        assert.deepStrictEqual([...replaced.field(foldField)], []);
    });

    test('Alt+Up moves a line past a whole header', () => {
        const text = HEADERS + '\n[ ] a\n' + NEXT_DAY + '\n[ ] b§';
        assert.strictEqual(press(text, state => moveLinesCommand(state, -1)), HEADERS + '\n[ ] a\n[ ] b§\n' + NEXT_DAY);
        assert.strictEqual(press(HEADERS + '\n[ ] a§\n' + NEXT_DAY + '\n[ ] b', state => moveLinesCommand(state, 1)),
            HEADERS + '\n' + NEXT_DAY + '\n[ ] a§\n[ ] b');
    });
});

suite('Webview sync', () => {

    test('line changes are in coordinates of the document before the edit', () => {
        const state = create('one\ntwo\nthree');
        const tr = state.update({ changes: [{ from: 1, to: 2, insert: 'N' }, { from: 8, to: 13, insert: 'a\nb' }] });
        const changes = toLineChanges(state.doc, tr.changes);
        assert.deepStrictEqual(changes, [
            { fromLine: 0, fromCharacter: 1, toLine: 0, toCharacter: 2, text: 'N' },
            { fromLine: 2, fromCharacter: 0, toLine: 2, toCharacter: 5, text: 'a\nb' },
        ]);
        assert.strictEqual(applyLineChanges('one\ntwo\nthree', changes), tr.state.doc.toString());
    });

    test('minimal replacement', () => {
        assert.deepStrictEqual(minimalReplacement('hello world', 'hello brave world'), { from: 6, to: 6, insert: 'brave ' });
        assert.deepStrictEqual(minimalReplacement('aaa', 'aa'), { from: 2, to: 3, insert: '' });
        assert.deepStrictEqual(minimalReplacement('abc', 'xbc'), { from: 0, to: 1, insert: 'x' });
        assert.strictEqual(minimalReplacement('same', 'same'), undefined);
    });
});

suite('Webview structure: incremental updates', () => {

    function comparable(structure: DocStructure) {
        return { lineCount: structure.lineCount, boxes: structure.boxes, days: structure.days };
    }

    test('match a full parse after random edits', () => {
        const pieces = ['x', '\n', '\n\n', '[ ] task', '\n    [x] sub', '\n' + NEXT_DAY, '\n' + getBoxHeader('New list'), '+' + '-'.repeat(30) + '+',
            '|   2027   |', '\n', 'October', '', '4 ' + '-'.repeat(25)];
        let seed = 42;
        const random = (n: number) => {
            seed = (seed * 1103515245 + 12345) % 2147483648;
            return seed % n;
        };
        let state = EditorState.create({ doc: largeDocument(1, 30).join('\n'), extensions: dbmStateExtensions(CONFIG) });
        for (let i = 0; i < 600; i++) {
            const length = state.doc.length;
            const changes = [];
            let pos = 0;
            for (let c = 0; c < 1 + random(3); c++) {
                const from = Math.min(length, pos + random(Math.max(1, Math.floor(length / 3))));
                const to = Math.min(length, from + (random(4) === 0 ? random(200) : random(3)));
                changes.push({ from, to, insert: pieces[random(pieces.length)] });
                pos = to + 1;
                if (pos >= length) {
                    break;
                }
            }
            state = state.update({ changes, annotations: remoteAnnotation.of(true) }).state;
            assert.deepStrictEqual(comparable(state.field(structureField)), comparable(parseStructure(state.doc.toJSON())), `after edit ${i}`);
        }
    });

    test('typing in a large document does not reparse', () => {
        let state = EditorState.create({ doc: largeDocument().join('\n'), extensions: dbmStateExtensions(CONFIG) });
        const revision = state.field(structureField).revision;
        const lines = state.doc.toJSON();
        const pos = state.doc.line(lines.indexOf('[ ] Write Q4 planning doc', Math.floor(lines.length / 2)) + 1).to;
        const start = process.hrtime.bigint();
        for (let i = 0; i < 100; i++) {
            const at = pos + i;
            state = state.update({ changes: { from: at, insert: 'a' }, selection: EditorSelection.cursor(at + 1), userEvent: 'input.type' }).state;
        }
        const enter = enterCommand(state)!;
        state = state.update(enter).state;
        const ms = Number(process.hrtime.bigint() - start) / 1e6 / 101;
        console.log(`      ${state.doc.lines} lines: ${ms.toFixed(3)} ms per keystroke (filter + state fields, no DOM)`);
        assert.strictEqual(state.field(structureField).revision, revision);
        assert.deepStrictEqual(comparable(state.field(structureField)), comparable(parseStructure(state.doc.toJSON())));
    });
});
