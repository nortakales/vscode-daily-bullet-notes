import * as assert from 'assert';
import { EditorSelection, EditorState, TransactionSpec } from '@codemirror/state';
import type { ViewConfig } from '../rendered/protocol';
import { backspaceCommand, deleteForwardCommand, enterCommand, indentCommand } from '../webview/commands';
import { findLinks, linkForPaste, singleUrl } from '../webview/links';
import { dbmStateExtensions } from '../webview/state';
import { analyzeLine, displayNumber, listDepth } from '../webview/structure';
import { typingLine } from '../webview/typing';
import { getDailyHeader } from '../strings';
import { sampleLines } from './webviewStructure.test';

const CURSOR = '§';
const CONFIG: ViewConfig = { automaticStatusUpdates: true, tabSize: 4, insertSpaces: true, today: { year: 2026, month: 10, day: 4 }, centered: true };
const DAY = sampleLines(['#box Daily Log', '#box 2026', '#box October', '#day 10/4']).join('\n') + '\n';

function create(text: string): EditorState {
    const pos = text.indexOf(CURSOR);
    return EditorState.create({
        doc: text.replace(CURSOR, ''),
        selection: pos >= 0 ? EditorSelection.cursor(pos) : undefined,
        extensions: dbmStateExtensions(CONFIG),
    });
}

function show(state: EditorState): string {
    const doc = state.doc.toString();
    const head = state.selection.main.head;
    return doc.slice(0, head) + CURSOR + doc.slice(head);
}

function press(text: string, command: (state: EditorState) => TransactionSpec | undefined): string {
    const state = create(text);
    const spec = command(state);
    assert.ok(spec, 'the command handles the key');
    return show(state.update(spec).state);
}

const numbers = (lines: string[]) => lines.map((_, i) => analyzeLine(lines[i], 4).list?.kind === 'number' ? displayNumber(n => lines[n], i, 4) : undefined);

suite('Webview lists: parsing and numbering', () => {

    test('list item markers', () => {
        assert.deepStrictEqual(analyzeLine('- item', 4).list, { kind: 'bullet', text: '-', number: 0 });
        assert.strictEqual(analyzeLine('- item', 4).textStart, 2);
        assert.deepStrictEqual(analyzeLine('* item', 4).list?.text, '*');
        const numbered = analyzeLine('  12. item', 4);
        assert.deepStrictEqual([numbered.kind, numbered.list, numbered.textStart], ['note', { kind: 'number', text: '12.', number: 12 }, 6]);
        assert.strictEqual(analyzeLine('- ', 4).list?.kind, 'bullet');
        for (const text of ['-x', '1.5 hours', '1 . x', '[ ] - x', '--- x', 'x - y']) {
            assert.strictEqual(analyzeLine(text, 4).list, undefined, text);
        }
    });

    test('numbers display like markdown: the first item\'s number, then counting up', () => {
        assert.deepStrictEqual(numbers(['1. a', '1. b', '    - sub', '7. c']), [1, 2, undefined, 3]);
        assert.deepStrictEqual(numbers(['3. a', '1. b']), [3, 4]);
        assert.deepStrictEqual(numbers(['1. a', '', '1. b']), [1, undefined, 2]);
        assert.deepStrictEqual(numbers(['1. a', '    1. x', '    5. y', '2. b']), [1, 1, 2, 2]);
    });

    test('a different line at the same level, a shallower line or a header starts a new list', () => {
        assert.deepStrictEqual(numbers(['1. a', 'note', '1. b']), [1, undefined, 1]);
        assert.deepStrictEqual(numbers(['1. a', '- bullet', '1. b']), [1, undefined, 1]);
        assert.deepStrictEqual(numbers(['    1. a', 'top', '    1. b']), [1, undefined, 1]);
        assert.deepStrictEqual(numbers(['1. a', getDailyHeader(10, 5), '1. b']), [1, undefined, 1]);
    });

    test('bullet depth counts the list items a line is nested under', () => {
        const lines = ['- a', '    - b', '        - c', '            - d', '- e', '[ ] task', '    - under a task', 'note', '    - under a note'];
        assert.deepStrictEqual(lines.map((_, i) => listDepth(n => lines[n], i, 4)), [0, 1, 2, 3, 0, 0, 0, 0, 0]);
    });
});

