import * as assert from 'assert';
import { EditorSelection, EditorState, TransactionSpec } from '@codemirror/state';
import type { ViewConfig } from '../rendered/protocol';
import { canDropAt, dropLevels, itemBlockAt, moveBlockSpec, moveItemCommand } from '../webview/moving';
import { dbmStateExtensions, foldField, setFoldsEffect } from '../webview/state';
import { getBoxHeader, getDailyHeader } from '../strings';

// Moving items with their sub-items: dragging (moveBlockSpec) and Alt+Up/Down (moveItemCommand)

const CONFIG: ViewConfig = {
    automaticStatusUpdates: true, tabSize: 4, insertSpaces: true, today: { year: 2026, month: 10, day: 4 }, centered: true,
    cursor: { style: 'line', width: 0, blinking: 'blink' }, pinToolbar: true, pinHeaders: true, tabs: false,
};
const CURSOR = '§';
const HEAD = [...getBoxHeader('Daily Log').split('\n'), ...getBoxHeader('2026').split('\n'), ...getBoxHeader('October').split('\n')];
const DAY4 = getDailyHeader(10, 4);
const DAY5 = getDailyHeader(10, 5);
/** 0-based line of the first line after HEAD */
const H = HEAD.length;

function create(lines: string[], folds: string[] = []): EditorState {
    const text = [...HEAD, ...lines].join('\n');
    const pos = text.indexOf(CURSOR);
    let state = EditorState.create({
        doc: text.replace(CURSOR, ''),
        selection: pos >= 0 ? EditorSelection.cursor(pos) : undefined,
        extensions: dbmStateExtensions(CONFIG),
    });
    if (folds.length) {
        state = state.update({ effects: setFoldsEffect.of(folds) }).state;
    }
    return state;
}

/** The lines after HEAD, with the cursor marked */
function body(state: EditorState): string[] {
    const doc = state.doc.toString();
    const head = state.selection.main.head;
    return (doc.slice(0, head) + CURSOR + doc.slice(head)).split('\n').slice(H);
}

function apply(state: EditorState, spec: TransactionSpec | undefined): EditorState {
    assert.ok(spec, 'expected a change');
    return state.update(spec!).state;
}

