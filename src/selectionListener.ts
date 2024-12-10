import * as vscode from 'vscode';
import { parseCursorPositionForBox } from './utilities';

export async function onSelectionChange(event: vscode.TextEditorSelectionChangeEvent) {
    console.log(event);

    // Only run this for mouse clicks
    if (event.kind !== vscode.TextEditorSelectionChangeKind.Mouse) {
        return;
    }
    // Only for a single selection
    if (event.selections.length !== 1) {
        return;
    }

    const selection = event.selections[0];
    const line = selection.start.line;
    const character = selection.start.character;

    // Only if the selection is not a range
    if (line !== selection.end.line || character !== selection.end.character) {
        return;
    }

    const boxMatch = parseCursorPositionForBox(selection.start, event.textEditor.document);
    if (!boxMatch) {
        return;
    }
    if (boxMatch.hasInnerPart) {
        // Select the inner part of the box
        event.textEditor.selection = new vscode.Selection(
            boxMatch.innerBoxRange.start,
            boxMatch.innerBoxRange.end
        );
    }

    await vscode.commands.executeCommand('editor.action.triggerSuggest');
}