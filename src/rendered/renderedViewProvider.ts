import * as vscode from 'vscode';
import * as settings from '../settings';
import { CursorConfig, HostCommand, HostMessage, RevealTarget, ViewConfig, WebviewMessage } from './protocol';
import { applyLineChanges, toLf } from './lineChanges';
import { onDidChangeTokenColors, resolveStatusColors } from './themeTokenColors';

export const RENDERED_VIEW_TYPE = 'daily-bullet-notes.renderedView';

interface RenderedPanel {
    readonly webviewPanel: vscode.WebviewPanel;
    readonly document: vscode.TextDocument;
    /** Bumped whenever the document changes outside this panel; edits from an older epoch are dropped */
    epoch: number;
    ready: boolean;
    /** Last cursor line reported by the webview */
    cursorLine: number;
}

interface DocumentState {
    readonly panels: Set<RenderedPanel>;
    /** Webview edits are applied one at a time, in order */
    queue: Promise<void>;
    /** Text ('\n' line breaks) the document should have after each in-flight webview edit, oldest first */
    readonly expected: { text: string; origin: RenderedPanel }[];
}

let registeredProvider: RenderedViewProvider | undefined;

/** The provider registered by the extension, for commands that act on a rendered view */
export function getRenderedViewProvider() {
    return registeredProvider;
}

export function setRenderedViewProvider(provider: RenderedViewProvider | undefined) {
    registeredProvider = provider;
}

// Document versions produced by rendered view edits, so the text editor's edit listener can ignore them
const renderedViewEditVersions = new Map<string, number>();

/**
 * True if this change was made by the rendered view. The rendered view already applies its own smart
 * edits and parent status updates, so the text editor's edit listener must not react to it.
 */
export function isRenderedViewEdit(event: vscode.TextDocumentChangeEvent): boolean {
    return renderedViewEditVersions.get(event.document.uri.toString()) === event.document.version;
}

export class RenderedViewProvider implements vscode.CustomTextEditorProvider, vscode.Disposable {

    private readonly documents = new Map<string, DocumentState>();
    private readonly pendingReveals = new Map<string, RevealTarget>();
    private readonly pendingFlushes = new Map<number, () => void>();
    private nextFlushRequestId = 1;
    private readonly disposables: vscode.Disposable[] = [];

    /** For tests: every message posted to a webview */
    readonly onDidPostMessage = new vscode.EventEmitter<{ document: vscode.TextDocument, message: HostMessage }>();

    constructor(private readonly extensionUri: vscode.Uri) {
        this.disposables.push(
            vscode.workspace.onDidChangeTextDocument(event => this.onDocumentChanged(event)),
            vscode.workspace.onDidChangeConfiguration(event => {
                if (event.affectsConfiguration('daily-bullet-notes.automaticStatusUpdates') || event.affectsConfiguration('daily-bullet-notes.renderedView') || event.affectsConfiguration('editor')) {
                    this.forEachReadyPanel(panel => this.post(panel, { type: 'config', config: this.getConfig(panel.document) }));
                }
            }),
            onDidChangeTokenColors(() => this.sendColors()),
            // The webview may be holding back a burst of typing; make sure it is in the file that gets saved
            vscode.workspace.onWillSaveTextDocument(event => {
                if (this.documents.has(event.document.uri.toString())) {
                    event.waitUntil(this.flush(event.document));
                }
            }),
            this.onDidPostMessage,
            // Moves the "Today" badge (and the Add Today button) at midnight in views left open overnight
            new vscode.Disposable(clearInterval.bind(undefined, setInterval(() => this.refreshToday(), 30_000)))
        );
    }

    private today = todayKey();

    /** Sends the config (with the new date) to every view if the date changed since the last check */
    private refreshToday() {
        const today = todayKey();
        if (today !== this.today) {
            this.today = today;
            this.forEachReadyPanel(panel => this.post(panel, { type: 'config', config: this.getConfig(panel.document) }));
        }
    }

    dispose() {
        this.disposables.forEach(disposable => disposable.dispose());
    }

