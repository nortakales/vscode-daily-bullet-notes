// The Daily Log toolbar: a slim bar with the Standup view, Collapse all and Expand all buttons, shown when the
// document has a Daily Log box. With config.pinToolbar (the default) it is a CodeMirror top panel, so it stays
// visible however far the document scrolls, and the box's own lines render as nothing. Without it, the same bar
// is the Daily Log box's block widget, so it scrolls with the document (see decorations.ts).
// With config.tabs, the bar is always pinned and starts with the Daily Log and Lists tabs; its buttons are the
// active tab's.

import { EditorState, Extension } from '@codemirror/state';
import { EditorView, Panel, showPanel, ViewUpdate, WidgetType } from '@codemirror/view';
import { dbmActions } from './actions';
import { UI_ICONS } from './icons';
import { activeTab, configField, structureField, tabField, TabId } from './state';

type ToolAction = 'standup' | 'newList' | 'collapse' | 'expand';

/** The toolbar's buttons; `tab`: only on that tab (newList: only with tabs) */
const TOOLS: { action: ToolAction; icon: string; label: string; tooltip: string; tab?: TabId }[] = [
    { action: 'standup', icon: UI_ICONS.standup, label: 'Standup view', tooltip: 'Standup view: fold everything except the two most recent days', tab: 'log' },
    { action: 'newList', icon: UI_ICONS.add, label: 'New list', tooltip: 'New list: add a list at the bottom of the file', tab: 'lists' },
    { action: 'collapse', icon: UI_ICONS.collapseAll, label: 'Collapse all', tooltip: 'Collapse all: fold every year, month, day and list' },
    { action: 'expand', icon: UI_ICONS.unfold, label: 'Expand all', tooltip: 'Expand all: unfold every year, month, day and list' },
];

const TABS: { tab: TabId; icon: string; label: string }[] = [
    { tab: 'log', icon: UI_ICONS.notebook, label: 'Daily Log' },
    { tab: 'lists', icon: UI_ICONS.list, label: 'Lists' },
];

interface Bar {
    dom: HTMLElement;
    inner: HTMLElement;
    /** Shows the tabs (or the Daily Log label) and the buttons for the state */
    update(state: EditorState): void;
}

/** The bar's element: the label or tabs, and the buttons in an inner row */
function buildBar(view: EditorView, className: string): Bar {
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

    const tablist = document.createElement('div');
    tablist.className = 'dbm-tabs';
    tablist.setAttribute('role', 'tablist');
    tablist.setAttribute('aria-label', 'Daily Log or Lists');
    const tabButtons = new Map<TabId, { button: HTMLElement; count?: HTMLElement }>();
    for (const tab of TABS) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'dbm-tab';
        button.setAttribute('role', 'tab');
        button.dataset.tab = tab.tab;
        button.innerHTML = tab.icon;
        const label = document.createElement('span');
        label.textContent = tab.label;
        button.appendChild(label);
        let count: HTMLElement | undefined;
        if (tab.tab === 'lists') {
            count = document.createElement('span');
            count.className = 'dbm-tab-count';
            button.appendChild(count);
        }
        button.addEventListener('mousedown', event => event.preventDefault());
        button.addEventListener('click', event => {
            event.preventDefault();
            view.state.facet(dbmActions)?.switchTab(view, tab.tab);
        });
        tablist.appendChild(button);
        tabButtons.set(tab.tab, { button, count });
    }
    inner.appendChild(tablist);

    const toolButtons: { button: HTMLElement; tab?: TabId }[] = [];
    for (const tool of TOOLS) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'dbm-tool';
        button.dataset.action = tool.action;
        toolButtons.push({ button, tab: tool.tab });
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
            } else if (tool.action === 'newList') {
                actions?.runCommand('addNewList');
            } else if (tool.action === 'collapse') {
                actions?.collapseAll(view);
            } else {
                actions?.expandAll(view);
            }
        });
        inner.appendChild(button);
    }

    let shown = '';
    const update = (state: EditorState) => {
        const tab = activeTab(state);
        const lists = state.field(structureField).boxes.filter(box => box.kind === 'list').length;
        const key = `${tab}:${lists}`;
        if (key === shown) {
            return;
        }
        shown = key;
        name.hidden = !!tab;
        tablist.hidden = !tab;
        for (const [id, { button, count }] of tabButtons) {
            button.classList.toggle('dbm-tab-active', id === tab);
            button.setAttribute('aria-selected', String(id === tab));
            if (count) {
                count.textContent = lists > 0 ? String(lists) : '';
            }
        }
        // Without tabs, the bar is the Daily Log's (no New list)
        for (const { button, tab: only } of toolButtons) {
            button.hidden = only !== undefined && only !== (tab ?? 'log');
        }
    };
    return { dom, inner, update };
}

// ---------------------------------------------------------------------------------------------
// Pinned: a top panel

function createLogBar(view: EditorView): Panel {
    const { dom, inner, update: show } = buildBar(view, 'dbm-logbar dbm-logbar-pinned');
    show(view.state);

    // The bar's background spans the editor; its contents line up with the text column (centered or full width)
    const align = () => view.requestMeasure({
        // clientLeft: the bar's border (the floating, rounded bar has one)
        read: () => ({ content: view.contentDOM.getBoundingClientRect(), bar: dom.getBoundingClientRect(), border: dom.clientLeft }),
        write: ({ content, bar, border }) => {
            if (content.width > 0) {
                inner.style.marginLeft = `${Math.max(0, content.left - bar.left - border)}px`;
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
            show(update.state);
            if (update.geometryChanged || update.heightChanged) {
                align();
            }
        },
        destroy() {
            observer?.disconnect();
        },
    };
}

/** The pinned bar, when the document has a Daily Log box and config.pinToolbar isn't off (or there are tabs) */
export const logBar: Extension = showPanel.compute([structureField, configField, tabField], state =>
    (state.field(configField).pinToolbar !== false || activeTab(state)) && state.field(structureField).boxes.some(box => box.kind === 'dailyLog') ? createLogBar : null);

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
        const bar = buildBar(view, 'dbm-logbar dbm-logbar-inline');
        bar.update(view.state);
        wrapper.appendChild(bar.dom);
        return wrapper;
    }

    ignoreEvent() {
        return true;
    }
}
