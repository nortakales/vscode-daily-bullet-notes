// The Daily Log toolbar: a slim bar with the Standup view, Collapse all and Expand all buttons, shown when the
// document has a Daily Log box. With config.pinToolbar (the default) it is a CodeMirror top panel, so it stays
// visible however far the document scrolls, and the box's own lines render as nothing. Without it, the same bar
// is the Daily Log box's block widget, so it scrolls with the document (see decorations.ts).

import { Extension } from '@codemirror/state';
import { EditorView, Panel, showPanel, ViewUpdate, WidgetType } from '@codemirror/view';
import { dbmActions } from './actions';
import { UI_ICONS } from './icons';
import { configField, structureField } from './state';

type ToolAction = 'standup' | 'collapse' | 'expand';

const TOOLS: { action: ToolAction; icon: string; label: string; tooltip: string }[] = [
    { action: 'standup', icon: UI_ICONS.standup, label: 'Standup view', tooltip: 'Standup view: fold everything except the two most recent days' },
    { action: 'collapse', icon: UI_ICONS.collapseAll, label: 'Collapse all', tooltip: 'Collapse all: fold every year, month, day and list' },
    { action: 'expand', icon: UI_ICONS.unfold, label: 'Expand all', tooltip: 'Expand all: unfold every year, month, day and list' },
];

/** The bar's element: the label and the buttons in an inner row */
function buildBar(view: EditorView, className: string): { dom: HTMLElement; inner: HTMLElement } {
    const dom = document.createElement('div');
    dom.className = className;
    dom.setAttribute('role', 'toolbar');
    dom.setAttribute('aria-label', 'Daily Log');
    const inner = document.createElement('div');
    inner.className = 'dbm-logbar-inner';
    dom.appendChild(inner);

    const name = document.createElement('span');
    name.className = 'dbm-log-name';
    name.innerHTML = UI_ICONS.notebook;
    const title = document.createElement('span');
    title.textContent = 'Daily Log';
    name.appendChild(title);
    inner.appendChild(name);

    for (const tool of TOOLS) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'dbm-tool';
        button.dataset.action = tool.action;
        button.title = tool.tooltip;
        button.setAttribute('aria-label', tool.label);
        button.innerHTML = tool.icon;
        const label = document.createElement('span');
        label.className = 'dbm-tool-label';
        label.textContent = tool.label;
        button.appendChild(label);
        // Keep the editor's focus and selection
        button.addEventListener('mousedown', event => event.preventDefault());
        button.addEventListener('click', event => {
            event.preventDefault();
            const actions = view.state.facet(dbmActions);
            if (tool.action === 'standup') {
                actions?.standupView(view);
            } else if (tool.action === 'collapse') {
                actions?.collapseAll(view);
            } else {
                actions?.expandAll(view);
            }
        });
        inner.appendChild(button);
    }
    return { dom, inner };
}

// ---------------------------------------------------------------------------------------------
// Pinned: a top panel

function createLogBar(view: EditorView): Panel {
    const { dom, inner } = buildBar(view, 'dbm-logbar dbm-logbar-pinned');

    // The bar's background spans the editor; its contents line up with the text column (centered or full width)
    const align = () => view.requestMeasure({
        read: () => ({ content: view.contentDOM.getBoundingClientRect(), bar: dom.getBoundingClientRect() }),
        write: ({ content, bar }) => {
            if (content.width > 0) {
                inner.style.marginLeft = `${Math.max(0, content.left - bar.left)}px`;
                inner.style.width = `${content.width}px`;
                inner.style.maxWidth = 'none';
            }
        },
    });
    // The text column moves when the layout switches between centered and full width, the panel is resized or
    // the scrollbar comes and goes
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => align());

    return {
        dom,
        top: true,
        mount() {
            observer?.observe(view.contentDOM);
            observer?.observe(view.scrollDOM);
            observer?.observe(dom);
            align();
        },
        update(update: ViewUpdate) {
            if (update.geometryChanged || update.heightChanged) {
                align();
            }
        },
        destroy() {
            observer?.disconnect();
        },
    };
}

/** The pinned bar, when the document has a Daily Log box and config.pinToolbar isn't off */
export const logBar: Extension = showPanel.compute([structureField, configField], state =>
    state.field(configField).pinToolbar !== false && state.field(structureField).boxes.some(box => box.kind === 'dailyLog') ? createLogBar : null);

// ---------------------------------------------------------------------------------------------
// Not pinned: the Daily Log box's block widget, scrolling with the document

export class LogBarWidget extends WidgetType {
    eq() {
        return true;
    }

    get estimatedHeight() {
        return 32;
    }

    toDOM(view: EditorView): HTMLElement {
        const wrapper = document.createElement('div');
        wrapper.className = 'dbm-logbar-flow';
        wrapper.appendChild(buildBar(view, 'dbm-logbar dbm-logbar-inline').dom);
        return wrapper;
    }

    ignoreEvent() {
        return true;
    }
}
