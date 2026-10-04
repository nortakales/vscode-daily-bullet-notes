import * as vscode from 'vscode';
import Parser from '../documentParser';
import { getBoxHeader, getDailyHeader, getStringFromMonth } from '../strings';
import { getMostRecentDayContent, getTabSize, moveCursorUpNLines } from '../utilities';
import { carryOverDayContent } from '../taskLogic';
import { getMostRecentDayOrShowError } from '../dailyLogCheck';

/**
 * @returns false if today could not be added or found
 */
export async function addToday(): Promise<boolean> {

    // This logic always adds new years/months as the very last sections,
    // so if there are future years/months then "today" will not be in the
    // correct location

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        console.log("Could not detect editor");
        return false;
    }
    const parser = new Parser(editor.document);
    const doc = parser.parseDocument();

    const date = new Date();
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();


    let edits = [];

    const mostRecentDay = getMostRecentDayOrShowError(editor.document, doc, "Add Today");
    if (!mostRecentDay) {
        return false;
    } else {

        const mostRecentYear = mostRecentDay.monthSection?.yearSection?.year;
        const mostRecentMonth = mostRecentDay.monthSection?.month;

        if (mostRecentYear === year && mostRecentMonth === month && mostRecentDay.day === day) {

            const startPosition = new vscode.Position(mostRecentDay.range.start, 0);
            const endPosition = new vscode.Position(mostRecentDay.range.end, 0);
            editor.selection = new vscode.Selection(endPosition, endPosition);
            editor.revealRange(new vscode.Range(startPosition, endPosition), vscode.TextEditorRevealType.InCenter);
            vscode.window.showInformationMessage("Today already exists");
            return true;
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
        edits.push(carryOverDayContent(getMostRecentDayContent(doc) ?? '', getTabSize(editor.document)));


        // Set cursor just after the last month (it will be moved up later)
        const newCursorPosition = new vscode.Position(mostRecentDay!.range.end + 1, 0);
        editor.selection = new vscode.Selection(newCursorPosition, newCursorPosition);
        editor.revealRange(new vscode.Range(newCursorPosition, newCursorPosition), vscode.TextEditorRevealType.InCenter);

        await editor.edit(editBuilder => {
            const lineToInsertOn = mostRecentDay!.range.end;
            const endOfLine = editor.document.lineAt(lineToInsertOn).range.end.character;
            editBuilder.insert(new vscode.Position(lineToInsertOn, endOfLine), "\n" + edits.join("\n") + "\n");
        });

        // TODO Only if cursor not at end of doc?
        moveCursorUpNLines(1);
        return true;
    }
}