suite('Webview moving items', () => {

    const lines = [
        DAY4,
        '[+] A',
        '    [x] a1',
        '    [ ] a2',
        '        note under a2',
        '[ ] B',
        '    [ ] b1',
        'C note',
        '',
        DAY5,
        '[x] D',
        '',
    ];
    const at = (text: string) => H + lines.indexOf(text);

    test('an item comes with everything indented under it', () => {
        const state = create(lines);
        assert.deepStrictEqual(itemBlockAt(state, at('[+] A')), { first: at('[+] A'), last: at('        note under a2') });
        assert.deepStrictEqual(itemBlockAt(state, at('    [ ] a2')), { first: at('    [ ] a2'), last: at('        note under a2') });
        assert.deepStrictEqual(itemBlockAt(state, at('C note')), { first: at('C note'), last: at('C note') });
        assert.strictEqual(itemBlockAt(state, at(DAY4)), undefined, 'headers do not move');
        assert.strictEqual(itemBlockAt(state, at('')), undefined, 'blank lines do not move');
        assert.strictEqual(itemBlockAt(state, 1), undefined, 'box lines do not move');
    });

    test('drop gaps: inside days and lists, not between headers or inside the item itself', () => {
        const state = create(lines);
        const block = itemBlockAt(state, at('[ ] B'))!;
        assert.ok(canDropAt(state, block, at('[+] A')), 'right after a day header');
        assert.ok(canDropAt(state, block, at(DAY5)), 'at the end of a day');
        assert.ok(canDropAt(state, block, at('[x] D') + 1), 'into another day');
        assert.ok(!canDropAt(state, block, at('    [ ] b1')), 'not inside itself');
        assert.ok(!canDropAt(state, block, H), 'not between the month box and the first day');
        assert.ok(!canDropAt(state, block, 2), 'not inside a box');
    });

    test('drop levels: at most one deeper than the item above, at least as deep as the item below', () => {
        const state = create(lines);
        const block = itemBlockAt(state, at('C note'))!;
        assert.deepStrictEqual(dropLevels(state, block, at('[+] A')), { min: 0, max: 0 }, 'under a day header');
        assert.deepStrictEqual(dropLevels(state, block, at('    [x] a1')), { min: 1, max: 1 }, 'between a parent and its first child');
        assert.deepStrictEqual(dropLevels(state, block, at('[ ] B')), { min: 0, max: 3 }, 'after a deeply nested note');
        // b1 is the last item above (C is the one moving)
        assert.deepStrictEqual(dropLevels(state, block, at(DAY5)), { min: 0, max: 2 }, 'at the end of a day, after a blank line');
    });

    test('dragging moves the item with its sub-items, re-indented, and updates parents in both places', () => {
        let state = create(lines);
        // a2 (with its note) to the top level of the next day
        state = apply(state, moveBlockSpec(state, itemBlockAt(state, at('    [ ] a2'))!, at('[x] D') + 1, 0));
        assert.deepStrictEqual(body(state), [
            DAY4,
            '[x] A',
            '    [x] a1',
            '[ ] B',
            '    [ ] b1',
            'C note',
            '',
            DAY5,
            '[x] D',
            '[ ] a2§',
            '    note under a2',
            '',
        ]);
    });

    test('dragging up into another item makes it a sub-item', () => {
        let state = create(lines);
        state = apply(state, moveBlockSpec(state, itemBlockAt(state, at('[x] D'))!, at('    [x] a1'), 1));
        assert.deepStrictEqual(body(state).slice(0, 5), [DAY4, '[+] A', '    [x] D§', '    [x] a1', '    [ ] a2']);
    });

    test('dropping in place only changes the level', () => {
        let state = create(lines);
        const block = itemBlockAt(state, at('[ ] B'))!;
        assert.strictEqual(moveBlockSpec(state, block, block.first, 0), undefined);
        state = apply(state, moveBlockSpec(state, block, block.first, 1));
        assert.deepStrictEqual(body(state).slice(5, 8), ['    [ ] B§', '        [ ] b1', 'C note']);
    });

    test('moving the last line of the document', () => {
        let state = create([DAY4, '[ ] A', '[ ] B']);
        state = apply(state, moveBlockSpec(state, itemBlockAt(state, H + 2)!, H + 1, 0));
        assert.deepStrictEqual(body(state), [DAY4, '[ ] B§', '[ ] A']);
        state = apply(state, moveBlockSpec(state, itemBlockAt(state, H + 1)!, H + 3, 0));
        assert.deepStrictEqual(body(state), [DAY4, '[ ] A', '[ ] B§']);
    });

    test('tabs as indentation', () => {
        const config = { ...CONFIG, insertSpaces: false };
        let state = EditorState.create({ doc: [...HEAD, DAY4, '[ ] A', '[ ] B', '\t[ ] b1'].join('\n'), extensions: dbmStateExtensions(config) });
        state = apply(state, moveBlockSpec(state, itemBlockAt(state, H + 2)!, H + 2, 1));
        assert.deepStrictEqual(state.doc.toString().split('\n').slice(H), [DAY4, '[ ] A', '\t[ ] B', '\t\t[ ] b1']);
    });

    test('lists are sections too', () => {
        const list = getBoxHeader('Backlog').split('\n');
        let state = create([DAY4, '[ ] A', '', ...list, '- one', '- two', '    - two.a']);
        const two = H + 4 + list.length;
        assert.ok(canDropAt(state, itemBlockAt(state, two)!, H + 3 + list.length), 'right under the list box');
        state = apply(state, moveBlockSpec(state, itemBlockAt(state, two)!, H + 3 + list.length, 0));
        assert.deepStrictEqual(body(state).slice(3 + list.length), ['- two§', '    - two.a', '- one']);
        // From the list into the day
        state = apply(state, moveBlockSpec(state, itemBlockAt(state, H + 3 + list.length)!, H + 2, 0));
        assert.deepStrictEqual(body(state).slice(0, 4), [DAY4, '[ ] A', '- two§', '    - two.a']);
    });

    suite('Alt+Up / Alt+Down', () => {
        test('an item swaps with its sibling, both with their sub-items', () => {
            let state = create(lines.map(line => line === '[ ] B' ? '[ ] B§' : line));
            state = apply(state, moveItemCommand(state, -1));
            assert.deepStrictEqual(body(state).slice(0, 8), [DAY4, '[ ] B§', '    [ ] b1', '[+] A', '    [x] a1', '    [ ] a2', '        note under a2', 'C note']);
            state = apply(state, moveItemCommand(state, 1));
            assert.deepStrictEqual(body(state).slice(0, 8), [DAY4, '[+] A', '    [x] a1', '    [ ] a2', '        note under a2', '[ ] B§', '    [ ] b1', 'C note']);
        });

        test('a sub-item moves within its parent', () => {
            let state = create(lines.map(line => line === '    [ ] a2' ? '    [ ] a2§' : line));
            state = apply(state, moveItemCommand(state, -1));
            assert.deepStrictEqual(body(state).slice(1, 5), ['[+] A', '    [ ] a2§', '        note under a2', '    [x] a1']);
        });

        test('past a parent or a header it moves one line, and stays under the header', () => {
            let state = create(lines.map(line => line === '    [x] a1' ? '    [x] a1§' : line));
            state = apply(state, moveItemCommand(state, -1));
            assert.deepStrictEqual(body(state).slice(0, 3), [DAY4, '    [x] a1§', '[ ] A']);
            // The first item of a day moves past the header into the previous day, as before
            state = create([DAY4, '[ ] A', DAY5, '[ ] B§']);
            state = apply(state, moveItemCommand(state, -1));
            assert.deepStrictEqual(body(state), [DAY4, '[ ] A', '[ ] B§', DAY5]);
        });

        test('not on an item: undefined (lines move as before)', () => {
            const state = create([DAY4, '§', '[ ] A']);
            assert.strictEqual(moveItemCommand(state, 1), undefined);
        });

        test('moving into a folded day unfolds it', () => {
            let state = create([DAY4, '[ ] A', '[ ] B', DAY5, '[ ] C§'], ['day:2026-10-04']);
            state = apply(state, moveItemCommand(state, -1));
            assert.deepStrictEqual(body(state), [DAY4, '[ ] A', '[ ] B', '[ ] C§', DAY5]);
            assert.ok(!state.field(foldField).has('day:2026-10-04'));
        });
    });
});
