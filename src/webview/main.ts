// Entry point of the rendered view webview: a CodeMirror editor over the document's exact text, kept in
// sync with the extension host through the messages in src/rendered/protocol.ts.

import './styles.css';
import { EditorSelection, EditorState, Transaction } from '@codemirror/state';
import { EditorView, ViewUpdate } from '@codemirror/view';
import { openSearchPanel } from '@codemirror/search';
import type { HostMessage, StatusColors, StatusKey, ViewConfig, WebviewMessage } from '../rendered/protocol';
import { IS_MAC } from './decorations';
import { applyStandupView, createExtensions, expandAll, reveal, tabSizeCompartment } from './editor';
import { StatusPicker } from './picker';
import { clampCursor, foldField, remoteAnnotation, setConfigEffect, setFoldsEffect, setTabEffect, structureField, tabOfLine, tabVisibleRange } from './state';
import { sectionsOf, STATUS_ORDER } from './structure';
import { TypingBuffer } from './typing';

interface VsCodeApi {
    postMessage(message: WebviewMessage): void;
    getState(): unknown;
    setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

/** What survives a reload of the webview (vscode.setState) */
interface SavedState {
    version: 1;
    folds: string[];
    /** Line at the top of the viewport */
    topLine?: number;
    cursor?: { line: number; character: number };
}

const SELECTION_DEBOUNCE_MS = 150;
const SAVE_DEBOUNCE_MS = 250;
/** A burst of typing is sent this long after the last keystroke... */
const TYPING_IDLE_MS = 1000;
/** ...or when it is this old, whichever comes first */
const TYPING_MAX_AGE_MS = 3000;

const MODIFIER_KEYS = new Set(['Control', 'Meta', 'Shift', 'Alt', 'AltGraph', 'CapsLock']);

/** Same keys VS Code's webview host forwards as undo/redo */
function isUndoKey(event: KeyboardEvent): boolean {
    return (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'z';
}

function isSaveKey(event: KeyboardEvent): boolean {
    return (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 's';
}

function isRedoKey(event: KeyboardEvent): boolean {
    const key = event.key.toLowerCase();
    return (event.ctrlKey || event.metaKey) && !event.altKey && ((key === 'y' && !event.shiftKey) || (key === 'z' && event.shiftKey));
}

class RenderedView {
    private readonly vscode = acquireVsCodeApi();
    private readonly root: HTMLElement;
    private readonly picker: StatusPicker;
    private readonly liveRegion: HTMLElement;
    private view: EditorView | undefined;
    private epoch = 0;
    private lastSentLine = -1;
    private selectionTimer: ReturnType<typeof setTimeout> | undefined;
    private saveTimer: ReturnType<typeof setTimeout> | undefined;
    /** Holds back bursts of typing, so each burst is one 'edit' (one undo step in VS Code) */
    private readonly typing = new TypingBuffer(changes => this.post({ type: 'edit', epoch: this.epoch, changes }));
    private typingIdleTimer: ReturnType<typeof setTimeout> | undefined;
    private typingAgeTimer: ReturnType<typeof setTimeout> | undefined;

    constructor() {
        let root = document.getElementById('root');
        if (!root) {
            root = document.createElement('div');
            root.id = 'root';
            document.body.appendChild(root);
        }
        this.root = root;
        this.root.classList.add('dbm-root');
        this.picker = new StatusPicker(document.body);
        this.liveRegion = document.createElement('div');
        this.liveRegion.className = 'dbm-sr-only';
        this.liveRegion.setAttribute('aria-live', 'polite');
        document.body.appendChild(this.liveRegion);

        window.addEventListener('message', event => this.onMessage(event.data as HostMessage));
        // Held-back typing goes out as soon as the user might act on the whole document
        document.addEventListener('keydown', event => this.onKeyDownCapture(event), true);
        // Links show as clickable while Ctrl (Cmd on macOS) is held
        const trackModifier = (event: KeyboardEvent | MouseEvent) => this.root.classList.toggle('dbm-mod-held', IS_MAC ? event.metaKey : event.ctrlKey);
        window.addEventListener('keydown', trackModifier, true);
        window.addEventListener('keyup', trackModifier, true);
        window.addEventListener('mousemove', trackModifier, { capture: true, passive: true });
        window.addEventListener('blur', () => this.root.classList.remove('dbm-mod-held'));
        window.addEventListener('blur', () => this.flushTyping());
        window.addEventListener('pagehide', () => this.flushTyping());
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                this.flushTyping();
            }
        });
        window.addEventListener('focus', () => {
            if (this.view && !this.picker.isOpen && (document.activeElement === document.body || !document.activeElement)) {
                this.view.focus();
            }
        });
        this.post({ type: 'ready' });

        // Lets a test harness reach the editor; nothing defines this hook in VS Code
        const hook = (window as unknown as { __dbmTestHook?: (api: unknown) => void }).__dbmTestHook;
        hook?.({
            view: () => this.view,
            epoch: () => this.epoch,
            folds: () => this.view ? [...this.view.state.field(foldField)] : [],
        });
    }

