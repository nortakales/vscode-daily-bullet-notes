import * as vscode from 'vscode';
import Parser from './documentParser';
import { DailySection } from './documentModel';

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
        const parsed = parser.parseHeirarchy();
        console.log(parsed);
    }

    addToday() {

        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            console.log("Could not detect editor");
            return;
        }
        const document = editor.document;
        const parser = new Parser(document);
        const parsed = parser.parseHeirarchy();

        const date = new Date();
        const year = date.getFullYear();
        const month = date.getMonth() + 1;
        const day = date.getDate();

        let yearSection = parsed.dailyLog.yearSections.find(yearSection => yearSection.year === year);
        if (yearSection) {
            let monthSection = yearSection.monthSections.find(monthSection => monthSection.month === month);
            if (monthSection) {
                editor.edit(editBuilder => {
                    const lastDay = monthSection.dailySections.pop();
                    const dailyHeader = `\n${month}/${day} ------------------- < Today\n`;
                    if (lastDay !== undefined) {
                        editBuilder.insert(new vscode.Position(lastDay.range.end + 1, 0), dailyHeader);
                    }

                });
            }
        } else {

        }

    }

    private getLastDay() {

    }


}

export default Commands;