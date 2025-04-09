import * as vscode from 'vscode';
import * as settings from './settings';
import { computeCombinedStatus, getDayFromLineNumber, getIndentLevel, parseCursorPositionForBox } from './utilities';
import Parser from './documentParser';
import { DailyBulletNotesDocument } from './documentModel';

// TODO finalize a solution, and perhaps provide a setting to control it
const fullUpdates = true;

export async function onDocumentChange(event: vscode.TextDocumentChangeEvent) {

    //console.log(event);

    // TODO process undo/redo differently?

    if (event.contentChanges.length !== 1) {
        return;
    }

    const document = event.document;
    const change = event.contentChanges[0];
    const text = change.text;

    // TODO edge cases missing for full day updates:
    // space before a box: check if text is ' ' and range is before the box
    // backspace before a box: check if text is '' and range is before the box
    // tab before a box (indent change, capture separately?) same as above
    // shift + tab anywhere (indent change, capture separately?) this would actually be captured by above too !


    // TODO refactor all of this

    const lineText = document.lineAt(change.range.start.line).text;
    if (lineText.match(/^\s*\[.?\]/)) {
        const indentLevel = getIndentLevel(lineText);
        if (change.range.start.character <= indentLevel && text !== '[ ] ' && text !== lineText) {
            console.log("indent level");
            await updateStatusesForFullDay(event);
            return;
        }
    }

    if (text.match(/^\r?\n\s*$/)) {
        console.log("newline");
        await processNewLine(event);
    } else if (text.length === 0) {
        console.log("backspace");
        await processBackspace(event);
    } else if (text.match(/\t|\s{2,}/)) {
        // TODO will not work if someone's indent level is just 1 space
        console.log("tab");
        await processTab(event);
    } else if (text.length === 1 && text.match(/[ x+/->]/)) {
        const parsedBox = parseCursorPositionForBox(change.range.start, event.document);
        if (parsedBox) {
            console.log("[" + parsedBox.innerPart + "]");
            await processUpdatedBox(event);
            await updateStatusesForFullDay(event);
        }
    }
}

async function updateStatusesForFullDay(event: vscode.TextDocumentChangeEvent, dbmDoc?: DailyBulletNotesDocument) {

    if (!settings.automaticStatusUpdates()) {
        return;
    }
    if (!fullUpdates) {
        return;
    }

    console.log("Updating full day");

    const document = event.document;
    const editedLine = event.contentChanges[0].range.start.line;
    // TODO what if this line was added to the end of the day? will below break?

    if (!dbmDoc) {
        dbmDoc = new Parser(document).parseDocument();
    }
    const dailySection = getDayFromLineNumber(editedLine, dbmDoc);
    if (!dailySection) {
        return;
    }

    let topLevelTasks: Task[] = [];
    let previousTaskStack: Task[] = [];

    // Parse the entire day into a hierarchy of just tasks (no notes necessary)
    for (let lineNumber = dailySection.range.start + 1; lineNumber < dailySection.range.end + 1; lineNumber++) {
        const lineText = document.lineAt(lineNumber).text;

        // Check if it is a task
        const match = lineText.match(/^\s*\[(.?)\]/);
        if (match) {

            const indentLevel = getIndentLevel(lineText);

            const thisTask: Task = {
                lineNumber: lineNumber,
                originalText: lineText,
                indentLevel: indentLevel,
                subtasks: [],
                originalStatus: match[1],
                newStatus: match[1]

            };

            if (previousTaskStack.length === 0) {
                topLevelTasks.push(thisTask);
                previousTaskStack.push(thisTask);
            } else {
                let previousTask = previousTaskStack[previousTaskStack.length - 1];
                if (previousTask.indentLevel > thisTask.indentLevel) {
                    // We went left, loop until we find correct indent level as it might be more than one level back
                    while (previousTask.indentLevel > thisTask.indentLevel) {
                        previousTaskStack.pop();
                        previousTask = previousTaskStack[previousTaskStack.length - 1];
                    }
                    if (previousTask.indentLevel < thisTask.indentLevel) {
                        // This task is in some weird in between indent level
                    } else {
                        // Same level
                        previousTaskStack.pop();
                        if (previousTaskStack.length === 0) {
                            topLevelTasks.push(thisTask);
                        } else {
                            previousTaskStack[previousTaskStack.length - 1].subtasks.push(thisTask);
                        }
                        previousTaskStack.push(thisTask);

                    }

                } else if (previousTask.indentLevel < thisTask.indentLevel) {
                    // We went right
                    previousTask.subtasks.push(thisTask);
                    previousTaskStack.push(thisTask);
                } else {
                    // Same level
                    previousTaskStack.pop();
                    if (previousTaskStack.length === 0) {
                        topLevelTasks.push(thisTask);
                    } else {
                        previousTaskStack[previousTaskStack.length - 1].subtasks.push(thisTask);
                    }
                    previousTaskStack.push(thisTask);
                }
            }
        }
    }

    //console.log(topLevelTasks);

    for (let task of topLevelTasks) {
        updateTaskStatusBasedOnSubtasks(task);
    }

    //console.log(topLevelTasks);

    await vscode.window.activeTextEditor?.edit(editBuilder => {
        for (let task of topLevelTasks) {
            updateTaskStatusInDocument(task, editBuilder, document);
        }
    });
}

function updateTaskStatusInDocument(task: Task, editBuilder: vscode.TextEditorEdit, document: vscode.TextDocument) {
    for (let subtask of task.subtasks) {
        updateTaskStatusInDocument(subtask, editBuilder, document);
    }
    if (task.newStatus === task.originalStatus) {
        return;
    }
    const newText = task.originalText.replace('[' + task.originalStatus + ']', '[' + task.newStatus + ']');
    editBuilder.replace(document.lineAt(task.lineNumber).range, newText);
}

