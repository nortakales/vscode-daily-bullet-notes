// What widgets and panels can ask the app to do (provided by editor.ts)

import { Facet } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

/** Things widgets can ask the app to do */
export interface DbmActions {
    openPicker(view: EditorView, lineNumber: number, anchor: HTMLElement): void;
    standupView(view: EditorView): void;
    expandAll(view: EditorView): void;
    collapseAll(view: EditorView): void;
    toggleFold(view: EditorView, key: string): void;
    announce(message: string): void;
    /** Ctrl/Cmd+Click on a link */
    openLink(href: string): void;
}

export const dbmActions = Facet.define<DbmActions, DbmActions | undefined>({ combine: values => values[0] });
