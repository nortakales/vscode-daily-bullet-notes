import * as vscode from 'vscode';
import * as settings from './settings';
import { applyEditsToDocument, DBM_LANGUAGE_ID, getDayFromLineNumber, getListFromLineNumber, getTabSize, parseCursorPositionForBox } from './utilities';
import { computeCombinedStatus, computeParentStatusUpdates, getIndentLevel } from './taskLogic';
import Parser from './documentParser';
import { isRenderedViewEdit } from './rendered/renderedViewProvider';

// TODO finalize a solution, and perhaps provide a setting to control it
const fullUpdates = true;

// Pending status updates, debounced per document
const statusUpdateTimers = new Map<string, ReturnType<typeof setTimeout>>();

// True while status updates are being written, so those edits don't trigger another update
let applyingStatusUpdates = false;

function scheduleStatusUpdate(document: vscode.TextDocument, editedLine: number): void {
    const key = document.uri.toString();
    clearTimeout(statusUpdateTimers.get(key));
    statusUpdateTimers.set(key, setTimeout(() => {
        statusUpdateTimers.delete(key);
        updateStatusesForFullDay(document, editedLine).catch(console.error);
    }, 200));
}

export async function onDocumentChange(event: vscode.TextDocumentChangeEvent) {

    //console.log(event);

    if (event.document.languageId !== DBM_LANGUAGE_ID) {
        return;
    }
    if (applyingStatusUpdates) {
        return;
    }
    // The rendered view applies its own smart edits and parent status updates as part of each edit
    if (isRenderedViewEdit(event)) {
        return;
    }
    // Undo/redo restores earlier text, including any status updates made at the time,
    // so don't add boxes or recalculate statuses on top of it
    if (event.reason === vscode.TextDocumentChangeReason.Undo || event.reason === vscode.TextDocumentChangeReason.Redo) {
        return;
    }
    if (event.contentChanges.length !== 1) {
        return;
    }

    const document = event.document;
    const change = event.contentChanges[0];
    const text = change.text;
    const editedLine = change.range.start.line;

    // TODO edge cases missing for full day updates:
    // space before a box: check if text is ' ' and range is before the box
    // backspace before a box: check if text is '' and range is before the box
    // tab before a box (indent change, capture separately?) same as above
    // shift + tab anywhere (indent change, capture separately?) this would actually be captured by above too !


    // TODO refactor all of this

    const lineText = document.lineAt(editedLine).text;
    if (lineText.match(/^\s*\[.?\]/)) {
        const indentLevel = getIndentLevel(lineText);
        if (change.range.start.character <= indentLevel && text !== '[ ] ') {
            console.log("indent level");
            scheduleStatusUpdate(document, editedLine);
            return;
        }
    }

    const isNewLine = /^\r?\n\s*$/.test(text);
    let needsStatusUpdate = false;

    if (isNewLine) {
        console.log("newline");
        needsStatusUpdate = await processNewLine(event);
    } else if (text.length === 0) {
        console.log("backspace");
        needsStatusUpdate = await processBackspace(event);
    } else if (text.match(/\t|\s{2,}/)) {
        // TODO will not work if someone's indent level is just 1 space
        console.log("tab");
        await processTab(event);
    } else if (text.length === 1 && text.match(/[ x+\/>\-]/)) {
        const parsedBox = parseCursorPositionForBox(change.range.start, document);
        if (parsedBox) {
            console.log("[" + parsedBox.innerPart + "]");
            await processUpdatedBox(event);
            needsStatusUpdate = true;
        }
    }

    // Deleting a selection or whole lines, or pasting multiple lines, can add or remove sub-tasks
    const spansLines = change.range.start.line !== change.range.end.line;
    if (change.rangeLength > 1 || spansLines || (text.includes('\n') && !isNewLine)) {
        needsStatusUpdate = true;
    }

    if (needsStatusUpdate) {
        scheduleStatusUpdate(document, editedLine);
    }
}

async function updateStatusesForFullDay(document: vscode.TextDocument, editedLine: number) {

    if (!settings.automaticStatusUpdates()) {
        return;
    }
    if (!fullUpdates) {
        return;
    }
    if (document.isClosed) {
        return;
    }

    console.log("Updating full day");

    const dbmDoc = new Parser(document).parseDocument();
    // The day being edited, or one of the lists after the daily log
    const line = Math.min(editedLine, document.lineCount - 1);
    const section = getDayFromLineNumber(line, dbmDoc) ?? getListFromLineNumber(line, dbmDoc);
    if (!section) {
        return;
    }

    const firstLine = section.range.start + 1;
    const lines: string[] = [];
    for (let lineNumber = firstLine; lineNumber <= section.range.end; lineNumber++) {
        lines.push(document.lineAt(lineNumber).text);
    }

    const updates = computeParentStatusUpdates(lines, getTabSize(document));
    if (updates.length === 0) {
        return;
    }

    // Only replace the boxes themselves, and write to the document that was edited,
    // which is not necessarily the active editor anymore
    applyingStatusUpdates = true;
    try {
        await applyEditsToDocument(document, updates.map(update => ({
            range: new vscode.Range(firstLine + update.lineIndex, update.boxStart, firstLine + update.lineIndex, update.boxEnd),
            text: update.newBox
        })));
    } finally {
        applyingStatusUpdates = false;
    }
}

async function processNewLine(event: vscode.TextDocumentChangeEvent): Promise<boolean> {
    const document = event.document;
    const line = event.contentChanges[0].range.start.line;

    // A newline was entered, so the "previous" line is actually the line for the event
    const previousLineText = document.lineAt(line).text;

    // If previous line was a task
    if (previousLineText.match(/^\s*\[.?\]/)) {

        if (vscode.window.activeTextEditor?.document !== document) {
            return false;
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

        return true;
    }
    return false;
}

async function processBackspace(event: vscode.TextDocumentChangeEvent): Promise<boolean> {
    const document = event.document;
    const change = event.contentChanges[0];
    const line = change.range.start.line;
    const lineText = document.lineAt(line).text;

    let needsUpdate = false;

    if (lineText.match(/^\s*\[ \]$/)) {
        await applyEditsToDocument(document, [{ range: document.lineAt(line).range, text: lineText.replace('[ ]', '') }]);
        needsUpdate = true;
    }

    const parsedBox = parseCursorPositionForBox(change.range.start, event.document);
    if (parsedBox) {
        await processUpdatedBox(event);
        needsUpdate = true;
    }

    return needsUpdate;
}

async function processTab(event: vscode.TextDocumentChangeEvent) {
    const document = event.document;
    const line = event.contentChanges[0].range.start.line;
    const lineText = document.lineAt(line).text;

    // Note: this one can easily get into an infinite loop if not careful

    if (lineText.match(/^\s*\[ \]\s\s{2,}$/)) {
        // The indent command below works on the active editor, so only continue if that is this document
        const editor = vscode.window.activeTextEditor;
        if (editor?.document !== document) {
            return;
        }
        await editor.edit(editBuilder => {
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

        // TODO backspace at this point should remove the entire box !
        await applyEditsToDocument(document, [{ range: document.lineAt(line).range, text: newLineText }]);

        // statuses.push(boxContent[1]);
    }

    // console.log(statuses);
    // console.log(computeCombinedStatus(statuses));


    // Traverse down until finding an empty line OR smaller indent
    // Traverse back up, tracking all box statuses at the exact indent level until reaching a lower indent
    // Update that lower indent as needed
    // Recurse
}
