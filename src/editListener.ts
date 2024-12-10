import * as vscode from 'vscode';
import { parseCursorPositionForBox } from './utilities';

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
    } else if (text.match(/\s+/)) {
        //console.log("tab");
        processTab(event);
    } else if (text.length === 1 && text.match(/[ x+/-]/)) {
        const parsedBox = parseCursorPositionForBox(change.range.start, event.document);
        if (parsedBox) {
            // console.log("[" + parsedBox.innerPart + "]");
            // TODO will need to get the entire hierarchy of the current day and step through the levels
        }
    }
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