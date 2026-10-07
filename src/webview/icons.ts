// SVG markup for the rendered view: the "Filled squircles" status icon set from the mockups, plus a few
// codicon-like UI glyphs. Static strings only (no user content), so they are safe to use as innerHTML.

import type { StatusKind } from './structure';

const SQUIRCLE = 'M8 1.75c4.6 0 6.25 1.65 6.25 6.25S12.6 14.25 8 14.25 1.75 12.6 1.75 8 3.4 1.75 8 1.75z';
const SQUIRCLE_FILLED = 'M8 1.25c5.05 0 6.75 1.7 6.75 6.75S13.05 14.75 8 14.75 1.25 13.05 1.25 8 2.95 1.25 8 1.25z';

const STATUS_GLYPHS: Record<StatusKind, string> = {
    open: `<path d="${SQUIRCLE}" class="s"/>`,
    done: `<path d="${SQUIRCLE_FILLED}" class="f"/><path d="M5.1 8.15l1.95 1.95 3.85-4" class="g"/>`,
    progress: `<path d="${SQUIRCLE}" class="s"/><path d="M1.75 8C1.75 12.6 3.4 14.25 8 14.25S14.25 12.6 14.25 8z" class="f"/>`,
    blocked: `<path d="${SQUIRCLE_FILLED}" class="f"/><path d="M6.25 5.4v5.2M9.75 5.4v5.2" class="g"/>`,
    removed: `<path d="${SQUIRCLE_FILLED}" class="f"/><path d="M5.75 5.75l4.5 4.5M10.25 5.75l-4.5 4.5" class="g"/>`,
    tomorrow: `<path d="${SQUIRCLE}" class="s"/><path d="M5.3 8h5.1M8.3 5.8L10.5 8l-2.2 2.2" class="s"/>`,
    unknown: `<path d="${SQUIRCLE}" class="s" stroke-dasharray="1 2"/>`,
};

export function statusIconSvg(kind: StatusKind): string {
    return `<svg class="dbm-ic" viewBox="0 0 16 16" aria-hidden="true" focusable="false">${STATUS_GLYPHS[kind]}</svg>`;
}

const ui = (body: string) => `<svg class="dbm-ui" viewBox="0 0 16 16" aria-hidden="true" focusable="false">${body}</svg>`;

export const UI_ICONS = {
    chevronDown: ui('<path d="M3.5 6L8 10.5 12.5 6"/>'),
    notebook: ui('<rect x="3" y="1.5" width="10.5" height="13" rx="1.5"/><path d="M5.75 1.5v13M8.25 5h3M8.25 7.5h3"/>'),
    list: ui('<path d="M5.5 4h8.5M5.5 8h8.5M5.5 12h8.5"/><path d="M2.25 4h.3M2.25 8h.3M2.25 12h.3" stroke-width="1.8"/>'),
    fold: ui('<path d="M4.5 2.5L8 6l3.5-3.5M4.5 13.5L8 10l3.5 3.5"/>'),
    /** Chevrons pointing together onto a line: fold everything (Expand all's chevrons point apart) */
    collapseAll: ui('<path d="M4.5 1.5L8 5l3.5-3.5M4.5 14.5L8 11l3.5 3.5M2.5 8h11"/>'),
    /** Two speech bubbles: a standup meeting */
    standup: ui('<path d="M1.5 3.5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v4.5a1 1 0 0 1-1 1H5.5L3 11V9H2.5a1 1 0 0 1-1-1z"/><path d="M12.5 6h1a1 1 0 0 1 1 1v4.5a1 1 0 0 1-1 1H13V14.5l-2.5-2h-3a1 1 0 0 1-1-1V11"/>'),
    unfold: ui('<path d="M4.5 6L8 2.5 11.5 6M4.5 10L8 13.5 11.5 10"/>'),
    check: ui('<path d="M3.5 8.5l3 3 6-7"/>'),
    add: ui('<path d="M8 3v10M3 8h10"/>'),
    info: ui('<circle cx="8" cy="8" r="6.25"/><path d="M8 7.25v4M8 4.9v.2"/>'),
};
