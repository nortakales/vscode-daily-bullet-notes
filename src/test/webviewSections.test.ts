import * as assert from 'assert';
import { EditorSelection, EditorState } from '@codemirror/state';
import type { ViewConfig } from '../rendered/protocol';
import { setStatusCommand } from '../webview/commands';
import { dbmStateExtensions } from '../webview/state';
import { headerHasRoom, inListSection, parseStructure, updateScopeAt, updateScopesTouching } from '../webview/structure';
import { toLineChanges } from '../webview/sync';
import { sampleLines } from './webviewStructure.test';

const CONFIG: ViewConfig = {
    automaticStatusUpdates: true, tabSize: 4, insertSpaces: true, today: { year: 2026, month: 10, day: 4 }, centered: true,
    cursor: { style: 'line', width: 0, blinking: 'blink' }, pinToolbar: true, pinHeaders: true, tabs: false,
};

const LINES = sampleLines([
    '#box Daily Log', '#box 2026', '#box October',       // 0-8
    '#day 10/3', '[ ] a', '',                              // 9-11
    '#day 10/4', '#day 10/5', '[ ] b',                      // 12-14
    '',                                                    // 15
    '#box Backburner', '[ ] parent', '    [ ] child', '- item', '#day 10/9', '[ ] in a day in a list',  // 16-23
    '#box Career goals', 'goal',                           // 24-27
]);

suite('Webview header spacing', () => {
    const get = (i: number) => LINES[i];

    test('headers get room after content, also after blank lines that follow content', () => {
        assert.strictEqual(headerHasRoom(get, 12, -1), true, 'day after a task and a blank line');
        assert.strictEqual(headerHasRoom(get, 16, -1), true, 'list box after a task and a blank line');
        assert.strictEqual(headerHasRoom(get, 24, -1), true, 'list box right after content');
    });

    test('headers right after another header, a folded section or at the top stay compact', () => {
        assert.strictEqual(headerHasRoom(get, 0, -1), false, 'top of the file');
        assert.strictEqual(headerHasRoom(get, 3, -1), false, 'year box after the daily log box');
        assert.strictEqual(headerHasRoom(get, 9, -1), false, 'day after the month box');
        assert.strictEqual(headerHasRoom(get, 13, -1), false, 'day after an empty day');
        assert.strictEqual(headerHasRoom(get, 12, 11), false, 'day after a folded day');
        assert.strictEqual(headerHasRoom(get, 16, 15), false, 'list after a folded day (ending with its blank line)');
    });
});

suite('Webview update scopes: days and list sections', () => {
    const get = (i: number) => LINES[i];

    test('days, list sections and lines in neither', () => {
        assert.deepStrictEqual(updateScopeAt(get, LINES.length, 10), { kind: 'day', start: 10, end: 11 });
        assert.deepStrictEqual(updateScopeAt(get, LINES.length, 12), { kind: 'day', start: 13, end: 12 });
        assert.deepStrictEqual(updateScopeAt(get, LINES.length, 15), { kind: 'day', start: 14, end: 15 });
        // A list section runs to the line before the next box border, days inside it included
        for (const line of [19, 20, 21, 22, 23]) {
            assert.deepStrictEqual(updateScopeAt(get, LINES.length, line), { kind: 'list', start: 19, end: 23 }, `line ${line}`);
        }
        assert.deepStrictEqual(updateScopeAt(get, LINES.length, 27), { kind: 'list', start: 27, end: 27 });
        for (const line of [0, 1, 4, 8, 16, 17, 18, 24]) {
            assert.strictEqual(updateScopeAt(get, LINES.length, line), undefined, `line ${line}`);
        }
    });

    test('scopes touching a range', () => {
        assert.deepStrictEqual(updateScopesTouching(get, LINES.length, 10, 20).map(scope => [scope.kind, scope.start, scope.end]),
            [['day', 10, 11], ['day', 13, 12], ['day', 14, 15], ['list', 19, 23]]);
    });

    test('list sections in the parsed structure', () => {
        const structure = parseStructure(LINES);
        assert.deepStrictEqual([19, 23, 27, 18, 10].map(line => inListSection(structure, line)), [true, true, true, false, false]);
    });
});

suite('Webview parent statuses in list sections', () => {

    function create(config: ViewConfig = CONFIG) {
        return EditorState.create({ doc: LINES.join('\n'), extensions: dbmStateExtensions(config) });
    }

    test('a status change in a list section updates its parent in the same transaction', () => {
        const state = create();
        const tr = state.update(setStatusCommand(state, 21, 'done')!);
        const lines = tr.state.doc.toString().split('\n');
        assert.deepStrictEqual(lines.slice(19, 21), ['[x] parent', '    [x] child']);
        assert.deepStrictEqual(toLineChanges(state.doc, tr.changes).map(change => [change.fromLine, change.text]), [[19, 'x'], [20, 'x']]);
    });

    test('adding a sub-task in a list section updates the parent', () => {
        const state = create();
        const end = state.doc.line(21).to;
        const tr = state.update({ changes: { from: end, insert: '\n    [x] another' }, selection: EditorSelection.cursor(end + 16), userEvent: 'input' });
        assert.strictEqual(tr.state.doc.line(20).text, '[+] parent');
        const done = tr.state.update(setStatusCommand(tr.state, 21, 'done')!).state;
        assert.strictEqual(done.doc.line(20).text, '[x] parent');
    });

    test('not when automatic status updates are off', () => {
        const state = create({ ...CONFIG, automaticStatusUpdates: false });
        const tr = state.update(setStatusCommand(state, 21, 'done')!);
        assert.deepStrictEqual(tr.state.doc.toString().split('\n').slice(19, 21), ['[ ] parent', '    [x] child']);
    });
});
