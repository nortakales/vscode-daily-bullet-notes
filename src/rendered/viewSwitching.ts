import * as vscode from 'vscode';
import { RENDERED_VIEW_TYPE, RenderedViewProvider } from './renderedViewProvider';

const DBM_FILE_PATTERN = '*.dbm';

export type DbmTarget =
    | { kind: 'text', document: vscode.TextDocument, editor: vscode.TextEditor }
    | { kind: 'rendered', document: vscode.TextDocument };

/**
 * The document a command should act on: the active rendered view if that is the active editor,
 * otherwise the active text editor
 */
export function getActiveDbmTarget(): DbmTarget | undefined {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    if (input instanceof vscode.TabInputCustom && input.viewType === RENDERED_VIEW_TYPE) {
        const document = vscode.workspace.textDocuments.find(document => document.uri.toString() === input.uri.toString());
        if (document) {
            return { kind: 'rendered', document };
        }
    }
    const editor = vscode.window.activeTextEditor;
    if (editor) {
        return { kind: 'text', document: editor.document, editor };
    }
    return undefined;
}

export function defaultViewIsRendered() {
    return vscode.workspace.getConfiguration('daily-bullet-notes').get<string>('defaultView', 'text') === 'rendered';
}

/** Replaces the active text editor with the rendered view, keeping the cursor line */
export async function openRenderedView(provider: RenderedViewProvider) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        return;
    }
    provider.revealWhenOpened(editor.document, { line: editor.selection.active.line });
    await reopenActiveEditorWith(RENDERED_VIEW_TYPE, () => replaceActiveTab(editor.document.uri, () =>
        vscode.commands.executeCommand('vscode.openWith', editor.document.uri, RENDERED_VIEW_TYPE, { viewColumn: editor.viewColumn, preview: false })));
}

/** Replaces the active rendered view with the text editor, keeping the cursor line */
export async function openTextView(provider: RenderedViewProvider) {
    const target = getActiveDbmTarget();
    if (target?.kind !== 'rendered') {
        return;
    }
    await provider.flush(target.document);
    const line = Math.min(provider.getCursorLine(target.document) ?? 0, target.document.lineCount - 1);
    const viewColumn = vscode.window.tabGroups.activeTabGroup.viewColumn;
    await reopenActiveEditorWith('default', () => replaceActiveTab(target.document.uri, () =>
        vscode.window.showTextDocument(target.document, { viewColumn, preview: false })));
    const editor = vscode.window.activeTextEditor;
    if (editor?.document === target.document) {
        editor.selection = new vscode.Selection(line, 0, line, 0);
        editor.revealRange(new vscode.Range(line, 0, line, 0), vscode.TextEditorRevealType.InCenter);
    }
}

/**
 * Reopens the active editor with another editor ('default' is the text editor) in the same tab, like
 * "Reopen Editor With..." does. Unlike opening another editor and closing the first, this never asks to save
 * an unsaved or new file. It uses the internal command behind "Reopen Editor With..."; if that ever goes away,
 * the fallback is used.
 */
async function reopenActiveEditorWith(editorId: string, fallback: () => Thenable<unknown>) {
    try {
        await vscode.commands.executeCommand('reopenActiveEditorWith', editorId);
    } catch (error) {
        console.warn('Daily Bullet Notes: reopenActiveEditorWith failed, opening the other editor instead', error);
        await fallback();
    }
}

/** Opens a new editor for the resource, then closes the tab it replaces so the switch happens in place */
async function replaceActiveTab(uri: vscode.Uri, open: () => Thenable<unknown>) {
    const group = vscode.window.tabGroups.activeTabGroup;
    const oldTab = group.activeTab;
    const oldInput = oldTab?.input;
    await open();
    if (!oldInput || !(oldInput instanceof vscode.TabInputText || oldInput instanceof vscode.TabInputCustom)) {
        return;
    }
    // Find the old tab again, since tab objects are replaced when the group changes
    const stillOpen = group.tabs.find(tab =>
        tab.input instanceof oldInput.constructor &&
        (tab.input as { uri: vscode.Uri }).uri.toString() === uri.toString() &&
        !tab.isActive);
    if (stillOpen) {
        await vscode.window.tabGroups.close(stillOpen, true);
    }
}

/**
 * Makes `workbench.editorAssociations` (user settings) match daily-bullet-notes.defaultView, which is
 * how VS Code decides which editor opens *.dbm files. When `onlyAdd` is set, an existing association is
 * never removed (used at startup, so an association the user added by hand is left alone).
 */
export async function syncDefaultViewAssociation(onlyAdd = false) {
    const workbench = vscode.workspace.getConfiguration('workbench');
    const userValue = workbench.inspect<unknown>('editorAssociations')?.globalValue;
    if (Array.isArray(userValue)) {
        // Old array format; leave it alone rather than risk losing the user's associations
        return;
    }
    const associations: Record<string, string> = { ...(userValue as Record<string, string> | undefined ?? {}) };
    if (defaultViewIsRendered()) {
        if (associations[DBM_FILE_PATTERN] === RENDERED_VIEW_TYPE) {
            return;
        }
        associations[DBM_FILE_PATTERN] = RENDERED_VIEW_TYPE;
    } else {
        if (onlyAdd || associations[DBM_FILE_PATTERN] !== RENDERED_VIEW_TYPE) {
            return;
        }
        delete associations[DBM_FILE_PATTERN];
    }
    await workbench.update('editorAssociations', Object.keys(associations).length > 0 ? associations : undefined, vscode.ConfigurationTarget.Global);
}
