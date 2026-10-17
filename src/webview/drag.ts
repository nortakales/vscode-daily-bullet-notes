// Dragging tasks and notes: a grip appears to the left of the item under the mouse; dragging it moves the item
// with everything indented under it. While dragging, a copy of the item follows the pointer, the item leaves its
// place, and a faded copy sits exactly where (and how deep) it will land. Dragging right or left from where the
// drag started makes it deeper or shallower, within what fits there. The move itself is moving.ts.

import { EditorSelection, EditorState, Extension, Prec, RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import { BlockInfo, BlockType, Decoration, EditorView, PluginValue, ViewPlugin, ViewUpdate, WidgetType } from '@codemirror/view';
import { UI_ICONS } from './icons';
import { blockLevel, canDropAt, dropLevels, itemBlockAt, ItemBlock, moveBlockSpec } from './moving';
import { tabSizeOf } from './state';
import { analyzeLine } from './structure';

// ---------------------------------------------------------------------------------------------
// Drag state in the editor state: the item leaves its place, and a preview shows where it will land

interface DragPreview {
    block: ItemBlock;
    /** Copies of the item's rendered lines */
    lines: readonly HTMLElement[];
    /** Their level (the item's first line) */
    level: number;
    height: number;
    drop?: { gap: number; level: number };
}

const setDragEffect = StateEffect.define<DragPreview | null>();

const dragField = StateField.define<DragPreview | null>({
    create: () => null,
    update(value, tr) {
        for (const effect of tr.effects) {
            if (effect.is(setDragEffect)) {
                value = effect.value;
            }
        }
        // Lines shifted by an edit: the preview would be in the wrong place (the drag is cancelled)
        return value && tr.docChanged ? null : value;
    },
});

/** Copies of rendered lines, `shift` levels deeper (or shallower) */
function copyLines(lines: readonly HTMLElement[], shift: number): HTMLElement {
    const wrapper = document.createElement('div');
    for (const line of lines) {
        const copy = line.cloneNode(true) as HTMLElement;
        const level = parseFloat(line.style.getPropertyValue('--dbm-indent')) || 0;
        copy.style.setProperty('--dbm-indent', String(Math.max(0, level + shift)));
        copy.classList.add('dbm-line');
        copy.removeAttribute('contenteditable');
        wrapper.appendChild(copy);
    }
    return wrapper;
}

/** The faded copy of the item where it will land */
class DropPreviewWidget extends WidgetType {
    constructor(readonly preview: DragPreview, readonly level: number) {
        super();
    }

    eq(other: DropPreviewWidget) {
        return other.preview === this.preview && other.level === this.level;
    }

    get estimatedHeight() {
        return this.preview.height;
    }

    toDOM(): HTMLElement {
        const dom = copyLines(this.preview.lines, this.level - this.preview.level);
        dom.className = 'dbm-drop-preview';
        dom.setAttribute('aria-hidden', 'true');
        return dom;
    }

    ignoreEvent() {
        return true;
    }
}

const dragDecorations = Prec.highest(EditorView.decorations.compute([dragField], (state: EditorState) => {
    const preview = state.field(dragField);
    if (!preview) {
        return Decoration.none;
    }
    const doc = state.doc;
    const { block, drop } = preview;
    const from = doc.line(block.first + 1).from, to = doc.line(block.last + 1).to;
    const builder = new RangeSetBuilder<Decoration>();
    const widget = drop && Decoration.widget({ widget: new DropPreviewWidget(preview, drop.level), block: true, side: drop.gap < doc.lines ? -1 : 1 });
    const widgetPos = drop ? (drop.gap < doc.lines ? doc.line(drop.gap + 1).from : doc.length) : -1;
    // In document order: the preview before the item's place, at it, or after it
    if (widget && widgetPos <= from) {
        builder.add(widgetPos, widgetPos, widget);
    }
    builder.add(from, to, Decoration.replace({ block: true }));
    if (widget && widgetPos > from) {
        builder.add(widgetPos, widgetPos, widget);
    }
    return builder.finish();
}));

// ---------------------------------------------------------------------------------------------
// The grip, the copy following the pointer, and working out the drop

/** Near the top or bottom edge of the scroller, the view scrolls while dragging */
const AUTO_SCROLL_EDGE = 48;
const AUTO_SCROLL_MAX_SPEED = 18;
const HANDLE_WIDTH = 18;
/** Pointer movement before a press on the grip becomes a drag (otherwise it's a click) */
const DRAG_THRESHOLD = 4;

interface DragState {
    block: ItemBlock;
    pointerId: number;
    startX: number;
    startY: number;
    startLevel: number;
    x: number;
    y: number;
    /** Where the pointer holds the item, from its top left corner */
    grabX: number;
    grabY: number;
    preview?: DragPreview;
    ghost?: HTMLElement;
    frame: number;
}

class DragHandles implements PluginValue {
    private readonly handle: HTMLElement;
    /** 0-based line the handle is showing for, or -1 */
    private hoverLine = -1;
    private drag: DragState | undefined;

    private readonly onHover = (event: MouseEvent) => this.hover(event);
    private readonly onLeave = (event: MouseEvent) => {
        if (!this.drag && !(event.relatedTarget instanceof Node && this.view.dom.contains(event.relatedTarget))) {
            this.hideHandle();
        }
    };
    private readonly onScroll = () => {
        if (!this.drag) {
            this.hideHandle();
        }
    };
    private readonly onKey = (event: KeyboardEvent) => {
        if (this.drag && event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            this.end(false);
        }
    };

    constructor(readonly view: EditorView) {
        this.handle = document.createElement('div');
        this.handle.className = 'dbm-drag-handle';
        this.handle.innerHTML = UI_ICONS.grip;
        this.handle.title = 'Drag to move (with everything under it)';
        this.handle.setAttribute('aria-hidden', 'true');
        this.handle.hidden = true;
        view.dom.appendChild(this.handle);

        view.scrollDOM.addEventListener('mousemove', this.onHover);
        view.dom.addEventListener('mouseleave', this.onLeave);
        view.scrollDOM.addEventListener('scroll', this.onScroll, { passive: true });
        this.handle.addEventListener('mousedown', event => event.preventDefault());
        this.handle.addEventListener('pointerdown', event => this.start(event));
        this.handle.addEventListener('pointermove', event => this.move(event));
        this.handle.addEventListener('pointerup', () => this.end(true));
        this.handle.addEventListener('pointercancel', () => this.end(false));
        window.addEventListener('keydown', this.onKey, true);
    }

    update(update: ViewUpdate) {
        if (this.drag?.preview && !update.state.field(dragField)) {
            // The document changed under the drag (e.g. an edit from the text view): give up
            this.end(false);
        } else if (!this.drag && (update.docChanged || update.geometryChanged)) {
            this.hideHandle();
        }
    }

    destroy() {
        this.end(false);
        this.handle.remove();
        this.view.scrollDOM.removeEventListener('mousemove', this.onHover);
        this.view.dom.removeEventListener('mouseleave', this.onLeave);
        this.view.scrollDOM.removeEventListener('scroll', this.onScroll);
        window.removeEventListener('keydown', this.onKey, true);
    }

    private get step(): number {
        return parseFloat(getComputedStyle(document.body).getPropertyValue('--dbm-step')) || 28;
    }

    // ----- The grip -----

    private hover(event: MouseEvent) {
        if (this.drag || event.buttons !== 0) {
            return;
        }
        const view = this.view;
        const block = view.lineBlockAtHeight(event.clientY - view.documentTop);
        if (block.type !== BlockType.Text) {
            this.hideHandle();
            return;
        }
        const line = view.state.doc.lineAt(block.from);
        if (line.number - 1 === this.hoverLine && !this.handle.hidden) {
            return;
        }
        if (!itemBlockAt(view.state, line.number - 1)) {
            this.hideHandle();
            return;
        }
        const info = analyzeLine(line.text, tabSizeOf(view.state));
        const coords = view.coordsAtPos(line.from + info.textStart, 1);
        if (!coords) {
            this.hideHandle();
            return;
        }
        const editor = view.dom.getBoundingClientRect();
        const content = view.contentDOM.getBoundingClientRect();
        // Left of the item's icon or marker column (the text column for plain notes)
        const level = info.indentWidth / tabSizeOf(view.state);
        const left = content.left + level * this.step - HANDLE_WIDTH - 2;
        this.hoverLine = line.number - 1;
        this.handle.style.left = `${left - editor.left}px`;
        this.handle.style.top = `${coords.top - editor.top}px`;
        this.handle.style.height = `${Math.max(16, coords.bottom - coords.top)}px`;
        this.handle.hidden = false;
    }

    private hideHandle() {
        this.hoverLine = -1;
        this.handle.hidden = true;
    }

    // ----- Dragging -----

    private start(event: PointerEvent) {
        if (event.button !== 0 || this.hoverLine < 0) {
            return;
        }
        const block = itemBlockAt(this.view.state, this.hoverLine);
        if (!block) {
            return;
        }
        event.preventDefault();
        this.handle.setPointerCapture(event.pointerId);
        this.drag = {
            block, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, startLevel: blockLevel(this.view.state, block),
            x: event.clientX, y: event.clientY, grabX: 0, grabY: 0, frame: 0,
        };
    }

    /** The rendered lines of the item (the ones in view) */
    private renderedLines(block: ItemBlock): HTMLElement[] {
        const view = this.view;
        const lines: HTMLElement[] = [];
        for (const element of view.contentDOM.querySelectorAll<HTMLElement>(':scope > .cm-line')) {
            const line = view.state.doc.lineAt(view.posAtDOM(element, 0)).number - 1;
            if (line >= block.first && line <= block.last) {
                lines.push(element);
            }
        }
        return lines;
    }

    /** The press became a drag: the copy under the pointer, and the item leaves its place */
    private begin(drag: DragState) {
        const view = this.view;
        const lines = this.renderedLines(drag.block);
        if (lines.length === 0) {
            return false;
        }
        const top = lines[0].getBoundingClientRect();
        const bottom = lines[lines.length - 1].getBoundingClientRect();
        const content = view.contentDOM.getBoundingClientRect();
        // The copy that follows the pointer, held where it was grabbed
        const ghost = copyLines(lines, 0);
        ghost.className = 'dbm-drag-ghost';
        ghost.setAttribute('aria-hidden', 'true');
        ghost.style.width = `${content.width}px`;
        drag.grabX = drag.startX - content.left;
        drag.grabY = drag.startY - top.top;
        // Inside the editor, so the lines are styled like the real ones
        view.dom.appendChild(ghost);
        drag.ghost = ghost;
        view.dom.classList.add('dbm-dragging');
        // The preview starts where the item is
        drag.preview = { block: drag.block, lines, level: drag.startLevel, height: bottom.bottom - top.top, drop: { gap: drag.block.first, level: drag.startLevel } };
        view.dispatch({ effects: setDragEffect.of(drag.preview) });
        return true;
    }

    private move(event: PointerEvent) {
        const drag = this.drag;
        if (!drag || event.pointerId !== drag.pointerId) {
            return;
        }
        drag.x = event.clientX;
        drag.y = event.clientY;
        if (!drag.ghost) {
            if (Math.abs(drag.x - drag.startX) < DRAG_THRESHOLD && Math.abs(drag.y - drag.startY) < DRAG_THRESHOLD) {
                return;
            }
            this.hideHandle();
            if (!this.begin(drag)) {
                return;
            }
        }
        this.follow();
        this.target();
        this.autoScroll();
    }

    /** Moves the copy with the pointer */
    private follow() {
        const drag = this.drag;
        if (!drag?.ghost) {
            return;
        }
        const editor = this.view.dom.getBoundingClientRect();
        const content = this.view.contentDOM.getBoundingClientRect();
        // Sideways only as far as it is dragged (from where it was grabbed)
        drag.ghost.style.transform = `translate(${content.left - editor.left + (drag.x - drag.startX)}px, ${drag.y - drag.grabY - editor.top}px)`;
    }

    /** Works out the drop for the pointer position and shows it */
    private target() {
        const drag = this.drag;
        const preview = drag?.preview;
        if (!drag || !preview) {
            return;
        }
        const view = this.view;
        const state = view.state;
        const doc = state.doc;
        const scroller = view.scrollDOM.getBoundingClientRect();
        // The middle of the item's first line, where the pointer holds it
        const y = Math.min(Math.max(drag.y, scroller.top + 1), scroller.bottom - 1);
        const height = y - view.documentTop;
        let gap = this.gapAt(height);
        if (gap === undefined) {
            // Over the preview itself: only the level can change
            gap = preview.drop?.gap;
        }
        if (gap === undefined || !canDropAt(state, drag.block, gap)) {
            return;
        }
        const { min, max } = dropLevels(state, drag.block, gap);
        const wanted = drag.startLevel + Math.round((drag.x - drag.startX) / this.step);
        const level = Math.min(Math.max(wanted, min), max);
        if (preview.drop?.gap === gap && preview.drop.level === level) {
            return;
        }
        drag.preview = { ...preview, drop: { gap, level } };
        view.dispatch({ effects: setDragEffect.of(drag.preview) });
    }

    /** The gap the pointer is over (undefined over the preview): before the line of its upper half, after its lower */
    private gapAt(height: number): number | undefined {
        const view = this.view;
        const doc = view.state.doc;
        const drag = this.drag!;
        let block: BlockInfo = view.lineBlockAtHeight(height);
        // A line with block widgets (the preview, or a header widget): the part under the pointer
        if (Array.isArray(block.type)) {
            const part = (block.type as readonly BlockInfo[]).find(b => height >= b.top && height < b.bottom) ?? block;
            if (part.type === BlockType.WidgetBefore || part.type === BlockType.WidgetAfter) {
                const isPreview = part.widget instanceof DropPreviewWidget;
                if (isPreview) {
                    return undefined;
                }
            }
            block = part;
        } else if ((block.type === BlockType.WidgetBefore || block.type === BlockType.WidgetAfter) && block.widget instanceof DropPreviewWidget) {
            return undefined;
        }
        const fromLine = doc.lineAt(block.from).number - 1, toLine = doc.lineAt(block.to).number - 1;
        let gap = height < (block.top + block.bottom) / 2 ? fromLine : toLine + 1;
        // Where the item was (it's hidden): it stays there
        if (gap > drag.block.first && gap <= drag.block.last) {
            gap = drag.block.first;
        }
        return gap;
    }

    private autoScroll() {
        const drag = this.drag;
        if (!drag || drag.frame) {
            return;
        }
        const scroller = this.view.scrollDOM.getBoundingClientRect();
        const speed = drag.y < scroller.top + AUTO_SCROLL_EDGE
            ? -Math.ceil(AUTO_SCROLL_MAX_SPEED * (1 - Math.max(0, drag.y - scroller.top) / AUTO_SCROLL_EDGE))
            : drag.y > scroller.bottom - AUTO_SCROLL_EDGE
                ? Math.ceil(AUTO_SCROLL_MAX_SPEED * (1 - Math.max(0, scroller.bottom - drag.y) / AUTO_SCROLL_EDGE))
                : 0;
        if (speed === 0) {
            return;
        }
        drag.frame = requestAnimationFrame(() => {
            drag.frame = 0;
            if (this.drag !== drag) {
                return;
            }
            this.view.scrollDOM.scrollTop += speed;
            this.target();
            this.autoScroll();
        });
    }

    private end(drop: boolean) {
        const drag = this.drag;
        if (!drag) {
            return;
        }
        this.drag = undefined;
        cancelAnimationFrame(drag.frame);
        if (this.handle.hasPointerCapture(drag.pointerId)) {
            this.handle.releasePointerCapture(drag.pointerId);
        }
        drag.ghost?.remove();
        this.hideHandle();
        this.view.dom.classList.remove('dbm-dragging');
        const view = this.view;
        if (!drag.ghost) {
            // A click on the grip: the cursor goes to the start of the item's text, like a click in its indentation
            if (drop) {
                const line = view.state.doc.line(drag.block.first + 1);
                view.dispatch({ selection: EditorSelection.cursor(line.from + analyzeLine(line.text, tabSizeOf(view.state)).textStart), userEvent: 'select.pointer' });
                view.focus();
            }
            return;
        }
        const target = drag.preview?.drop;
        const spec = drop && target && view.state.field(dragField) ? moveBlockSpec(view.state, drag.block, target.gap, target.level) : undefined;
        // Deferred: end() can run inside an update (the document changed under the drag)
        queueMicrotask(() => {
            if (!view.dom.isConnected) {
                return;
            }
            view.dispatch(spec ? { ...spec, effects: setDragEffect.of(null) } : { effects: setDragEffect.of(null) });
            if (spec) {
                view.focus();
            }
        });
    }
}

export const dragHandles: Extension = [
    dragField,
    dragDecorations,
    ViewPlugin.fromClass(DragHandles),
];