    async resolveCustomTextEditor(document: vscode.TextDocument, webviewPanel: vscode.WebviewPanel): Promise<void> {
        const key = document.uri.toString();
        let state = this.documents.get(key);
        if (!state) {
            state = { panels: new Set(), queue: Promise.resolve(), expected: [] };
            this.documents.set(key, state);
        }
        const panel: RenderedPanel = { webviewPanel, document, epoch: 0, ready: false, cursorLine: 0 };
        state.panels.add(panel);

        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist')]
        };
        webviewPanel.webview.html = this.getHtml(webviewPanel.webview);

        webviewPanel.webview.onDidReceiveMessage((message: WebviewMessage) => this.handleMessage(panel, message));
        webviewPanel.onDidChangeViewState(() => {
            // Keeps the "Today" badge right if the view is left open overnight
            if (webviewPanel.visible && panel.ready) {
                this.post(panel, { type: 'config', config: this.getConfig(document) });
            }
        });
        webviewPanel.onDidDispose(() => {
            state.panels.delete(panel);
            if (state.panels.size === 0) {
                this.documents.delete(key);
            }
        });
    }

    /** The cursor line of the rendered view showing this document, if any */
    getCursorLine(document: vscode.TextDocument): number | undefined {
        const panels = this.documents.get(document.uri.toString())?.panels;
        if (!panels || panels.size === 0) {
            return undefined;
        }
        const active = [...panels].find(panel => panel.webviewPanel.active) ?? [...panels][0];
        return active.cursorLine;
    }

    /** Reveals a line in the rendered view(s) of this document, or when one opens next */
    reveal(document: vscode.TextDocument, target: RevealTarget) {
        const panels = this.documents.get(document.uri.toString())?.panels;
        const readyPanels = panels ? [...panels].filter(panel => panel.ready) : [];
        if (readyPanels.length === 0) {
            this.pendingReveals.set(document.uri.toString(), target);
            return;
        }
        readyPanels.forEach(panel => this.post(panel, { type: 'reveal', target }));
    }

    /**
     * Makes sure every edit made in the rendered view(s) of this document has been applied, including typing
     * the webview is holding back to group into one undo step. Call before reading or editing the document
     * on behalf of the rendered view.
     */
    async flush(document: vscode.TextDocument): Promise<void> {
        const state = this.documents.get(document.uri.toString());
        if (!state) {
            return;
        }
        await Promise.all([...state.panels].filter(panel => panel.ready).map(panel => new Promise<void>(resolve => {
            const requestId = this.nextFlushRequestId++;
            // Don't wait forever on a webview that has gone away
            const timeout = setTimeout(() => {
                this.pendingFlushes.delete(requestId);
                resolve();
            }, 1000);
            this.pendingFlushes.set(requestId, () => {
                clearTimeout(timeout);
                this.pendingFlushes.delete(requestId);
                resolve();
            });
            this.post(panel, { type: 'flush', requestId });
        })));
        // Any edit sent before 'flushed' is already queued
        await state.queue;
    }

    /** Reveals a line in the next rendered view that opens for this document */
    revealWhenOpened(document: vscode.TextDocument, target: RevealTarget) {
        this.pendingReveals.set(document.uri.toString(), target);
    }

    /** Runs a view command (e.g. standup view) in the rendered view(s) of this document */
    runCommand(document: vscode.TextDocument, command: 'standupView' | 'expandAll' | 'find') {
        this.documents.get(document.uri.toString())?.panels.forEach(panel => {
            if (panel.ready) {
                this.post(panel, { type: 'command', command });
            }
        });
    }

    /** For tests: handles a message as if the first webview of this document had sent it */
    handleMessageForTesting(document: vscode.TextDocument, message: WebviewMessage): Promise<void> {
        const panel = [...this.documents.get(document.uri.toString())?.panels ?? []][0];
        if (!panel) {
            return Promise.reject(new Error('No rendered view for ' + document.uri.toString()));
        }
        this.handleMessage(panel, message);
        return this.documents.get(document.uri.toString())!.queue;
    }

    /** For tests: the current epoch and readiness of each webview of this document */
    getPanelsForTesting(document: vscode.TextDocument): { epoch: number, ready: boolean }[] {
        return [...this.documents.get(document.uri.toString())?.panels ?? []].map(panel => ({ epoch: panel.epoch, ready: panel.ready }));
    }

    private handleMessage(panel: RenderedPanel, message: WebviewMessage) {
        switch (message.type) {
            case 'ready':
                this.sendInit(panel);
                break;
            case 'edit': {
                const state = this.documents.get(panel.document.uri.toString());
                if (state) {
                    state.queue = state.queue.then(() => this.applyWebviewEdit(panel, state, message)).catch(console.error);
                }
                break;
            }
            case 'selection':
                panel.cursorLine = message.line;
                break;
            case 'flushed':
                this.pendingFlushes.get(message.requestId)?.();
                break;
            case 'openLink':
                openLink(panel.document, message.href).catch(console.error);
                break;
            case 'runCommand': {
                if (!HOST_COMMANDS.includes(message.command)) {
                    break;
                }
                this.refreshToday();
                // The commands work on the active editor: this view, unless focus moved since the click
                if (!panel.webviewPanel.active) {
                    panel.webviewPanel.reveal(undefined, false);
                }
                vscode.commands.executeCommand(`daily-bullet-notes.${message.command}`).then(undefined, console.error);
                break;
            }
            case 'save': {
                // After the typing the webview just sent has been applied. Not part of the queue itself: saving
                // flushes the webview, which waits for the queue, and must not end up waiting for itself.
                const state = this.documents.get(panel.document.uri.toString());
                state?.queue.then(() => panel.document.save()).then(undefined, console.error);
                break;
            }
        }
    }

    private async sendInit(panel: RenderedPanel) {
        const key = panel.document.uri.toString();
        const colors = await resolveStatusColors();
        const reveal = this.pendingReveals.get(key);
        this.pendingReveals.delete(key);
        panel.ready = true;
        this.post(panel, {
            type: 'init',
            text: toLf(panel.document.getText()),
            epoch: panel.epoch,
            config: this.getConfig(panel.document),
            colors,
            reveal
        });
    }

    private async applyWebviewEdit(panel: RenderedPanel, state: DocumentState, message: Extract<WebviewMessage, { type: 'edit' }>) {
        const document = panel.document;
        if (document.isClosed || message.epoch !== panel.epoch) {
            // Made before the webview received the latest external change, so it no longer applies
            return;
        }
        const currentText = toLf(document.getText());
        const expectedText = applyLineChanges(currentText, message.changes);
        if (expectedText === undefined) {
            this.sendAuthoritativeText(panel);
            return;
        }
        if (expectedText === currentText) {
            return;
        }

        const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
        const edit = new vscode.WorkspaceEdit();
        for (const change of message.changes) {
            edit.replace(
                document.uri,
                new vscode.Range(change.fromLine, change.fromCharacter, change.toLine, change.toCharacter),
                change.text.replace(/\n/g, eol)
            );
        }

        state.expected.push({ text: expectedText, origin: panel });
        let applied = false;
        try {
            applied = await vscode.workspace.applyEdit(edit);
        } finally {
            if (!applied) {
                state.expected.splice(state.expected.findIndex(entry => entry.text === expectedText), 1);
                this.sendAuthoritativeText(panel);
            }
        }
    }

    private onDocumentChanged(event: vscode.TextDocumentChangeEvent) {
        if (event.contentChanges.length === 0) {
            return;
        }
        // e.g. Add Today right after midnight: mark the new day as today
        this.refreshToday();
        const key = event.document.uri.toString();
        const state = this.documents.get(key);
        if (!state) {
            return;
        }
        const text = toLf(event.document.getText());

        // Is this the echo of an edit a webview just made?
        let origin: RenderedPanel | undefined;
        const index = state.expected.findIndex(entry => entry.text === text);
        if (index >= 0) {
            origin = state.expected[index].origin;
            state.expected.splice(0, index + 1);
            renderedViewEditVersions.set(key, event.document.version);
        } else {
            // Something else changed the document, so any in-flight webview edits are stale
            state.expected.length = 0;
        }

        for (const panel of state.panels) {
            if (panel !== origin) {
                panel.epoch++;
                if (panel.ready) {
                    this.post(panel, { type: 'update', text, epoch: panel.epoch });
                }
            }
        }
    }

    private sendAuthoritativeText(panel: RenderedPanel) {
        panel.epoch++;
        if (panel.ready) {
            this.post(panel, { type: 'update', text: toLf(panel.document.getText()), epoch: panel.epoch });
        }
    }

    private async sendColors() {
        const colors = await resolveStatusColors();
        this.forEachReadyPanel(panel => this.post(panel, { type: 'colors', colors }));
    }

    private forEachReadyPanel(callback: (panel: RenderedPanel) => void) {
        for (const state of this.documents.values()) {
            state.panels.forEach(panel => {
                if (panel.ready) {
                    callback(panel);
                }
            });
        }
    }

    private post(panel: RenderedPanel, message: HostMessage) {
        panel.webviewPanel.webview.postMessage(message);
        this.onDidPostMessage.fire({ document: panel.document, message });
    }

    private getConfig(document: vscode.TextDocument): ViewConfig {
        const editorConfig = vscode.workspace.getConfiguration('editor', document);
        const dbmConfig = vscode.workspace.getConfiguration('daily-bullet-notes');
        const now = new Date();
        return {
            automaticStatusUpdates: settings.automaticStatusUpdates(),
            tabSize: editorConfig.get<number>('tabSize', 4),
            insertSpaces: editorConfig.get<boolean>('insertSpaces', true),
            today: { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() },
            centered: dbmConfig.get<boolean>('renderedView.centeredLayout', true),
            pinToolbar: dbmConfig.get<boolean>('renderedView.pinToolbar', true),
            pinHeaders: dbmConfig.get<boolean>('renderedView.pinHeaders', true),
            tabs: dbmConfig.get<boolean>('renderedView.tabs', true),
            cursor: {
                style: editorConfig.get<CursorConfig['style']>('cursorStyle', 'line'),
                width: editorConfig.get<number>('cursorWidth', 0),
                blinking: editorConfig.get<CursorConfig['blinking']>('cursorBlinking', 'blink')
            }
        };
    }

    private getHtml(webview: vscode.Webview): string {
        const nonce = getNonce();
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview.css'));
        return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<link href="${styleUri}" rel="stylesheet">
	<title>Daily Bullet Notes</title>
</head>
<body>
	<div id="root"></div>
	<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }
}

