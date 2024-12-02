import * as vscode from 'vscode';
import DBMUIElements from './uiElements';
import Commands from './commands';
import DBMFoldingRangeProvider from './foldingRangeProvider';

export function activate(context: vscode.ExtensionContext) {

	const uielements = new DBMUIElements(context);

	vscode.workspace.onDidChangeConfiguration(() => {
		uielements.updateView();
	});
	vscode.window.onDidChangeActiveTextEditor(() => {
		uielements.updateView();
	});

	context.subscriptions.push(
		vscode.languages.registerFoldingRangeProvider({
			scheme: 'file',
			language: 'daily-bullet-notes'
		}, new DBMFoldingRangeProvider())
	);

	new Commands(context);

	console.log('daily-bullet-notes is now active');
}

// This method is called when your extension is deactivated
export function deactivate() { }