suite('Webview lists: editing', () => {

    test('Enter continues the list with the same marker, or the next number', () => {
        assert.strictEqual(press(DAY + '- a§', enterCommand), DAY + '- a\n- §');
        assert.strictEqual(press(DAY + '* sp§lit', enterCommand), DAY + '* sp\n* §lit');
        assert.strictEqual(press(DAY + '1. a\n1. b§', enterCommand), DAY + '1. a\n1. b\n3. §');
        assert.strictEqual(press(DAY + '[ ] t\n    - a§', enterCommand), DAY + '[ ] t\n    - a\n    - §');
    });

    test('Enter at the start of an item adds an empty item above', () => {
        assert.strictEqual(press(DAY + '- §a', enterCommand), DAY + '- \n- §a');
        assert.strictEqual(press(DAY + '1. a\n5. §b', enterCommand), DAY + '1. a\n2. \n5. §b');
    });

    test('Enter on an empty item outdents it, or removes the marker', () => {
        assert.strictEqual(press(DAY + '- a\n- §', enterCommand), DAY + '- a\n§');
        assert.strictEqual(press(DAY + '- a\n    - §', enterCommand), DAY + '- a\n- §');
        assert.strictEqual(press(DAY + '1. a\n    1. §', enterCommand), DAY + '1. a\n2. §');
    });

    test('Backspace at the start of the text removes the marker', () => {
        assert.strictEqual(press(DAY + '    - §item', backspaceCommand), DAY + '    §item');
        assert.strictEqual(press(DAY + '12. §x', backspaceCommand), DAY + '§x');
    });

    test('Delete at the end of a line joins the next item without its marker', () => {
        assert.strictEqual(press(DAY + '- a§\n- b', deleteForwardCommand), DAY + '- a§b');
    });

    test('Tab starts a new numbered list at 1, or continues the deeper list it joins', () => {
        assert.strictEqual(press(DAY + '1. a\n2. b§', state => indentCommand(state, 1)), DAY + '1. a\n    1. b§');
        assert.strictEqual(press(DAY + '1. a\n    1. x\n2. b§', state => indentCommand(state, 1)), DAY + '1. a\n    1. x\n    2. b§');
        assert.strictEqual(press(DAY + '- a\n- b§\n    - c', state => indentCommand(state, 1)), DAY + '- a\n    - b§\n        - c');
    });

    test('Shift+Tab numbers an item after the numbered item it now follows, and moves its subtree', () => {
        assert.strictEqual(press(DAY + '1. a\n    1. b§', state => indentCommand(state, -1)), DAY + '1. a\n2. b§');
        assert.strictEqual(press(DAY + '1. a\n    3. b§\n        - c', state => indentCommand(state, -1)), DAY + '1. a\n2. b§\n    - c');
        assert.strictEqual(press(DAY + '- a\n    4. b§', state => indentCommand(state, -1)), DAY + '- a\n1. b§');
        assert.strictEqual(press(DAY + '1. a\n\t1. b§', state => indentCommand(state, -1)), DAY + '1. a\n2. b§');
    });

    test('typing a marker at the start of a note is a smart edit, never parent statuses', () => {
        let state = create(DAY + '[x] parent\n    [x] child\n    §note');
        const results: (number | undefined)[] = [];
        for (const ch of '- ') {
            const head = state.selection.main.head;
            const tr = state.update({ changes: { from: head, insert: ch }, selection: EditorSelection.cursor(head + 1), userEvent: 'input.type' });
            results.push(typingLine(tr));
            state = tr.state;
        }
        assert.strictEqual(show(state), DAY + '[x] parent\n    [x] child\n    - §note');
        assert.ok(results[0] !== undefined && results[1] === undefined, 'the "-" is typing, the space that makes it a list item is not');
        assert.strictEqual(analyzeLine(state.doc.line(state.doc.lines).text, 4).list?.kind, 'bullet');
    });
});