    private post(message: WebviewMessage) {
        this.vscode.postMessage(message);
    }

    private onMessage(message: HostMessage) {
        if (!message || typeof message !== 'object') {
            return;
        }
        switch (message.type) {
            case 'init':
                this.init(message.text, message.epoch, message.config, message.colors);
                if (message.reveal && this.view) {
                    reveal(this.view, message.reveal);
                }
                break;
            case 'update':
                this.update(message.text, message.epoch);
                break;
            case 'config':
                this.view?.dispatch({
                    effects: [setConfigEffect.of(message.config), tabSizeCompartment.reconfigure(EditorState.tabSize.of(message.config.tabSize))],
                });
                break;
            case 'colors':
                applyColors(message.colors);
                break;
            case 'reveal':
                if (this.view) {
                    reveal(this.view, message.target);
                }
                break;
            case 'command':
                if (!this.view) {
                    break;
                }
                if (message.command === 'standupView') {
                    applyStandupView(this.view);
                } else if (message.command === 'expandAll') {
                    expandAll(this.view);
                } else if (message.command === 'find') {
                    openSearchPanel(this.view);
                }
                break;
            case 'flush':
                this.flushTyping();
                this.post({ type: 'flushed', requestId: message.requestId });
                break;
        }
    }

    private init(text: string, epoch: number, config: ViewConfig, colors: StatusColors) {
        this.epoch = epoch;
        this.typing.reset();
        this.clearTypingTimers();
        applyColors(colors);
        this.picker.cancel();
        const state = EditorState.create({
            doc: text,
            extensions: createExtensions({
                config,
                picker: this.picker,
                announce: message => this.announce(message),
                onUpdate: update => this.onUpdate(update),
                openLink: href => this.post({ type: 'openLink', href }),
                runCommand: command => this.post({ type: 'runCommand', command }),
            }),
        });
        if (this.view) {
            this.view.setState(state);
        } else {
            this.view = new EditorView({ state, parent: this.root });
            this.view.scrollDOM.addEventListener('scroll', () => {
                this.picker.cancel();
                this.scheduleSave();
            }, { passive: true });
        }
        const view = this.view;
        const saved = this.loadState();
        if (!saved) {
            applyStandupView(view);
        } else {
            const doc = view.state.doc;
            let pos = 0;
            if (saved.cursor && saved.cursor.line < doc.lines) {
                const line = doc.line(saved.cursor.line + 1);
                pos = Math.min(line.from + saved.cursor.character, line.to);
            }
            // With tabs, the tab the cursor was on
            view.dispatch({ effects: [setFoldsEffect.of(saved.folds), setTabEffect.of(tabOfLine(view.state, doc.lineAt(pos).number - 1))] });
            pos = clampCursor(view.state, pos, pos - 1);
            const visible = tabVisibleRange(view.state);
            let top = saved.topLine !== undefined && saved.topLine < doc.lines ? doc.line(saved.topLine + 1).from : pos;
            top = top < visible.from || top > visible.to ? pos : top;
            view.dispatch({
                selection: EditorSelection.cursor(pos),
                effects: EditorView.scrollIntoView(top, { y: 'start', yMargin: 0 }),
            });
        }
        this.lastSentLine = view.state.doc.lineAt(view.state.selection.main.head).number - 1;
        view.focus();
    }

    /**
     * Adopts the host's text (undo/redo, other editors, commands...) with a minimal change. Typing that is
     * still held back is kept: it is rebased onto the new text and sent later with the new epoch.
     */
    private update(text: string, epoch: number) {
        this.epoch = epoch;
        const view = this.view;
        if (!view) {
            return;
        }
        this.picker.cancel();
        const changes = this.typing.rebase(view.state.doc, text);
        if (changes) {
            view.dispatch({
                changes,
                annotations: [remoteAnnotation.of(true), Transaction.addToHistory.of(false)],
            });
        }
        if (!this.typing.pending) {
            this.clearTypingTimers();
        }
    }

    private onUpdate(update: ViewUpdate) {
        for (const tr of update.transactions) {
            const result = this.typing.handleTransaction(tr, Date.now());
            if (result.kind === 'grouped') {
                this.scheduleTypingFlush(result.started);
            }
        }
        if (!this.typing.pending) {
            this.clearTypingTimers();
        }
        if (update.docChanged && this.picker.isOpen) {
            this.picker.cancel();
        }
        if (update.selectionSet || update.docChanged) {
            this.scheduleSelection();
        }
        if (update.startState.field(foldField) !== update.state.field(foldField) || update.selectionSet) {
            this.scheduleSave();
        }
    }

