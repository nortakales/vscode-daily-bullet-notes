import * as vscode from 'vscode';
import Parser from '../documentParser';
import { getBoxHeader, getDailyHeader, getStringFromMonth } from '../strings';
import { getMostRecentDayContent, getTabSize, moveCursorUpNLines } from '../utilities';
import { carryOverDayContent } from '../taskLogic';
import { getMostRecentDayOrShowError } from '../dailyLogCheck';
import { getActiveDbmTarget } from '../rendered/viewSwitching';
import { getRenderedViewProvider } from '../rendered/renderedViewProvider';

/**
 * @returns false if today could not be added or found
 */
export async function addToday(): Promise<boolean> {

    // This logic always adds new years/months as the very last sections,
    // so if there are future years/months then "today" will not be in the
    // correct location

    const target = getActiveDbmTarget();
    if (!target) {
        console.log("Could not detect editor");
        return false;
    }
    const document = target.document;
    await getRenderedViewProvider()?.flush(document);
    const parser = new Parser(document);
    const doc = parser.parseDocument();

    const date = new Date();
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();


    let edits = [];

    const mostRecentDay = getMostRecentDayOrShowError(document, doc, "Add Today");
    if (!mostRecentDay) {
        return false;
    } else {

        const mostRecentYear = mostRecentDay.monthSection?.yearSection?.year;
        const mostRecentMonth = mostRecentDay.monthSection?.month;

        if (mostRecentYear === year && mostRecentMonth === month && mostRecentDay.day === day) {

            if (target.kind === 'rendered') {
                getRenderedViewProvider()?.reveal(document, { line: mostRecentDay.range.end, atEnd: true });
            } else {
                const editor = target.editor;
                const startPosition = new vscode.Position(mostRecentDay.range.start, 0);
                const endPosition = new vscode.Position(mostRecentDay.range.end, 0);
                editor.selection = new vscode.Selection(endPosition, endPosition);
                editor.revealRange(new vscode.Range(startPosition, endPosition), vscode.TextEditorRevealType.InCenter);
            }
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
        edits.push(carryOverDayContent(getMostRecentDayContent(doc, document) ?? '', getTabSize(document)));

        if (target.kind === 'rendered') {
            const lineToInsertOn = mostRecentDay.range.end;
            const endOfLine = document.lineAt(lineToInsertOn).range.end.character;
            const newText = edits.join("\n");
            const edit = new vscode.WorkspaceEdit();
            edit.insert(document.uri, new vscode.Position(lineToInsertOn, endOfLine), "\n" + newText + "\n");
            if (!await vscode.workspace.applyEdit(edit)) {
                return false;
            }
            // Same place the text editor puts the cursor: the last line carried over to today
            getRenderedViewProvider()?.reveal(document, { line: lineToInsertOn + newText.split("\n").length, atEnd: true });
            return true;
        }
        const editor = target.editor;

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
