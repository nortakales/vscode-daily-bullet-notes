// The text cursor, drawn like VS Code's: the user's editor.cursorStyle / cursorWidth / cursorBlinking, about as
// tall as the text (not the padded line) and centered on it, blinking with VS Code's timing. Replaces the cursor
// of CodeMirror's drawSelection (whose layer is hidden in styles.css); the selection itself is still drawn by it.

import { EditorView, layer, LayerMarker, ViewUpdate } from '@codemirror/view';
import type { CursorConfig } from '../rendered/protocol';
import { configField } from './state';

const DEFAULT_CURSOR: CursorConfig = { style: 'line', width: 0, blinking: 'blink' };
/** Like VS Code: the cursor is as tall as the text's line box, about 1.35 times the font size */
const TEXT_HEIGHT_RATIO = 1.35;

export function cursorConfig(view: { state: EditorView['state'] }): CursorConfig {
    return view.state.field(configField, false)?.cursor ?? DEFAULT_CURSOR;
}

class CaretMarker implements LayerMarker {
    constructor(readonly className: string, readonly left: number, readonly top: number, readonly width: number, readonly height: number,
        readonly text: string) { }

    draw(): HTMLElement {
        const element = document.createElement('div');
        element.className = this.className;
        this.adjust(element);
        return element;
    }

    update(element: HTMLElement, previous: LayerMarker): boolean {
        if (!(previous instanceof CaretMarker) || previous.className !== this.className) {
            return false;
        }
        this.adjust(element);
        return true;
    }

    private adjust(element: HTMLElement) {
        element.style.left = `${this.left}px`;
        element.style.top = `${this.top}px`;
        element.style.width = `${this.width}px`;
        element.style.height = `${this.height}px`;
        element.style.lineHeight = `${this.height}px`;
        element.textContent = this.text;
    }

    eq(other: LayerMarker): boolean {
        return other instanceof CaretMarker && other.className === this.className && other.left === this.left && other.top === this.top &&
            other.width === this.width && other.height === this.height && other.text === this.text;
    }
}

/** Where the layer's coordinates start, like CodeMirror's own layers */
function layerBase(view: EditorView) {
    const rect = view.scrollDOM.getBoundingClientRect();
    return { left: rect.left - view.scrollDOM.scrollLeft * view.scaleX, top: rect.top - view.scrollDOM.scrollTop * view.scaleY };
}

function caretMarkers(view: EditorView): CaretMarker[] {
    const config = cursorConfig(view);
    const state = view.state;
    const fontSize = parseFloat(getComputedStyle(view.contentDOM).fontSize) || 14;
    const textHeight = Math.round(fontSize * TEXT_HEIGHT_RATIO);
    const base = layerBase(view);
    const markers: CaretMarker[] = [];
    for (const range of state.selection.ranges) {
        const head = range.head;
        const assoc = range.empty ? (range.assoc || 1) : (range.head > range.anchor ? -1 : 1);
        const coords = view.coordsAtPos(head, assoc);
        if (!coords) {
            continue;
        }
        // Centered on the text, whatever box the position measured (text, padded empty line or a widget)
        const center = (coords.top + coords.bottom) / 2;
        const top = (center - textHeight / 2 - base.top) / view.scaleY;
        const left = (coords.left - base.left) / view.scaleX;
        const primary = range === state.selection.main ? ' dbm-caret-primary' : '';

        if (config.style === 'line' || config.style === 'line-thin') {
            const width = config.style === 'line-thin' ? 1 : (config.width > 0 ? config.width : 2);
            markers.push(new CaretMarker(`dbm-caret dbm-caret-line${primary}`, left - width / 2, top, width, textHeight, ''));
            continue;
        }
        // Block and underline cursors are as wide as the character under them (about 0.6em at the end of a line)
        let width = Math.round(fontSize * 0.6);
        let character = '';
        const line = state.doc.lineAt(head);
        if (head < line.to) {
            const next = view.coordsAtPos(head + 1, -1);
            if (next && Math.abs((next.top + next.bottom) / 2 - center) < 2 && next.left > coords.left && next.left - coords.left < fontSize * 3) {
                width = (next.left - coords.left) / view.scaleX;
                character = state.doc.sliceString(head, head + 1);
            }
        }
        if (config.style === 'block') {
            markers.push(new CaretMarker(`dbm-caret dbm-caret-block${primary}`, left, top, width, textHeight, character));
        } else if (config.style === 'block-outline') {
            markers.push(new CaretMarker(`dbm-caret dbm-caret-block-outline${primary}`, left, top, width, textHeight, ''));
        } else {
            const height = config.style === 'underline-thin' ? 1 : 2;
            markers.push(new CaretMarker(`dbm-caret dbm-caret-underline${primary}`, left, top + textHeight - height, width, height, ''));
        }
    }
    return markers;
}

/**
 * Blinking is a CSS animation on the carets. Changing its name (between two identical keyframes) restarts it,
 * which keeps the caret solid while typing or moving and resumes blinking after a short pause, like VS Code.
 */
function applyBlinking(dom: HTMLElement, config: CursorConfig, restart: boolean) {
    const mode = config.blinking;
    for (const name of ['blink', 'smooth', 'phase', 'expand', 'solid']) {
        dom.classList.toggle(`dbm-blinking-${name}`, name === mode);
    }
    if (mode === 'solid') {
        dom.style.setProperty('--dbm-caret-animation', 'none');
        return;
    }
    const current = dom.style.getPropertyValue('--dbm-caret-animation');
    const flip = restart ? !current.endsWith('-a') : current.endsWith('-a');
    dom.style.setProperty('--dbm-caret-animation', `dbm-caret-${mode}-${flip ? 'a' : 'b'}`);
}

export const caretLayer = layer({
    above: true,
    class: 'dbm-caret-layer',
    markers: caretMarkers,
    update(update: ViewUpdate, dom: HTMLElement) {
        const before = update.startState.field(configField, false)?.cursor;
        const after = update.state.field(configField, false)?.cursor;
        const configChanged = JSON.stringify(before) !== JSON.stringify(after);
        const moved = update.docChanged || update.transactions.some(tr => tr.selection);
        if (moved || configChanged || update.focusChanged) {
            applyBlinking(dom, cursorConfig(update), moved || update.focusChanged);
        }
        return update.docChanged || update.selectionSet || update.geometryChanged || update.viewportChanged || configChanged;
    },
    mount(dom: HTMLElement, view: EditorView) {
        applyBlinking(dom, cursorConfig(view), true);
    },
});