function updateTaskStatusBasedOnSubtasks(task: Task) {

    if (task.subtasks.length > 0) {
        for (let subtask of task.subtasks) {
            updateTaskStatusBasedOnSubtasks(subtask);
        }
        task.newStatus = computeCombinedStatus(task.subtasks.map(subtask => subtask.newStatus));
    }
}


interface Task {
    lineNumber: number,
    originalText: string,
    subtasks: Task[],
    indentLevel: number,
    originalStatus: string,
    newStatus: string
}



async function processNewLine(event: vscode.TextDocumentChangeEvent) {
    const document = event.document;
    const line = event.contentChanges[0].range.start.line;

    // A newline was entered, so the "previous" line is actually the line for the event
    const previousLineText = document.lineAt(line).text;

    // If previous line was a task
    if (previousLineText.match(/^\s*\[.?\]/)) {

        if (vscode.window.activeTextEditor?.document !== document) {
            return;
        }
        const editor = vscode.window.activeTextEditor;

        await editor.edit(editBuilder => {

            // Cursor position moves after this, so cannot use cursor position
            // Parse new line to add box after any indenting but before any text
            const lineText = document.lineAt(line + 1).text;
            // Strip of non-whitespace, use the length as the position
            const startingWhitespace = lineText.replace(/[^\s].*/, '');
            editBuilder.insert(new vscode.Position(line + 1, startingWhitespace.length), "[ ] ");
        });

        await updateStatusesForFullDay(event);
    }
}

async function processBackspace(event: vscode.TextDocumentChangeEvent) {
    const document = event.document;
    const change = event.contentChanges[0];
    const line = change.range.start.line;
    const lineText = document.lineAt(line).text;

    if (lineText.match(/^\s*\[ \]$/)) {
        // TODO might be making a bad assumption on the editor being the active one?
        await vscode.window.activeTextEditor?.edit(editBuilder => {
            editBuilder.replace(document.lineAt(line).range, lineText.replace('[ ]', ''));
        });

        await updateStatusesForFullDay(event);
    }

    const parsedBox = parseCursorPositionForBox(change.range.start, event.document);
    if (parsedBox) {
        await processUpdatedBox(event);
        await updateStatusesForFullDay(event);
    }
}

async function processTab(event: vscode.TextDocumentChangeEvent) {
    const document = event.document;
    const line = event.contentChanges[0].range.start.line;
    const lineText = document.lineAt(line).text;

    // Note: this one can easily get into an infinite loop if not careful

    if (lineText.match(/^\s*\[ \]\s\s{2,}$/)) {
        // TODO might be making a bad assumption on the editor being the active one?
        await vscode.window.activeTextEditor?.edit(editBuilder => {
            editBuilder.replace(document.lineAt(line).range, lineText.replace(/\[ \]\s*/, '[ ] '));
        });
        await vscode.commands.executeCommand('editor.action.indentLines');
        // TODO this one might not be necessary because above triggers an edit which retriggers the edit code and detects an indent
        // await updateStatusesForFullDay(event);
    }
}

async function processUpdatedBox(event: vscode.TextDocumentChangeEvent) {
    if (!settings.automaticStatusUpdates()) {
        return;
    }
    if (fullUpdates) {
        return;
    }

    // TODO this could be triggered when adding a new task or removing a task
    // TODO Need to recurse on an upper level box
    // TODO Might want to just recalculate the entire day when any line within the day is editted to address above TODOs

    const document = event.document;
    const dbmDoc = new Parser(document).parseDocument();
    const originalLine = event.contentChanges[0].range.start.line;
    const originalIndentLevel = getIndentLevel(document.lineAt(originalLine).text);
    if (originalIndentLevel === 0) {
        return;
    }

    const day = getDayFromLineNumber(originalLine, dbmDoc);

    //console.log(day);

    // TODO consider which directions we should update
    // It is probably never correct to update increased indentation levels, as they are more specifc
    // So only update decreased indentation levels (recursively)

    let line = originalLine;
    let indentLevel = originalIndentLevel;

    // Go down as far as we can
    while (indentLevel >= originalIndentLevel) {
        indentLevel = getIndentLevel(document.lineAt(++line).text);
    }

    const statuses: string[] = [];

    indentLevel = originalIndentLevel;
    // No go up as far as we can
    while (indentLevel >= originalIndentLevel) {
        const lineText = document.lineAt(--line).text;
        indentLevel = getIndentLevel(lineText);
        if (indentLevel === originalIndentLevel) {
            const boxContent = lineText.match(/^\s*\[(.)\]/);
            if (boxContent) {
                statuses.push(boxContent[1]);
            }

        }
    }

    const lineText = document.lineAt(line).text;
    const boxContent = lineText.match(/^\s*\[(.)\]/);
    if (boxContent) {
        const newStatus = computeCombinedStatus(statuses);
        const replacementText = boxContent[0].replace('[' + boxContent[1] + ']', '[' + newStatus + ']');
        const newLineText = lineText.replace(boxContent[0], replacementText);

        // TODO might be making a bad assumption on the editor being the active one?
        await vscode.window.activeTextEditor?.edit(editBuilder => {
            // TODO backspace at this point should remove the entire box !
            editBuilder.replace(document.lineAt(line).range, newLineText);
        });

        // statuses.push(boxContent[1]);
    }

    // console.log(statuses);
    // console.log(computeCombinedStatus(statuses));


    // Traverse down until finding an empty line OR smaller indent
    // Traverse back up, tracking all box statuses at the exact indent level until reaching a lower indent
    // Update that lower indent as needed
    // Recurse
}
