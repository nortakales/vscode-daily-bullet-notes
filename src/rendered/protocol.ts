// Messages exchanged between the extension host (RenderedViewProvider) and the rendered view webview.
// This file must not import anything, so it can be bundled into both sides.
//
// Sync model (the .dbm TextDocument is always the source of truth):
// - Text sent to the webview always uses '\n' line breaks, whatever the document's EOL.
// - Positions are 0-based line/character pairs, so they mean the same thing on both sides.
// - The webview sends every user change immediately as an 'edit'. The host applies all of an edit's
//   changes as ONE WorkspaceEdit, so one user action is one undo step in VS Code.
// - Whenever the document changes for any reason other than that webview's own edit (undo/redo,
//   the text editor, another extension, a command like Add Today, git, ...), the host increments
//   that webview's epoch and sends an 'update' with the full text. The webview must adopt that text
//   and use the new epoch from then on. The host drops edits that carry an old epoch.
// - The webview keeps no undo history of its own; VS Code routes undo/redo to the TextDocument.
// - Typing grouping: the webview may hold back a burst of plain typing for a moment and send it as one
//   'edit', so it becomes one undo step. When the host needs the document to be complete (before a save,
//   a command that edits or reads the document, or switching views) it sends 'flush'; the webview must
//   send any held-back edit first and then reply 'flushed' with the same requestId.

export type StatusKey = 'open' | 'done' | 'progress' | 'blocked' | 'removed' | 'tomorrow';

/** CSS colors from the active theme's syntax highlighting for each status (missing: use a fallback) */
export type StatusColors = Partial<Record<StatusKey, string>>;

export interface ViewConfig {
    /** daily-bullet-notes.automaticStatusUpdates: parent statuses are computed from sub-tasks */
    automaticStatusUpdates: boolean;
    /** Indentation settings of the document (used for Tab/Shift+Tab and indent widths) */
    tabSize: number;
    insertSpaces: boolean;
    /** Today's local date, for the "Today" badge */
    today: { year: number; month: number; day: number };
    /** daily-bullet-notes.renderedView.centeredLayout: a centered column of limited width, instead of the full width */
    centered: boolean;
    /** The user's text editor cursor settings, so the rendered view's cursor looks and blinks the same */
    cursor: CursorConfig;
    /** daily-bullet-notes.renderedView.pinToolbar: the Daily Log toolbar stays at the top instead of scrolling away */
    pinToolbar: boolean;
    /** daily-bullet-notes.renderedView.pinHeaders: the current year and month stay at the top while scrolling */
    pinHeaders: boolean;
}

export interface CursorConfig {
    /** editor.cursorStyle */
    style: 'line' | 'block' | 'underline' | 'line-thin' | 'block-outline' | 'underline-thin';
    /** editor.cursorWidth: width in pixels of the 'line' style (0 means the default of 2) */
    width: number;
    /** editor.cursorBlinking */
    blinking: 'blink' | 'smooth' | 'phase' | 'expand' | 'solid';
}

export interface RevealTarget {
    /** 0-based line to reveal (folded sections containing it are unfolded) */
    line: number;
    /** Put the cursor at the end of the line instead of the start of its text */
    atEnd?: boolean;
}

export interface LineChange {
    fromLine: number;
    fromCharacter: number;
    toLine: number;
    toCharacter: number;
    /** Replacement text, with '\n' line breaks */
    text: string;
}

export type HostMessage =
    /** Sent in reply to 'ready': the full document and everything needed to render it */
    | { type: 'init'; text: string; epoch: number; config: ViewConfig; colors: StatusColors; reveal?: RevealTarget }
    /** The document changed outside this webview: adopt this text and epoch */
    | { type: 'update'; text: string; epoch: number }
    | { type: 'config'; config: ViewConfig }
    | { type: 'colors'; colors: StatusColors }
    /** Move the cursor to a line and scroll it into view (e.g. after Add Today or switching views) */
    | { type: 'reveal'; target: RevealTarget }
    /** standupView: fold everything except the two most recent days. find: open the search panel. */
    | { type: 'command'; command: 'standupView' | 'expandAll' | 'find' }
    /** Send any held-back typing now, then reply 'flushed' with this requestId */
    | { type: 'flush'; requestId: number };

export type WebviewMessage =
    /** The webview has loaded (or reloaded) and needs an 'init' */
    | { type: 'ready' }
    /**
     * A user change. Changes are non-overlapping, sorted by position, and expressed in coordinates of
     * the document as it was before this edit (i.e. after all edits the webview sent before it).
     */
    | { type: 'edit'; epoch: number; changes: LineChange[] }
    /** The line the cursor is on (sent when it changes), used when switching to the text view */
    | { type: 'selection'; line: number }
    /** Reply to 'flush', sent after any held-back 'edit' */
    | { type: 'flushed'; requestId: number }
    /** Open a link the user Ctrl/Cmd+clicked: a URL, or a path relative to the document */
    | { type: 'openLink'; href: string }
    /**
     * Ctrl/Cmd+S was pressed while typing was held back. The webview has just sent that typing and kept the
     * key from VS Code (whose save would run before the edit lands, and skip the file if it wasn't modified
     * yet); the host saves the document once the edit is applied.
     */
    | { type: 'save' };
