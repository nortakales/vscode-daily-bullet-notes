import * as vscode from 'vscode';
import { DailyBulletNotesDocument } from './documentModel';

export const DBM_LANGUAGE_ID = 'daily-bullet-notes';

/**
 * Finds an editor showing the given document, preferring the active editor
 */
export function getEditorForDocument(document: vscode.TextDocument): vscode.TextEditor | undefined {
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor?.document === document) {
        return activeEditor;
    }
    return vscode.window.visibleTextEditors.find(editor => editor.document === document);
}

/**
 * Applies edits to the given document, even if it is no longer the active editor
 */
export async function applyEditsToDocument(document: vscode.TextDocument, edits: { range: vscode.Range, text: string }[]): Promise<boolean> {
    if (document.isClosed || edits.length === 0) {
        return false;
    }
    const editor = getEditorForDocument(document);
    if (editor) {
        return editor.edit(editBuilder => {
            for (const edit of edits) {
                editBuilder.replace(edit.range, edit.text);
            }
        });
    }
    // Not visible in any editor (e.g. the user switched tabs), so edit the document directly
    const workspaceEdit = new vscode.WorkspaceEdit();
    for (const edit of edits) {
        workspaceEdit.replace(document.uri, edit.range, edit.text);
    }
    return vscode.workspace.applyEdit(workspaceEdit);
}

/**
 * Tab size used for the given document, so tab and space indentation can be compared
 */
export function getTabSize(document: vscode.TextDocument): number {
    const tabSize = getEditorForDocument(document)?.options.tabSize;
    if (typeof tabSize === 'number') {
        return tabSize;
    }
    return vscode.workspace.getConfiguration('editor', document).get<number>('tabSize', 4);
}

export function moveCursorUpNLines(n: number) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        return;
    }
    const newCursorPosition = new vscode.Position(editor.selection.start.line - n, 0);
    editor.selection = new vscode.Selection(newCursorPosition, newCursorPosition);

}

export function getMostRecentDayContent(dbmDoc: DailyBulletNotesDocument): string | undefined {
    const dailySection = dbmDoc.dailyLog?.mostRecentDay;
    if (!dailySection) {
        return undefined;
    }

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        console.log("Could not detect editor");
        return undefined;
    }
    const document = editor.document;
    const startPosition = new vscode.Position(dailySection.range.start + 1, 0);
    const endPosition = new vscode.Position(dailySection.range.end + 1, 0);

    const mostRecentDayContent = document.getText(new vscode.Range(startPosition, endPosition));
    return mostRecentDayContent;
}

export function getDayFromLineNumber(line: number, dbmDoc: DailyBulletNotesDocument) {

    // TODO binary search would be faster if I put all days into an array (which would be sorted),
    // but only if users are frequently editing older days. Since users would mostly be editing
    // today, or perhaps yesterday, iterating through the days in reverse order is going to be
    // the most efficient approach in the vast majority of cases. And ideal solution might resort
    // to binary search if today or yesterday did not match first.

    let day = dbmDoc.dailyLog?.mostRecentDay;

    if (!day) {
        return undefined;
    }

    while (line < day.range.start) {
        day = day?.previousDailySection;
        if (!day) {
            return undefined;
        }
    }

    // The line is definitely within the day we found
    if (day.range.start <= line && day.range.end >= line) {
        return day;
    }

    return undefined;
}

export function parseCursorPositionForBox(position: vscode.Position, document: vscode.TextDocument) {

    const character = position.character;
    const line = position.line;

    const minRange = Math.max(0, character - 2);
    const maxRange = character + 2;
    const characters = document.lineAt(line).text.slice(minRange, maxRange);
    if (!characters.match(/\[.?\]/)) {
        return undefined;
    }

    const prefix = document.lineAt(line).text.slice(character - 1, character);
    // If we are the start of the box or not
    const innerSectionStartCharacter = prefix === "[" ? character : character - 1;
    // If there is something in the box or not
    const charactersMatch = characters.match(/\[(.)\]/);
    const innerSectionLength = charactersMatch ? 1 : 0;
    const innerPart = charactersMatch ? charactersMatch[1] : '';


    return {
        character: character,
        line: line,
        hasInnerPart: innerSectionLength > 0,
        innerPart: innerPart,
        innerBoxRange: new vscode.Range(
            new vscode.Position(line, innerSectionStartCharacter),
            new vscode.Position(line, innerSectionStartCharacter + innerSectionLength)),
        fullBoxRange: new vscode.Range(
            new vscode.Position(line, innerSectionStartCharacter - 1),
            new vscode.Position(line, innerSectionStartCharacter + 1 + innerSectionLength)),
    };
}