/** Link schemes that may be opened from a document; anything else (e.g. command:) is refused */
const OPENABLE_SCHEMES = new Set(['http', 'https', 'mailto', 'file', 'vscode', 'vscode-insiders']);

/** Opens a link the user Ctrl/Cmd+clicked: URLs externally, files (absolute or relative to the document) in VS Code */
export async function openLink(document: vscode.TextDocument, href: string): Promise<void> {
    const target = href.trim();
    if (!target) {
        return;
    }
    // A scheme has 2+ characters, so a Windows path like C:\notes.txt isn't mistaken for one
    const scheme = /^([a-z][a-z0-9+.-]+):/i.exec(target)?.[1].toLowerCase();
    if (scheme) {
        if (!OPENABLE_SCHEMES.has(scheme)) {
            vscode.window.showWarningMessage(`Daily Bullet Notes doesn't open ${scheme}: links.`);
            return;
        }
        const uri = vscode.Uri.parse(target, true);
        if (scheme === 'file') {
            await vscode.commands.executeCommand('vscode.open', uri);
        } else {
            await vscode.env.openExternal(uri);
        }
        return;
    }
    let path = target.replace(/#.*$/, '');
    try {
        path = decodeURIComponent(path);
    } catch {
        // Not URL encoded, use it as is
    }
    let uri: vscode.Uri | undefined;
    if (/^[a-z]:[\\/]/i.test(path) || path.startsWith('/')) {
        uri = vscode.Uri.file(path);
    } else if (document.uri.scheme !== 'untitled') {
        uri = vscode.Uri.joinPath(document.uri, '..', path);
    }
    if (uri) {
        await vscode.commands.executeCommand('vscode.open', uri);
    }
}

function getNonce() {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let nonce = '';
    for (let i = 0; i < 32; i++) {
        nonce += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return nonce;
}

const HOST_COMMANDS: readonly HostCommand[] = ['addTodayAndStandupView', 'addNewList'];

function todayKey(): string {
    const now = new Date();
    return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}
