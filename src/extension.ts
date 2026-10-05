import * as vscode from 'vscode';
import DBMFoldingRangeProvider from './foldingRangeProvider';
import DBMCompletionsProvider from './completionsProvider';
import { onSelectionChange } from './selectionListener';
import { addToday } from './commands/addToday';
import { addNewList } from './commands/addNewList';
import { standupView } from './commands/standupView';
import { newFile } from './commands/newFile';
import { addTodayAndStandupView } from './commands/addTodayAndStandupView';
import { onDocumentChange } from './editListener';
import { RENDERED_VIEW_TYPE, RenderedViewProvider, setRenderedViewProvider } from './rendered/renderedViewProvider';
import { getActiveDbmTarget, openRenderedView, openTextView, syncDefaultViewAssociation } from './rendered/viewSwitching';

export function activate(context: vscode.ExtensionContext) {

	context.subscriptions.push(
		vscode.languages.registerFoldingRangeProvider({
			language: 'daily-bullet-notes'
		}, new DBMFoldingRangeProvider())
	);

	context.subscriptions.push(
		vscode.languages.registerCompletionItemProvider({
			language: 'daily-bullet-notes'
		}, new DBMCompletionsProvider())
	);

	context.subscriptions.push(
		vscode.window.onDidChangeTextEditorSelection(onSelectionChange)
	);

	// Created before the edit listener below is registered, so the rendered view sees each change first
	const renderedViewProvider = new RenderedViewProvider(context.extensionUri);
	setRenderedViewProvider(renderedViewProvider);
	context.subscriptions.push(
		renderedViewProvider,
		{ dispose: () => setRenderedViewProvider(undefined) },
		vscode.window.registerCustomEditorProvider(RENDERED_VIEW_TYPE, renderedViewProvider, {
			webviewOptions: { retainContextWhenHidden: true },
			supportsMultipleEditorsPerDocument: true
		}),
		vscode.commands.registerCommand("daily-bullet-notes.openRenderedView", () => openRenderedView(renderedViewProvider)),
		vscode.commands.registerCommand("daily-bullet-notes.openTextView", () => openTextView(renderedViewProvider)),
		vscode.commands.registerCommand("daily-bullet-notes.renderedView.find", () => {
			const target = getActiveDbmTarget();
			if (target?.kind === 'rendered') {
				renderedViewProvider.runCommand(target.document, 'find');
			}
		}),
		vscode.workspace.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration('daily-bullet-notes.defaultView')) {
				syncDefaultViewAssociation().catch(console.error);
			}
		})
	);
	syncDefaultViewAssociation(true).catch(console.error);

	context.subscriptions.push(
		vscode.workspace.onDidChangeTextDocument(onDocumentChange)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand("daily-bullet-notes.addToday", addToday),
		vscode.commands.registerCommand("daily-bullet-notes.addTodayAndStandupView", addTodayAndStandupView),
		vscode.commands.registerCommand("daily-bullet-notes.addNewList", addNewList),
		vscode.commands.registerCommand("daily-bullet-notes.standupView", standupView),
		vscode.commands.registerCommand("daily-bullet-notes.newFile", newFile),
	);

	// Used by the integration tests
	return { renderedViewProvider };
}

// This method is called when the extension is deactivated
export function deactivate() { }
