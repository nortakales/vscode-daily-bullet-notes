import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { RenderedViewProvider } from '../rendered/renderedViewProvider';
import type { HostMessage, LineChange } from '../rendered/protocol';
import { getDailyHeader, getNewLogHeaders } from '../strings';

// Integration tests for the rendered view's extension host side, running the real webview bundle

const VIEW_TYPE = 'daily-bullet-notes.renderedView';
const HEADERS = getNewLogHeaders(new Date(2025, 9, 2)).split('\n'); // a past day, so Add Today adds a new one
const FIRST = HEADERS.length;
const DAY = [...HEADERS, '[ ] Deploy', '    [ ] build', '    [ ] push', '', '+----------------------------------------+', '|               Backburner               |', '+----------------------------------------+', 'an idea', ''];

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check: () => boolean, timeout = 10000) {
	const start = Date.now();
	while (Date.now() - start < timeout && !check()) {
		await sleep(50);
	}
	return check();
}

let provider: RenderedViewProvider;
let tempDir: string;
let fileCount = 0;
let messages: { document: vscode.TextDocument, message: HostMessage }[] = [];

function createFile(lines: string[], eol = '\n') {
	const file = path.join(tempDir, `test-${++fileCount}.dbm`);
	fs.writeFileSync(file, lines.join(eol));
	return vscode.Uri.file(file);
}

function messagesFor(document: vscode.TextDocument, type?: HostMessage['type']) {
	return messages.filter(entry => entry.document === document && (!type || entry.message.type === type)).map(entry => entry.message);
}

function epochOf(document: vscode.TextDocument) {
	return provider.getPanelsForTesting(document)[0].epoch;
}

async function openRendered(uri: vscode.Uri) {
	await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
	const document = await vscode.workspace.openTextDocument(uri);
	assert.ok(await waitFor(() => provider.getPanelsForTesting(document).some(panel => panel.ready)), 'webview never became ready');
	return document;
}

function activeTabInput() {
	return vscode.window.tabGroups.activeTabGroup.activeTab?.input;
}

function tabsFor(uri: vscode.Uri) {
	return vscode.window.tabGroups.activeTabGroup.tabs.filter(tab =>
		(tab.input instanceof vscode.TabInputText || tab.input instanceof vscode.TabInputCustom) && tab.input.uri.toString() === uri.toString());
}

function change(line: number, from: number, to: number, text: string): LineChange {
	return { fromLine: line, fromCharacter: from, toLine: line, toCharacter: to, text };
}

