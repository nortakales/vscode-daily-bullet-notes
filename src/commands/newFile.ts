import * as vscode from 'vscode';
import { getNewFileTemplate, getNewLogHeaders } from '../strings';
import { DBM_LANGUAGE_ID } from '../utilities';
import { defaultViewIsRendered } from '../rendered/viewSwitching';
import { getRenderedViewProvider, RENDERED_VIEW_TYPE } from '../rendered/renderedViewProvider';

/**
 * Opens a new editor with everything needed for today, with today pre-populated with examples
 */
export async function newFile() {
    const date = new Date();
    const document = await vscode.workspace.openTextDocument({
        language: DBM_LANGUAGE_ID,
        content: getNewFileTemplate(date)
    });
    // Put the cursor at the first example task under today's header
    const firstTaskLine = getNewLogHeaders(date).split("\n").length;

    const provider = getRenderedViewProvider();
    if (provider && defaultViewIsRendered()) {
        provider.revealWhenOpened(document, { line: firstTaskLine });
        await vscode.commands.executeCommand('vscode.openWith', document.uri, RENDERED_VIEW_TYPE);
        return;
    }

    const editor = await vscode.window.showTextDocument(document);
    const cursorPosition = new vscode.Position(firstTaskLine, 0);
    editor.selection = new vscode.Selection(cursorPosition, cursorPosition);
    editor.revealRange(new vscode.Range(cursorPosition, cursorPosition));
}
