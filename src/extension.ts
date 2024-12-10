import * as vscode from 'vscode';
import Commands from './commands';
import DBMFoldingRangeProvider from './foldingRangeProvider';
import DBMCompletionsProvider from './completionsProvider';

export function activate(context: vscode.ExtensionContext) {

	context.subscriptions.push(
		vscode.languages.registerFoldingRangeProvider({
			//scheme: 'file',
			language: 'daily-bullet-notes'
		}, new DBMFoldingRangeProvider())
	);

	context.subscriptions.push(
		vscode.languages.registerCompletionItemProvider({
			//scheme: 'file',
			language: 'daily-bullet-notes'
		}, new DBMCompletionsProvider())
	);

	new Commands(context);

	console.log('daily-bullet-notes is now active');
}

// This method is called when your extension is deactivated
export function deactivate() { }
