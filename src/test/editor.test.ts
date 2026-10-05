import * as assert from 'assert';
import * as vscode from 'vscode';
import { getBoxHeader, getNewFileTemplate, getNewLogHeaders } from '../strings';
import { describeMissingDailyLog } from '../dailyLogCheck';

// Integration tests that drive a real editor, since status updates are triggered by edit events

const HEADERS = getNewLogHeaders(new Date(2026, 9, 4)).split('\n');
const FIRST = HEADERS.length; // first line after the day header

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(check: () => boolean, timeout = 3000) {
	const start = Date.now();
	while (Date.now() - start < timeout && !check()) {
		await sleep(50);
	}
	return check();
}

async function open(lines: string[], language = 'daily-bullet-notes') {
	const document = await vscode.workspace.openTextDocument({ language, content: lines.join('\n') });
	return vscode.window.showTextDocument(document);
}

function line(editor: vscode.TextEditor, lineNumber: number) {
	return editor.document.lineAt(lineNumber).text;
}

async function typeInBox(editor: vscode.TextEditor, lineNumber: number, status: string) {
	const boxStart = line(editor, lineNumber).indexOf('[');
	editor.selection = new vscode.Selection(lineNumber, boxStart + 1, lineNumber, boxStart + 2);
	await vscode.commands.executeCommand('type', { text: status });
}

