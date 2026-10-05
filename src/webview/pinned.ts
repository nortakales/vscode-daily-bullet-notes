// Pinned year and month headers (config.pinHeaders): an overlay at the top of the scroller, laid out by
// pinning.ts from CodeMirror's height map on every scroll (no layout reads while scrolling). It adds no height to
// the document, and keeps the editor's scroll margins in sync so a cursor near the top stays below it.

import { EditorView, PluginValue, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { computePinned, headerTextTop, PinGeometry, PinnedLayout, PINNED_YEAR_HEIGHT } from './pinning';
import { configField, foldField, structureField } from './state';
import { BoxSection } from './structure';

function geometryOf(view: EditorView): PinGeometry {
    const doc = view.state.doc;
    return {
        lineAtHeight: height => doc.lineAt(view.lineBlockAtHeight(Math.max(0, height)).from).number - 1,
        blockOf: line => view.lineBlockAt(doc.line(Math.min(line, doc.lines - 1) + 1).from),
    };
}

interface Row {
    dom: HTMLElement;
    inner: HTMLElement;
    title: HTMLElement;
    meta: HTMLElement;
    box?: BoxSection;
}

class PinnedHeaders implements PluginValue {
    readonly dom: HTMLElement;
    private readonly year: Row;
    private readonly month: Row;
    layout: PinnedLayout = { height: 0 };
    /** Where the document's top is in the scroller's scroll coordinates */
    private documentOffset = 0;
    private readonly onScroll = () => this.position();
    private frame = 0;
    private readonly observer: ResizeObserver | undefined;

    constructor(readonly view: EditorView) {
        this.dom = document.createElement('div');
        this.dom.className = 'dbm-pinned';
        this.dom.setAttribute('aria-hidden', 'true');
        this.year = this.row('dbm-pinned-year');
        this.month = this.row('dbm-pinned-month');
        view.dom.appendChild(this.dom);
        view.scrollDOM.addEventListener('scroll', this.onScroll, { passive: true });
        this.observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => this.measure());
        this.observer?.observe(view.scrollDOM);
        this.observer?.observe(view.contentDOM);
        this.measure();
    }

    private row(className: string): Row {
        const dom = document.createElement('div');
        dom.className = `dbm-pinned-row ${className}`;
        const inner = document.createElement('div');
        inner.className = 'dbm-pinned-inner';
        const title = document.createElement('span');
        title.className = 'dbm-pinned-title';
        inner.appendChild(title);
        // The day count, shown like on the real header: only when the year or month is folded
        const meta = document.createElement('span');
        meta.className = 'dbm-meta';
        meta.hidden = true;
        inner.appendChild(meta);
        dom.appendChild(inner);
        this.dom.appendChild(dom);
        const row: Row = { dom, inner, title, meta };
        // Like VS Code's sticky scroll: clicking a pinned header goes to the real one
        dom.addEventListener('mousedown', event => event.preventDefault());
        dom.addEventListener('click', event => {
            event.preventDefault();
            if (row.box) {
                this.scrollTo(row.box);
            }
        });
        return row;
    }

    private get enabled(): boolean {
        return this.view.state.field(configField).pinHeaders !== false;
    }

    update(update: ViewUpdate) {
        const configChanged = update.startState.field(configField) !== update.state.field(configField);
        if (update.docChanged || update.viewportChanged || update.geometryChanged || update.heightChanged || configChanged ||
            update.startState.field(foldField) !== update.state.field(foldField)) {
            this.measure();
        }
    }

    /** Reads where the scroller and the text column are (in a measure phase), then lays out */
    measure() {
        this.view.requestMeasure({
            key: this,
            read: view => {
                const scroller = view.scrollDOM.getBoundingClientRect();
                this.documentOffset = view.documentTop - scroller.top + view.scrollDOM.scrollTop;
                return {
                    scroller,
                    editor: view.dom.getBoundingClientRect(),
                    content: view.contentDOM.getBoundingClientRect(),
                    clientWidth: view.scrollDOM.clientWidth,
                    // The height map can only be read here, not while writing
                    layout: this.compute(),
                };
            },
            write: ({ scroller, editor, content, clientWidth, layout }) => {
                this.dom.style.top = `${scroller.top - editor.top}px`;
                this.dom.style.left = `${scroller.left - editor.left}px`;
                this.dom.style.width = `${clientWidth}px`;
                for (const row of [this.year, this.month]) {
                    row.inner.style.marginLeft = `${content.left - scroller.left}px`;
                    row.inner.style.width = `${content.width}px`;
                }
                this.apply(layout);
                // CodeMirror may still correct scrollTop at the end of this measure: lay out again after it
                if (!this.frame) {
                    this.frame = requestAnimationFrame(() => {
                        this.frame = 0;
                        this.position();
                    });
                }
            },
        });
    }

    /** Lays the pinned rows out for the current scroll position (on scroll events, outside of updates) */
    position() {
        // Let CodeMirror finish a pending measure first: it may correct scrollTop (scroll anchoring) while
        // remeasuring lines, and the scroll position must match the height map used below
        this.view.lineBlockAtHeight(0);
        this.apply(this.compute());
    }

    /** The pinned rows for the current scroll position, from the height map only (no DOM layout reads) */
    private compute(): PinnedLayout {
        return this.enabled
            ? computePinned(this.view.state.field(structureField), this.view.scrollDOM.scrollTop - this.documentOffset, geometryOf(this.view))
            : { height: 0 };
    }

    private apply(layout: PinnedLayout) {
        this.layout = layout;
        this.place(this.year, layout.year?.box, layout.year?.top);
        this.place(this.month, layout.month?.box, layout.month?.top);
        this.dom.style.height = `${layout.height}px`;
        this.dom.style.display = layout.height > 0 ? '' : 'none';
    }

    private place(row: Row, box: BoxSection | undefined, top: number | undefined) {
        row.box = box;
        if (!box || top === undefined) {
            row.dom.style.display = 'none';
            return;
        }
        row.dom.style.display = '';
        row.dom.style.transform = `translateY(${top}px)`;
        if (row.title.textContent !== box.title) {
            row.title.textContent = box.title;
        }
        // A folded header can be pinned while the next header pushes it up
        const meta = this.view.state.field(foldField).has(box.key) ? `${box.dayCount} day${box.dayCount === 1 ? '' : 's'}` : '';
        if (row.meta.textContent !== meta) {
            row.meta.textContent = meta;
            row.meta.hidden = !meta;
        }
    }

    /** Scrolls a header to the top, a month right under its (pinned) year */
    private scrollTo(box: BoxSection) {
        const geometry = geometryOf(this.view);
        const below = box.kind === 'month' ? PINNED_YEAR_HEIGHT : 0;
        this.view.scrollDOM.scrollTop = headerTextTop(box, geometry) + this.documentOffset - below;
        // Heights far from the viewport are estimates: correct once the header has been measured
        this.view.requestMeasure({
            read: view => headerTextTop(box, geometryOf(view)) - (view.scrollDOM.scrollTop - this.documentOffset) - below,
            write: error => {
                if (Math.abs(error) > 1) {
                    this.view.scrollDOM.scrollTop += error;
                }
            },
        });
    }

    destroy() {
        cancelAnimationFrame(this.frame);
        this.view.scrollDOM.removeEventListener('scroll', this.onScroll);
        this.observer?.disconnect();
        this.dom.remove();
    }
}

export const pinnedHeaders = ViewPlugin.fromClass(PinnedHeaders, {
    // Revealing the cursor (typing, moving) keeps it below the pinned rows
    provide: plugin => EditorView.scrollMargins.of(view => {
        const height = view.plugin(plugin)?.layout.height ?? 0;
        return height > 0 ? { top: height } : null;
    }),
});
