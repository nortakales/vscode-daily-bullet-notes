import * as vscode from 'vscode';

import Parser from '../documentParser';
import { getBoxHeader } from '../strings';
export async function addNewList() {


    const editor = vscode.window.activeTextEditor;
    if (!editor) {
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