import * as vscode from 'vscode';
import { getDayFromLineNumber, parseCursorPositionForBox } from './utilities';
import Parser from './documentParser';

export async function onDocumentChange(event: vscode.TextDocumentChangeEvent) {

    //console.log(event);

    // TODO process undo/redo differently?

    if (event.contentChanges.length !== 1) {
        return;
    }

    const change = event.contentChanges[0];
    const text = change.text;

    if (text.match(/^\n\s*$/)) {
        //console.log("newline");
        processNewLine(event);
    } else if (text.length === 0) {
        //console.log("backspace");
        processBackspace(event);
    } else if (text.match(/\t|\s{2,}/)) {
        // TODO will not work if someone's indent level is just 1 space
        //console.log("tab");
        processTab(event);
    } else if (text.length === 1 && text.match(/[ x+/-]/)) {
        const parsedBox = parseCursorPositionForBox(change.range.start, event.document);
        if (parsedBox) {
            // console.log("[" + parsedBox.innerPart + "]");
            processUpdatedBox(event);
        }
    }
}

function getIndentLevel(line: string) {
    // Note: Behavior with a mix of tabs/spaces is going to be wrong
    const match = line.match(/^\s+/);
    if (!match) {
        return 0;
    }
    return match[0].split('').length;
}

async function processUpdatedBox(event: vscode.TextDocumentChangeEvent) {

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

function computeCombinedStatus(statuses: string[]) {
    if (!statuses || statuses.length === 0) {
        return ' ';
    }
    if (statuses.length === 1) {
        return statuses[0];
    }

    const uniqueStatuses = new Set(statuses);
    console.log(uniqueStatuses);

    uniqueStatuses.delete('-');

    if (uniqueStatuses.size === 1) {
        return [...uniqueStatuses][0];
    }

    uniqueStatuses.delete('x');

    if (uniqueStatuses.size === 1) {
        return [...uniqueStatuses][0];
    }

    uniqueStatuses.delete('/');

    if (uniqueStatuses.size === 1) {
        return [...uniqueStatuses][0];
    }

    // remove statuses in reverse priority order until we reach just 1
    uniqueStatuses.delete('');
    uniqueStatuses.delete(' ');

    if (uniqueStatuses.size === 1) {
        return [...uniqueStatuses][0];
    }

    // There should only be + at this point
    // TODO what if there is other stuff in here?
    return '+';
}

async function processNewLine(event: vscode.TextDocumentChangeEvent) {
    const document = event.document;
    const line = event.contentChanges[0].range.start.line;

    // A newline was entered, so the "previous" line is actually the line for the event
    const previousLineText = document.lineAt(line).text;

    // If previous line was a task
    if (previousLineText.match(/^\s*\[.?\]/)) {

        // TODO might be making a bad assumption on the editor being the active one?
        await vscode.window.activeTextEditor?.edit(editBuilder => {
            // TODO backspace at this point should remove the entire box !
            editBuilder.insert(document.lineAt(line + 1).range.end, "[ ] ");
        });
    }
}

async function processBackspace(event: vscode.TextDocumentChangeEvent) {
    const document = event.document;
    const line = event.contentChanges[0].range.start.line;
    const lineText = document.lineAt(line).text;

    if (lineText.match(/^\s*\[ \]$/)) {
        // TODO might be making a bad assumption on the editor being the active one?
        await vscode.window.activeTextEditor?.edit(editBuilder => {
            // TODO backspace at this point should remove the entire box !
            editBuilder.replace(document.lineAt(line).range, lineText.replace('[ ]', ''));
        });
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
            // TODO backspace at this point should remove the entire box !
            editBuilder.replace(document.lineAt(line).range, lineText.replace(/\[ \]\s*/, '[ ] '));
        });
        await vscode.commands.executeCommand('editor.action.indentLines');
    }
}