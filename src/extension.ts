import * as vscode from 'vscode';
import DBMFoldingRangeProvider from './foldingRangeProvider';
import DBMCompletionsProvider from './completionsProvider';
import { onSelectionChange } from './selectionListener';
import { addToday } from './commands/addToday';
import { addNewList } from './commands/addNewList';
import { standupView } from './commands/standupView';
import { newFile } from './commands/newFile';

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

	context.subscriptions.push(
		vscode.commands.registerCommand("daily-bullet-notes.addToday", addToday),
		vscode.commands.registerCommand("daily-bullet-notes.addNewList", addNewList),
		vscode.commands.registerCommand("daily-bullet-notes.standupView", standupView),
		vscode.commands.registerCommand("daily-bullet-notes.newFile", newFile),
	);
}

// This method is called when the extension is deactivated
export function deactivate() { }
