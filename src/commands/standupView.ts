import * as vscode from 'vscode';
import Parser from '../documentParser';
import { getMostRecentDayOrShowError } from '../dailyLogCheck';
import { getActiveDbmTarget } from '../rendered/viewSwitching';
import { getRenderedViewProvider } from '../rendered/renderedViewProvider';



export async function standupView() {
    const target = getActiveDbmTarget();
    if (!target) {
        console.log("Could not detect editor");
        return;
    }
    if (target.kind === 'rendered') {
        const dbmDoc = new Parser(target.document).parseDocument();
        if (getMostRecentDayOrShowError(target.document, dbmDoc, "Standup View")) {
            getRenderedViewProvider()?.runCommand(target.document, 'standupView');
        }
        return;
    }
    const editor = target.editor;

    const parser = new Parser(editor.document);
    const doc = parser.parseDocument();

    const mostRecentDay = getMostRecentDayOrShowError(editor.document, doc, "Standup View");
    if (!mostRecentDay) {
        return;
    }

    // TODO what if most recent day is not today

    const linesToUnfold = [];

    linesToUnfold.push(mostRecentDay.range.start);
    if (mostRecentDay.previousDailySection) {
        linesToUnfold.push(mostRecentDay.previousDailySection.range.start);
    }

    await vscode.commands.executeCommand("editor.foldAll");

    // https://code.visualstudio.com/api/references/commands
    await vscode.commands.executeCommand("editor.unfold", {
        levels: 99, // unfold as much as needed
        direction: "up",
        selectionLines: linesToUnfold
    });

    const startPosition = new vscode.Position(mostRecentDay.previousDailySection ?
        mostRecentDay.previousDailySection.range.start :
        mostRecentDay.range.start,
        0);
    const endPosition = new vscode.Position(mostRecentDay.range.end, 0);
    editor.selection = new vscode.Selection(endPosition, endPosition);
    editor.revealRange(new vscode.Range(startPosition, endPosition), vscode.TextEditorRevealType.InCenter);
}