    // ----- Typing groups -----

    private flushTyping() {
        this.typing.flush();
        this.clearTypingTimers();
    }

    private clearTypingTimers() {
        clearTimeout(this.typingIdleTimer);
        clearTimeout(this.typingAgeTimer);
        this.typingIdleTimer = this.typingAgeTimer = undefined;
    }

    private scheduleTypingFlush(started: boolean) {
        const group = this.typing.pending;
        if (!group) {
            this.clearTypingTimers();
            return;
        }
        clearTimeout(this.typingIdleTimer);
        this.typingIdleTimer = setTimeout(() => this.flushTyping(), TYPING_IDLE_MS);
        if (started) {
            clearTimeout(this.typingAgeTimer);
            this.typingAgeTimer = setTimeout(() => this.flushTyping(), Math.max(0, group.startedAt + TYPING_MAX_AGE_MS - Date.now()));
        }
    }

    /**
     * Capture phase, so it runs before VS Code's webview host forwards the key (it listens in the bubble
     * phase). Undo with a burst still held back reverts the burst here and VS Code never sees the key
     * (the burst was never in the document); redo right after that re-applies it. Any other shortcut
     * first sends held-back typing, so commands like save see the whole document.
     */
    private onKeyDownCapture(event: KeyboardEvent) {
        // AltGr (Ctrl+Alt on Windows) and IME composition type characters, they aren't shortcuts
        if (!(event.ctrlKey || event.metaKey) || MODIFIER_KEYS.has(event.key) || event.isComposing || event.getModifierState('AltGraph')) {
            return;
        }
        const view = this.view;
        const inEditor = !!view && event.target instanceof Node && view.contentDOM.contains(event.target);
        if (view && inEditor && isUndoKey(event) && this.typing.pending) {
            view.dispatch(this.typing.revert(view.state)!);
            this.clearTypingTimers();
            this.announce('Undo typing');
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        if (view && inEditor && isRedoKey(event) && this.typing.canRedo) {
            view.dispatch(this.typing.redo(view.state, Date.now())!);
            this.scheduleTypingFlush(true);
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        if (view && inEditor && isSaveKey(event) && this.typing.pending) {
            this.flushTyping();
            this.post({ type: 'save' });
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        this.flushTyping();
    }

    private scheduleSelection() {
        clearTimeout(this.selectionTimer);
        this.selectionTimer = setTimeout(() => {
            const view = this.view;
            if (!view) {
                return;
            }
            const line = view.state.doc.lineAt(view.state.selection.main.head).number - 1;
            if (line !== this.lastSentLine) {
                this.lastSentLine = line;
                this.post({ type: 'selection', line });
            }
        }, SELECTION_DEBOUNCE_MS);
    }

    private scheduleSave() {
        clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => this.saveState(), SAVE_DEBOUNCE_MS);
    }

    private saveState() {
        const view = this.view;
        if (!view) {
            return;
        }
        const state = view.state;
        const existing = new Set(sectionsOf(state.field(structureField)).map(section => section.key));
        const head = state.selection.main.head;
        const cursorLine = state.doc.lineAt(head);
        const scrollTop = view.scrollDOM.getBoundingClientRect().top - view.documentTop;
        const topBlock = view.lineBlockAtHeight(Math.max(0, scrollTop));
        const saved: SavedState = {
            version: 1,
            folds: [...state.field(foldField)].filter(key => existing.has(key)),
            topLine: state.doc.lineAt(topBlock.from).number - 1,
            cursor: { line: cursorLine.number - 1, character: head - cursorLine.from },
        };
        this.vscode.setState(saved);
    }

    private loadState(): SavedState | undefined {
        const saved = this.vscode.getState() as SavedState | undefined;
        return saved && saved.version === 1 && Array.isArray(saved.folds) ? saved : undefined;
    }

    private announce(message: string) {
        this.liveRegion.textContent = '';
        // A fresh text node so screen readers announce repeated messages too
        setTimeout(() => this.liveRegion.textContent = message, 30);
    }
}

/** Status colors from the theme's syntax colors; missing ones fall back to chart colors in styles.css */
function applyColors(colors: StatusColors) {
    const style = document.documentElement.style;
    for (const key of STATUS_ORDER as readonly StatusKey[]) {
        const color = colors?.[key];
        if (color) {
            style.setProperty(`--dbm-status-${key}`, color);
        } else {
            style.removeProperty(`--dbm-status-${key}`);
        }
    }
}

new RenderedView();
