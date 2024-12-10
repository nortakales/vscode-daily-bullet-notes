import * as vscode from 'vscode';
import Parser from '../documentParser';
import { getBoxHeader, getDailyHeader, getStringFromMonth } from '../strings';


export async function newFile() {

    await vscode.commands.executeCommand("workbench.action.files.newUntitledFile", {
        "languageId": "daily-bullet-notes"
    });
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        console.log("Could not detect editor");
        return;
    }

    const date = new Date();
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const dailyLogHeader = getBoxHeader("Daily Log");
    const yearHeader = getBoxHeader(year + "");
    const monthHeader = getBoxHeader(getStringFromMonth(month));
    const dailyHeader = getDailyHeader(month, day);

    const completeTask = "[x] this task is complete";
    const blockedTask = "[/] this task is blocked, you are waiting on someone or something before more progress can be made";
    const removedTask = "[-] this task is either no longer relevant or tracked by someone else now";
    const progressTask = "[+] you made some progress on this task today, but it isn't done yet";
    const todoTask = "[ ] this task is ready and waiting to be worked on";
    const note = "Here is a quick note you took about the day, like you took the afternoon off or attended an event\n";

    const listHeader = getBoxHeader("Example List");
    const listItems = [
        "This is an example where you might keep things like your career goals,",
        "longstanding tasks on your backburner, ideas for an upcoming hackathon,",
        "some inspirational quotes, or even just your last meeting notes.",
        "You can create many lists like this, and they wil always live just below",
        "your latest daily entry."
    ];

    // TODO could make a list of example commands and preferences

    const fullEdit = [
        dailyLogHeader,
        yearHeader,
        monthHeader,
        dailyHeader,
        completeTask,
        blockedTask,
        removedTask,
        progressTask,
        todoTask,
        note,
        listHeader,
        listItems.join("\n")
    ].join("\n");

    editor.edit(editBuilder => {
        editBuilder.insert(new vscode.Position(0, 0), fullEdit);
    });

}