suite('Editor integration', () => {

	suiteSetup(async () => {
		await vscode.extensions.getExtension('nortakales.daily-bullet-notes')!.activate();
	});

	test('parent statuses also update in lists after the daily log', async () => {
		const list = getBoxHeader('Backburner').split('\n');
		const editor = await open([...HEADERS, '[ ] day task', '', ...list, '[ ] Project', '    [ ] step one', '    [x] step two', '', ...getBoxHeader('Ideas').split('\n'), 'an idea']);
		const project = FIRST + 2 + list.length;
		await typeInBox(editor, project + 1, 'x');
		assert.ok(await waitFor(() => line(editor, project) === '[x] Project'), line(editor, project));
		await typeInBox(editor, project + 2, ' ');
		assert.ok(await waitFor(() => line(editor, project) === '[+] Project'), line(editor, project));
	});

	test('typing - into a sub-task updates the parent', async () => {
		const editor = await open([...HEADERS, '[+] Deploy', '    [x] build', '    [ ] push', '']);
		await typeInBox(editor, FIRST + 2, '-');
		assert.ok(await waitFor(() => line(editor, FIRST) === '[x] Deploy'), line(editor, FIRST));
	});

	test('[>] sub-task with a done sibling makes the parent [+], not [x]', async () => {
		const editor = await open([...HEADERS, '[ ] Deploy', '    [x] build', '    [ ] announce', '']);
		await typeInBox(editor, FIRST + 2, '>');
		assert.ok(await waitFor(() => line(editor, FIRST) === '[+] Deploy'), line(editor, FIRST));
		await sleep(500);
		assert.strictEqual(line(editor, FIRST), '[+] Deploy');
	});

	test('deleting the last sub-task line updates the parent', async () => {
		const editor = await open([...HEADERS, '[+] Deploy', '    [x] build', '    [ ] push', '', 'a note']);
		editor.selection = new vscode.Selection(FIRST + 2, 0, FIRST + 2, 0);
		await vscode.commands.executeCommand('editor.action.deleteLines');
		assert.ok(await waitFor(() => line(editor, FIRST) === '[x] Deploy'), line(editor, FIRST));
	});

	test('a checklist under a note does not change the task above it', async () => {
		const editor = await open([...HEADERS, '[ ] Write report', 'Meeting notes:', '    [ ] send doc', '    [ ] follow up', '']);
		await typeInBox(editor, FIRST + 2, 'x');
		await sleep(600);
		assert.strictEqual(line(editor, FIRST), '[ ] Write report');
	});

	test('status updates go to the edited document after switching editors', async () => {
		const editor = await open([...HEADERS, '[ ] Deploy', '    [ ] build', '']);
		await typeInBox(editor, FIRST + 1, 'x');
		// Switch to another file before the debounced status update runs
		const otherLines = Array.from({ length: 30 }, (_, i) => `plain text line ${i}`);
		const other = await open(otherLines, 'plaintext');
		await waitFor(() => editor.document.lineAt(FIRST).text === '[x] Deploy');
		assert.strictEqual(editor.document.lineAt(FIRST).text, '[x] Deploy');
		assert.strictEqual(other.document.getText(), otherLines.join('\n'));
	});

	test('undoing an automatic status update does not re-apply it', async () => {
		const editor = await open([...HEADERS, '[ ] Deploy', '    [ ] build', '']);
		await typeInBox(editor, FIRST + 1, 'x');
		assert.ok(await waitFor(() => line(editor, FIRST) === '[x] Deploy'));
		await vscode.commands.executeCommand('undo');
		assert.strictEqual(line(editor, FIRST), '[ ] Deploy');
		await sleep(600);
		assert.strictEqual(line(editor, FIRST), '[ ] Deploy');
	});

	test('Enter after a task still adds a box', async () => {
		const editor = await open([...HEADERS, '[ ] Deploy', '']);
		const end = line(editor, FIRST).length;
		editor.selection = new vscode.Selection(FIRST, end, FIRST, end);
		await vscode.commands.executeCommand('type', { text: '\n' });
		assert.ok(await waitFor(() => line(editor, FIRST + 1) === '[ ] '), line(editor, FIRST + 1));
	});

	test('Enter in a non Daily Bullet Notes file does not add a box', async () => {
		const editor = await open(['[1]: https://example.com'], 'markdown');
		const end = line(editor, 0).length;
		editor.selection = new vscode.Selection(0, end, 0, end);
		await vscode.commands.executeCommand('type', { text: '\n' });
		await sleep(500);
		assert.strictEqual(line(editor, 1), '');
	});

	test('Add Today without a Daily Log box does not fail or change the file', async () => {
		const lines = HEADERS.slice(3).concat(['[ ] task', '']);
		const editor = await open(lines);
		await vscode.commands.executeCommand('daily-bullet-notes.addToday');
		assert.strictEqual(editor.document.getText(), lines.join('\n'));
	});

	test('Initialize New DBM File opens a file for today, with examples, that Add Today understands', async () => {
		await vscode.commands.executeCommand('daily-bullet-notes.newFile');
		const editor = vscode.window.activeTextEditor!;
		assert.strictEqual(editor.document.languageId, 'daily-bullet-notes');
		const text = editor.document.getText();
		assert.strictEqual(text, getNewFileTemplate(new Date()));
		for (const status of ['x', '/', '-', '+', ' ', '>']) {
			assert.ok(text.includes(`\n[${status}] `), `missing [${status}] example`);
		}
		// Cursor starts on the first example task under today's header
		assert.strictEqual(editor.selection.active.line, getNewLogHeaders(new Date()).split('\n').length);
		await vscode.commands.executeCommand('daily-bullet-notes.addToday');
		// Today already exists, so nothing is added
		assert.strictEqual(editor.document.getText(), text);
	});

	suite('Daily Log error message', () => {
		const describe = async (lines: string[]) =>
			describeMissingDailyLog(await vscode.workspace.openTextDocument({ language: 'daily-bullet-notes', content: lines.join('\n') }));

		test('missing box', async () => {
			assert.match(await describe(HEADERS.slice(3)), /This file has no "Daily Log" header box/);
		});

		test('wrong capitalization', async () => {
			const lines = [...HEADERS];
			lines[1] = lines[1].replace('Daily Log', 'Daily log');
			assert.match(await describe(lines), /^Line 2 looks like your "Daily Log" header, but it must read/);
		});

		test('border too short', async () => {
			const lines = [...HEADERS];
			lines[0] = '+----------+';
			assert.match(await describe(lines), /^Line 2 .* needs a border line directly above and below it/);
		});
	});
});
