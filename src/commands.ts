import * as vscode from 'vscode';
import Parser from './documentParser';
import { DailyBulletNotesDocument, DailySection } from './documentModel';
import { getBoxHeader, getDailyHeader, getMonthFromString, getStringFromMonth } from './strings';

class Commands {

    public constructor(context: vscode.ExtensionContext) {
        this.registerCommand(context, "daily-bullet-notes.addNextDay", this.addNextDay);
        this.registerCommand(context, "daily-bullet-notes.addToday", this.addToday);
    }

    private registerCommand(
        context: vscode.ExtensionContext,
        commandName: string,
        command: string | ((...args: any[]) => any)) {

        let commandToExecute: ((...args: any[]) => any);
        if (typeof command === "string") {
            commandToExecute = () => {
                vscode.commands.executeCommand(command);
            };
        } else {
            commandToExecute = command;
        }

        const disposable = vscode.commands.registerCommand(commandName, commandToExecute);

        context.subscriptions.push(disposable);
    }

    addNextDay() {
        const filename = vscode.window.activeTextEditor?.document.fileName;
        console.log(filename);
        const parser = new Parser(vscode.window.activeTextEditor?.document!);
        const parsed = parser.parseDocument();
        console.log(parsed);
    }

    addToday() {

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
            // add year month day and )maybe daily log)?
        } else {

            const mostRecentYear = mostRecentDay.monthSection?.yearSection?.year;
            const mostRecentMonth = mostRecentDay.monthSection?.month;

            if (mostRecentYear === year && mostRecentMonth === month && mostRecentDay.day === day) {
                // TODO move cursor to current day
                // TODO message box popup
                console.log("Today already added, nothing to do");
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

            editor.edit(editBuilder => {
                const lineToInsertOn = mostRecentDay!.range.end;
                const endOfLine = editor.document.lineAt(lineToInsertOn).range.end.character;
                editBuilder.insert(new vscode.Position(lineToInsertOn, endOfLine), "\n" + edits.join("\n") + "\n");
            }).then(() => {
                // TODO Only if cursor not at end of doc?
                moveCursorUpNLines(2);
            });
        }




        // // TODO if there is no daily log or no year at all

        // let yearSection = doc.dailyLog.yearSections.find(yearSection => yearSection.year === year);
        // if (yearSection) {
        //     // The current year exists

        //     let monthSection = yearSection.monthSections.find(monthSection => monthSection.month === month);
        //     if (monthSection) {

        //         const lastDay = monthSection.dailySections.at(-1);


        //         editor.edit(editBuilder => {
        //             if (lastDay !== undefined) {
        //                 editBuilder.insert(new vscode.Position(lastDay.range.end + 1, 0), getDailyHeader(month, day));
        //             }

        //         });
        //     } else {
        //         // TODO no months at all
        //         // Add month and day

        //         const lastMonth = yearSection.monthSections.at(-1);

        //         // Set cursor just after the last month (it will be moved up later)
        //         const newCursorPosition = new vscode.Position(lastMonth!.range.end + 1, 0);
        //         editor.selection = new vscode.Selection(newCursorPosition, newCursorPosition);

        //         editor.edit(editBuilder => {

        //             const content = removeCompleteAndCancelledContent(getMostRecentDayContent(doc));

        //             const fullEdit = [
        //                 getBoxHeader(year + ""),
        //                 getBoxHeader(getStringFromMonth(month)),
        //                 getDailyHeader(month, day),
        //                 content
        //             ].join("\n");

        //             editBuilder.insert(new vscode.Position(lastMonth!.range.end + 1, 0), fullEdit + "\n\n\n");
        //         }).then(() => {
        //             moveCursorUpNLines(2);
        //         });


        //     }
        // } else {
        //     // Year does not exist, add year month and day

        //     const lastYear = doc.dailyLog.yearSections.at(-1);

        //     const newCursorPosition = new vscode.Position(lastYear!.range.end + 1, 0);
        //     editor.selection = new vscode.Selection(newCursorPosition, newCursorPosition);

        //     editor.edit(editBuilder => {

        //         const content = removeCompleteAndCancelledContent(getMostRecentDayContent(doc));

        //         const fullEdit = [
        //             getBoxHeader(year + ""),
        //             getBoxHeader(getStringFromMonth(month)),
        //             getDailyHeader(month, day),
        //             content
        //         ].join("\n");

        //         editBuilder.insert(new vscode.Position(lastYear!.range.end + 1, 0), fullEdit + "\n\n\n");
        //     }).then(() => {
        //         moveCursorUpNLines(2);
        //     });
        // }
    }
}

function moveCursorUpNLines(n: number) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        return;
    }
    const newCursorPosition = new vscode.Position(editor.selection.start.line - n, 0);
    editor.selection = new vscode.Selection(newCursorPosition, newCursorPosition);

}

function getMostRecentDayContent(dbmDoc: DailyBulletNotesDocument): string | undefined {
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

function removeCompleteAndCancelledContent(content: string | undefined) {
    if (!content) {
        return undefined;
    }
    // TODO a setting to preserve un-indented notes, not just tasks
    const lines = content.split(/\r?\n/);
    const linesToKeep = [];
    let shouldKeepNextIndentedLines = false;
    for (let line of lines) {
        if (line.match(/^\s*\[[^x\-]?\]/)) {
            linesToKeep.push(line);
            shouldKeepNextIndentedLines = true;
        } else if (line.match(/^\s/)) {
            if (shouldKeepNextIndentedLines) {
                linesToKeep.push(line);
            }
        } else {
            shouldKeepNextIndentedLines = false;
        }
    }
    return linesToKeep.join("\n");
}

export default Commands;