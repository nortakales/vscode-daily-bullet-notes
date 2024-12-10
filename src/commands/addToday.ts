import * as vscode from 'vscode';
import Parser from '../documentParser';
import { getBoxHeader, getDailyHeader, getStringFromMonth } from '../strings';
import { DailyBulletNotesDocument } from '../documentModel';
import { getMostRecentDayContent, moveCursorUpNLines, removeCompleteAndCancelledContent } from '../utilities';

export async function addToday() {

    // This logic always adds new years/months as the very last sections,
    // so if there are future years/months then "today" will not be in the
    // correct location

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        console.log("Could not detect editor");
        return;
    }
    const parser = new Parser(editor.document);
    const doc = parser.parseDocument();

    const date = new Date();
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();


    let edits = [];

    const mostRecentDay = doc.dailyLog.mostRecentDay;
    if (!mostRecentDay) {
        // add year month day and (maybe daily log)?
        // TODO pop up dialog box asking to start from a new template
    } else {

        const mostRecentYear = mostRecentDay.monthSection?.yearSection?.year;
        const mostRecentMonth = mostRecentDay.monthSection?.month;

        if (mostRecentYear === year && mostRecentMonth === month && mostRecentDay.day === day) {

            const startPosition = new vscode.Position(mostRecentDay.range.start, 0);
            const endPosition = new vscode.Position(mostRecentDay.range.end, 0);
            editor.selection = new vscode.Selection(endPosition, endPosition);
            editor.revealRange(new vscode.Range(startPosition, endPosition), vscode.TextEditorRevealType.InCenter);
            vscode.window.showInformationMessage("Today already exists");
            return;
        }

        if (mostRecentYear !== year) {
            // add year and month edits
            edits.push(getBoxHeader(year + ""));
            edits.push(getBoxHeader(getStringFromMonth(month)));
        } else if (mostRecentMonth !== month) {
            // add month edit
            edits.push(getBoxHeader(getStringFromMonth(month)));
        }

        edits.push(getDailyHeader(month, day),);
        edits.push(removeCompleteAndCancelledContent(getMostRecentDayContent(doc)));


        // Set cursor just after the last month (it will be moved up later)
        const newCursorPosition = new vscode.Position(mostRecentDay!.range.end + 1, 0);
        editor.selection = new vscode.Selection(newCursorPosition, newCursorPosition);
        editor.revealRange(new vscode.Range(newCursorPosition, newCursorPosition), vscode.TextEditorRevealType.InCenter);

        editor.edit(editBuilder => {
            const lineToInsertOn = mostRecentDay!.range.end;
            const endOfLine = editor.document.lineAt(lineToInsertOn).range.end.character;
            editBuilder.insert(new vscode.Position(lineToInsertOn, endOfLine), "\n" + edits.join("\n") + "\n");
        }).then(() => {
            // TODO Only if cursor not at end of doc?
            moveCursorUpNLines(1);
        });
    }
}