suite('Rendered view', () => {

	suiteSetup(async () => {
		const extension = vscode.extensions.getExtension('nortakales.daily-bullet-notes')!;
		provider = (await extension.activate() as { renderedViewProvider: RenderedViewProvider }).renderedViewProvider;
		provider.onDidPostMessage.event(entry => messages.push(entry));
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbm-rendered-'));
	});

	setup(() => {
		messages = [];
	});

	teardown(async () => {
		for (const document of vscode.workspace.textDocuments) {
			if (document.isDirty && document.uri.fsPath.startsWith(tempDir)) {
				await document.save();
			}
		}
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');
	});

	suiteTeardown(async () => {
		await vscode.workspace.getConfiguration('daily-bullet-notes').update('defaultView', undefined, vscode.ConfigurationTarget.Global);
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	test('opens in the rendered view and the webview loads the document', async () => {
		const uri = createFile(DAY);
		const document = await openRendered(uri);
		const input = activeTabInput();
		assert.ok(input instanceof vscode.TabInputCustom && input.viewType === VIEW_TYPE);
		const init = messagesFor(document, 'init')[0];
		assert.ok(init && init.type === 'init');
		assert.strictEqual(init.text, DAY.join('\n'));
		assert.strictEqual(init.config.automaticStatusUpdates, true);
	});

	test('a webview edit is applied exactly, as one undo step', async () => {
		const document = await openRendered(createFile(DAY));
		await provider.handleMessageForTesting(document, {
			type: 'edit', epoch: epochOf(document), changes: [
				change(FIRST, 1, 2, '+'),
				change(FIRST + 1, 5, 6, 'x'),
			]
		});
		assert.strictEqual(document.lineAt(FIRST).text, '[+] Deploy');
		assert.strictEqual(document.lineAt(FIRST + 1).text, '    [x] build');
		await vscode.commands.executeCommand('undo');
		assert.ok(await waitFor(() => document.getText() === DAY.join('\n')), document.getText());
	});

	test('own edits are not echoed, other changes are sent with a new epoch, stale edits are dropped', async () => {
		const document = await openRendered(createFile(DAY));
		const epoch = epochOf(document);
		await provider.handleMessageForTesting(document, { type: 'edit', epoch, changes: [change(FIRST + 2, 5, 6, '/')] });
		await sleep(300);
		assert.deepStrictEqual(messagesFor(document, 'update'), []);

		const edit = new vscode.WorkspaceEdit();
		edit.insert(document.uri, new vscode.Position(FIRST + 3, 0), 'note from elsewhere');
		await vscode.workspace.applyEdit(edit);
		assert.ok(await waitFor(() => messagesFor(document, 'update').length === 1));
		const update = messagesFor(document, 'update')[0];
		assert.ok(update.type === 'update' && update.epoch === epoch + 1 && update.text === document.getText());

		const before = document.getText();
		await provider.handleMessageForTesting(document, { type: 'edit', epoch, changes: [change(FIRST, 1, 2, 'x')] });
		assert.strictEqual(document.getText(), before);
	});

	test('CRLF files get CRLF line breaks and the webview gets LF', async () => {
		const document = await openRendered(createFile(DAY, '\r\n'));
		assert.strictEqual(document.eol, vscode.EndOfLine.CRLF);
		const init = messagesFor(document, 'init')[0];
		assert.ok(init.type === 'init' && !init.text.includes('\r'));
		await provider.handleMessageForTesting(document, {
			type: 'edit', epoch: epochOf(document), changes: [change(FIRST + 2, 12, 12, '\n    [ ] announce')]
		});
		assert.strictEqual(document.lineAt(FIRST + 3).text, '    [ ] announce');
		assert.ok(!/[^\r]\n/.test(document.getText()), 'found a bare LF');
	});

	test('the text editor edit listener does not react to rendered view edits', async () => {
		const document = await openRendered(createFile(DAY));
		// Would make the text editor remove the bare box, and recalculate the parent status
		await provider.handleMessageForTesting(document, {
			type: 'edit', epoch: epochOf(document), changes: [change(FIRST + 1, 5, 6, 'x'), change(FIRST + 2, 7, 12, '')]
		});
		await sleep(600);
		assert.strictEqual(document.lineAt(FIRST).text, '[ ] Deploy');
		assert.strictEqual(document.lineAt(FIRST + 1).text, '    [x] build');
		assert.strictEqual(document.lineAt(FIRST + 2).text, '    [ ]');
	});

	test('the webview answers flush requests', async () => {
		const document = await openRendered(createFile(DAY));
		const start = Date.now();
		await provider.flush(document);
		assert.ok(Date.now() - start < 900, 'the webview never replied, so flush timed out');
		assert.strictEqual(messagesFor(document, 'flush').length, 1);
	});

	test('saving includes typing the webview was holding back', async () => {
		const document = await openRendered(createFile(DAY));
		// An earlier change, so the file is modified and saving runs the save participants
		await provider.handleMessageForTesting(document, { type: 'edit', epoch: epochOf(document), changes: [change(FIRST + 1, 5, 6, 'x')] });
		assert.ok(document.isDirty);
		// Act like a webview holding back typing: send it as soon as the flush request arrives
		const listener = provider.onDidPostMessage.event(entry => {
			if (entry.document === document && entry.message.type === 'flush') {
				provider.handleMessageForTesting(document, { type: 'edit', epoch: epochOf(document), changes: [change(FIRST, 10, 10, ' service')] });
			}
		});
		try {
			await document.save();
		} finally {
			listener.dispose();
		}
		assert.strictEqual(document.lineAt(FIRST).text, '[ ] Deploy service');
		assert.ok(!document.isDirty);
		assert.ok(fs.readFileSync(document.uri.fsPath, 'utf8').includes('[ ] Deploy service'));
	});

	test('Ctrl+S right after typing in an unmodified file saves the typing', async () => {
		// The webview keeps Ctrl+S from VS Code in this case, sends the typing, then asks for a save
		const document = await openRendered(createFile(DAY));
		assert.ok(!document.isDirty);
		provider.handleMessageForTesting(document, { type: 'edit', epoch: epochOf(document), changes: [change(FIRST, 10, 10, ' today')] });
		const start = Date.now();
		await provider.handleMessageForTesting(document, { type: 'save' });
		assert.ok(await waitFor(() => !document.isDirty, 3000), 'not saved');
		assert.ok(Date.now() - start < 800, `saving took ${Date.now() - start} ms`);
		assert.strictEqual(document.lineAt(FIRST).text, '[ ] Deploy today');
		assert.ok(fs.readFileSync(document.uri.fsPath, 'utf8').includes('[ ] Deploy today'));
	});

	test('switching views replaces the tab and keeps the cursor line', async () => {
		const uri = createFile(DAY);
		const editor = await vscode.window.showTextDocument(uri, { preview: false });
		editor.selection = new vscode.Selection(FIRST + 1, 0, FIRST + 1, 0);

		await vscode.commands.executeCommand('daily-bullet-notes.openRenderedView');
		const document = editor.document;
		assert.ok(await waitFor(() => provider.getPanelsForTesting(document).some(panel => panel.ready)));
		const input = activeTabInput();
		assert.ok(input instanceof vscode.TabInputCustom && input.viewType === VIEW_TYPE);
		assert.strictEqual(tabsFor(uri).length, 1);
		const init = messagesFor(document, 'init')[0];
		assert.ok(init.type === 'init' && init.reveal?.line === FIRST + 1);

		await provider.handleMessageForTesting(document, { type: 'selection', line: FIRST + 2 });
		await vscode.commands.executeCommand('daily-bullet-notes.openTextView');
		assert.ok(await waitFor(() => vscode.window.activeTextEditor?.document === document));
		assert.strictEqual(vscode.window.activeTextEditor!.selection.active.line, FIRST + 2);
		assert.strictEqual(tabsFor(uri).length, 1);
	});

	test('switching views works for a new unsaved file without asking to save it', async () => {
		await vscode.commands.executeCommand('daily-bullet-notes.newFile');
		const document = vscode.window.activeTextEditor!.document;
		const text = document.getText();
		assert.ok(document.isUntitled && document.isDirty);

		await vscode.commands.executeCommand('daily-bullet-notes.openRenderedView');
		assert.ok(await waitFor(() => provider.getPanelsForTesting(document).some(panel => panel.ready)), 'rendered view did not open');
		const input = activeTabInput();
		assert.ok(input instanceof vscode.TabInputCustom && input.viewType === VIEW_TYPE);
		assert.strictEqual(tabsFor(document.uri).length, 1, 'the text editor tab is still open');
		assert.ok(!document.isClosed && document.isDirty && document.getText() === text);

		await vscode.commands.executeCommand('daily-bullet-notes.openTextView');
		assert.ok(await waitFor(() => vscode.window.activeTextEditor?.document === document), 'text view did not open');
		assert.strictEqual(tabsFor(document.uri).length, 1, 'the rendered view tab is still open');
		assert.ok(document.isDirty && document.getText() === text);
		await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
	});

	test('switching views works for a modified file without asking to save it', async () => {
		const uri = createFile(DAY);
		const editor = await vscode.window.showTextDocument(uri, { preview: false });
		await editor.edit(builder => builder.insert(new vscode.Position(FIRST, 10), '!'));
		assert.ok(editor.document.isDirty);
		await vscode.commands.executeCommand('daily-bullet-notes.openRenderedView');
		assert.ok(await waitFor(() => provider.getPanelsForTesting(editor.document).some(panel => panel.ready)), 'rendered view did not open');
		assert.strictEqual(tabsFor(uri).length, 1, 'the text editor tab is still open');
		await vscode.commands.executeCommand('daily-bullet-notes.openTextView');
		assert.ok(await waitFor(() => vscode.window.activeTextEditor?.document === editor.document), 'text view did not open');
		assert.strictEqual(tabsFor(uri).length, 1, 'the rendered view tab is still open');
		assert.ok(editor.document.isDirty && editor.document.lineAt(FIRST).text === '[ ] Deploy!');
	});

	test('links open files relative to the document, and command links are refused', async () => {
		const document = await openRendered(createFile(DAY));
		const other = path.join(tempDir, 'linked notes.txt');
		fs.writeFileSync(other, 'linked');
		await provider.handleMessageForTesting(document, { type: 'openLink', href: 'linked%20notes.txt' });
		assert.ok(await waitFor(() => vscode.window.activeTextEditor?.document.uri.fsPath === other), 'the relative link did not open');

		let ran = false;
		const command = vscode.commands.registerCommand('daily-bullet-notes.test.linkCommand', () => { ran = true; });
		try {
			await provider.handleMessageForTesting(document, { type: 'openLink', href: 'command:daily-bullet-notes.test.linkCommand' });
			await sleep(300);
			assert.strictEqual(ran, false);
		} finally {
			command.dispose();
		}
	});

	for (const [setting, field] of [['centeredLayout', 'centered'], ['pinToolbar', 'pinToolbar'], ['pinHeaders', 'pinHeaders']] as const) {
		test(`the ${setting} setting is sent to the webview`, async () => {
			const document = await openRendered(createFile(DAY));
			const init = messagesFor(document, 'init')[0];
			assert.ok(init.type === 'init' && init.config[field] === true);
			const config = vscode.workspace.getConfiguration('daily-bullet-notes');
			await config.update(`renderedView.${setting}`, false, vscode.ConfigurationTarget.Global);
			try {
				assert.ok(await waitFor(() => messagesFor(document, 'config').some(message => message.type === 'config' && message.config[field] === false)));
			} finally {
				await config.update(`renderedView.${setting}`, undefined, vscode.ConfigurationTarget.Global);
			}
		});
	}

	test('the defaultView setting decides which view opens .dbm files', async () => {
		const config = vscode.workspace.getConfiguration('daily-bullet-notes');
		await config.update('defaultView', 'rendered', vscode.ConfigurationTarget.Global);
		assert.ok(await waitFor(() => vscode.workspace.getConfiguration('workbench').get<Record<string, string>>('editorAssociations')?.['*.dbm'] === VIEW_TYPE));
		const uri = createFile(DAY);
		await vscode.commands.executeCommand('vscode.open', uri);
		assert.ok(await waitFor(() => { const input = activeTabInput(); return input instanceof vscode.TabInputCustom && input.viewType === VIEW_TYPE; }));
		await vscode.commands.executeCommand('workbench.action.closeAllEditors');

		await config.update('defaultView', 'text', vscode.ConfigurationTarget.Global);
		assert.ok(await waitFor(() => vscode.workspace.getConfiguration('workbench').get<Record<string, string>>('editorAssociations')?.['*.dbm'] === undefined));
		await vscode.commands.executeCommand('vscode.open', uri);
		assert.ok(await waitFor(() => activeTabInput() instanceof vscode.TabInputText));
	});

	test('Add Today, Standup View and Find work from the rendered view', async () => {
		const document = await openRendered(createFile(DAY));
		await vscode.commands.executeCommand('daily-bullet-notes.addToday');
		const today = new Date();
		const header = getDailyHeader(today.getMonth() + 1, today.getDate());
		assert.ok(await waitFor(() => document.getText().includes(header)), 'today was not added');
		assert.ok(await waitFor(() => messagesFor(document, 'reveal').length === 1));
		const headerLine = document.getText().split('\n').indexOf(header);
		const reveal = messagesFor(document, 'reveal')[0];
		// Revealed at the last carried over task, like the text editor's cursor
		assert.ok(reveal.type === 'reveal' && reveal.target.line === headerLine + 3 && reveal.target.atEnd);
		assert.strictEqual(document.lineAt(headerLine + 1).text, '[ ] Deploy');

		await vscode.commands.executeCommand('daily-bullet-notes.standupView');
		await vscode.commands.executeCommand('daily-bullet-notes.renderedView.find');
		const commands = messagesFor(document, 'command').map(message => message.type === 'command' && message.command);
		assert.deepStrictEqual(commands, ['standupView', 'find']);
	});
});