suite('Webview links', () => {

    test('markdown links and bare URLs', () => {
        const text = 'see [the docs](https://x.y/z?a=1) and https://a.b/c. or mailto:me@x.com, [q4](docs/q4.md)';
        const links = findLinks(text);
        assert.deepStrictEqual(links.map(link => [link.kind, text.slice(link.from, link.to), text.slice(link.textFrom, link.textTo), link.href]), [
            ['markdown', '[the docs](https://x.y/z?a=1)', 'the docs', 'https://x.y/z?a=1'],
            ['url', 'https://a.b/c', 'https://a.b/c', 'https://a.b/c'],
            ['url', 'mailto:me@x.com', 'mailto:me@x.com', 'mailto:me@x.com'],
            ['markdown', '[q4](docs/q4.md)', 'q4', 'docs/q4.md'],
        ]);
    });

    test('not links', () => {
        for (const text of ['[a]', '[a](b c)', '[](x)', 'note://x', 'http:/broken', '[a] (b)']) {
            assert.deepStrictEqual(findLinks(text), [], text);
        }
        assert.deepStrictEqual(findLinks('- [x](y) after', 2).map(link => link.href), ['y']);
    });

    test('a single URL to paste', () => {
        assert.strictEqual(singleUrl(' https://x.y/z \n'), 'https://x.y/z');
        assert.strictEqual(singleUrl('mailto:a@b.c'), 'mailto:a@b.c');
        assert.strictEqual(singleUrl('vscode://file/x'), 'vscode://file/x');
        for (const text of ['https://x y', 'see https://x.y', 'docs/q4.md', '', 'https://a\nhttps://b']) {
            assert.strictEqual(singleUrl(text), undefined, text);
        }
        assert.strictEqual(linkForPaste('docs', 'https://e.com/a(b)'), '[docs](https://e.com/a%28b%29)');
        assert.strictEqual(linkForPaste('a]b', 'https://e.com'), undefined);
        assert.strictEqual(linkForPaste('docs', 'not a url'), undefined);
    });

    function paste(text: string, select: string, pasted: string, occurrence = 0): string {
        const state = create(text);
        let from = -1;
        for (let i = 0; i <= occurrence; i++) {
            from = state.doc.toString().indexOf(select, from + 1);
        }
        const selected = state.update({ selection: EditorSelection.range(from, from + select.length) }).state;
        const tr = selected.update({ changes: { from, to: from + select.length, insert: pasted }, selection: EditorSelection.cursor(from + pasted.length), userEvent: 'input.paste' });
        let changes = 0;
        tr.changes.iterChanges(() => changes++);
        assert.strictEqual(changes, 1, 'one change');
        return show(tr.state);
    }

    test('pasting a URL over selected text makes a markdown link', () => {
        assert.strictEqual(paste(DAY + '[ ] read the docs please', 'docs', 'https://example.com/a\n'), DAY + '[ ] read the [docs](https://example.com/a)§ please');
        assert.strictEqual(paste(DAY + '- item text', 'text', 'mailto:me@x.com'), DAY + '- item [text](mailto:me@x.com)§');
    });

    test('other pastes are pasted as they are', () => {
        assert.strictEqual(paste(DAY + '[ ] read the docs', 'docs', 'not a url'), DAY + '[ ] read the not a url§');
        // Selection that includes the hidden box, or spans lines, or touches a link
        assert.strictEqual(paste(DAY + '[ ] read', '[ ] read', 'https://e.com'), DAY + 'https://e.com§');
        assert.strictEqual(paste(DAY + '[ ] a\n[ ] b', 'a\n[ ] b', 'https://e.com'), DAY + '[ ] https://e.com§');
        assert.strictEqual(paste(DAY + 'see [x](y) z', ') z', 'https://e.com'), DAY + 'see [x](yhttps://e.com§');
    });
});
