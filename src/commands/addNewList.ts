import * as vscode from 'vscode';

import Parser from '../documentParser';
import { getBoxHeader } from '../strings';
import { getActiveDbmTarget } from '../rendered/viewSwitching';
import { getRenderedViewProvider } from '../rendered/renderedViewProvider';
export async function addNewList() {


    const target = getActiveDbmTarget();
    if (!target) {
        console.log("Could not detect editor");
        return;
    }

    // TODO get width preference
    const width = 42;

    const newListTitle = await vscode.window.showInputBox({
        prompt: "Enter the name of your new list",
        title: "New List",
        validateInput: (currentValue) => {
            if (!currentValue) {
                return "Must enter a title for your new list";
            }
            if (currentValue.length > (width - 2)) {
                return "Title is too long to fit within your preferred width of " + width;
            }
        }
    });

    if (!newListTitle) {
        return;
    }

    const newListBox = getBoxHeader(newListTitle);

    if (target.kind === 'rendered') {
        const document = target.document;
        await getRenderedViewProvider()?.flush(document);
        const finalLine = document.lineAt(document.lineCount - 1);
        const edit = new vscode.WorkspaceEdit();
        edit.insert(document.uri, finalLine.range.end, `\n${newListBox}\n`);
        if (await vscode.workspace.applyEdit(edit)) {
            getRenderedViewProvider()?.reveal(document, { line: document.lineCount - 1 });
        }
        return;
    }
    const editor = target.editor;

    // TODO could use await

    editor.edit(editBuilder => {
        const finalLine = editor.document.lineAt(editor.document.lineCount - 1);
        const endOfLine = finalLine.range.end.character;
        editBuilder.insert(new vscode.Position(editor.document.lineCount - 1, endOfLine), `\n${newListBox}\n`);
    }).then(() => {

        const newCursorPosition = new vscode.Position(editor.document.lineCount - 1, 0);
        editor.selection = new vscode.Selection(newCursorPosition, newCursorPosition);
        editor.revealRange(new vscode.Range(newCursorPosition, newCursorPosition), vscode.TextEditorRevealType.InCenter);
    });

}