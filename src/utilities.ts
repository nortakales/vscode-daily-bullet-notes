import * as vscode from 'vscode';
import { DailyBulletNotesDocument } from './documentModel';

export function moveCursorUpNLines(n: number) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        return;
    }
    const newCursorPosition = new vscode.Position(editor.selection.start.line - n, 0);
    editor.selection = new vscode.Selection(newCursorPosition, newCursorPosition);

}

export function getMostRecentDayContent(dbmDoc: DailyBulletNotesDocument): string | undefined {
    const dailySection = dbmDoc.dailyLog.mostRecentDay;
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

    let day = dbmDoc.dailyLog.mostRecentDay;

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

export function removeCompleteAndCancelledContent(content: string | undefined) {
    if (!content) {
        return undefined;
    }
    // TODO a setting to preserve un-indented notes, not just tasks
    // TODO grab [ ] vs [] setting

    const lines = content.split(/\r?\n/);
    const linesToKeep = [];
    let shouldKeepNextIndentedLines = false;
    for (let line of lines) {
        let match = line.match(/^\s*(\[[^x\-]?\])/);
        if (match) {
            // clear out any progress/blocked/etc markers
            const modifiedLine = line.replace(match[1], '[ ]');
            linesToKeep.push(modifiedLine);
            shouldKeepNextIndentedLines = true;
        } else if (line.match(/^\s/)) {
            // Check if we should keep the indented lines, but not if they have [x] or [-]
            if (shouldKeepNextIndentedLines && !line.match(/^\s*(\[[x\-]\])/)) {
                linesToKeep.push(line);
            }
        } else {
            shouldKeepNextIndentedLines = false;
        }
    }
    return linesToKeep.join("\n");
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