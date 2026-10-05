// Which year and month headers are pinned at the top while scrolling (like VS Code's sticky scroll), and where.
// Pure: positions come from a geometry callback (CodeMirror's height map in the view), so it is unit tested in Node.

import { BoxSection, DocStructure } from './structure';

/** Heights of the pinned rows: the same as the real header lines, without their spacing (see styles.css) */
export const PINNED_YEAR_HEIGHT = 46;
export const PINNED_MONTH_HEIGHT = 30;
/** Space under the month header line inside its box (.dbm-month padding-bottom); year boxes have none */
export const MONTH_BOX_BOTTOM = 2;

export interface Block {
    top: number;
    bottom: number;
}

/** Positions in document coordinates (CodeMirror's height map) */
export interface PinGeometry {
    /** The 0-based line at a document height */
    lineAtHeight(height: number): number;
    /** The block (header widget, folded section or line) a 0-based line is in */
    blockOf(line: number): Block;
}

export interface PinnedRow {
    box: BoxSection;
    /** Top of the pinned row, relative to the top of the viewport (negative while it is pushed up) */
    top: number;
}

export interface PinnedLayout {
    year?: PinnedRow;
    month?: PinnedRow;
    /** How much of the top of the viewport the pinned rows cover */
    height: number;
}

const NOTHING: PinnedLayout = { height: 0 };

const yearsAndMonths = new WeakMap<DocStructure, { years: BoxSection[]; months: BoxSection[] }>();

function boxesOf(structure: DocStructure) {
    let boxes = yearsAndMonths.get(structure);
    if (!boxes) {
        boxes = { years: structure.boxes.filter(box => box.kind === 'year'), months: structure.boxes.filter(box => box.kind === 'month') };
        yearsAndMonths.set(structure, boxes);
    }
    return boxes;
}

/** The last box starting at or before a line */
function lastAtOrBefore(boxes: BoxSection[], line: number): BoxSection | undefined {
    let low = 0, high = boxes.length - 1, found: BoxSection | undefined;
    while (low <= high) {
        const mid = (low + high) >> 1;
        if (boxes[mid].line <= line) {
            found = boxes[mid];
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }
    return found;
}

/** Top of a header's text line, below the spacing above it */
export function headerTextTop(box: BoxSection, geometry: PinGeometry): number {
    const bottom = geometry.blockOf(box.line).bottom;
    return box.kind === 'year' ? bottom - PINNED_YEAR_HEIGHT : bottom - MONTH_BOX_BOTTOM - PINNED_MONTH_HEIGHT;
}

/**
 * The pinned rows for a viewport whose top is at document height `top`. The year whose header has scrolled
 * above the top is pinned there, and the month under it once its header has scrolled under the year. When a
 * section ends, the next header pushes the pinned rows up: a month slides up under the year, and at the end of
 * a year both move up together. Nothing is pinned outside years (the Daily Log box, lists).
 */
export function computePinned(structure: DocStructure, top: number, geometry: PinGeometry): PinnedLayout {
    const { years, months } = boxesOf(structure);
    const line = geometry.lineAtHeight(top);
    const year = lastAtOrBefore(years, line);
    if (!year || line > year.end || headerTextTop(year, geometry) >= top) {
        return NOTHING;
    }

    // The month at the line right under the pinned year (at most the year's last line, so the month stays
    // pinned while the next year pushes both up)
    const yearEndBottom = geometry.blockOf(year.end).bottom;
    const under = Math.min(top + PINNED_YEAR_HEIGHT, yearEndBottom - 1);
    const monthLine = geometry.lineAtHeight(under);
    let month = lastAtOrBefore(months, monthLine);
    if (month && (month.line < year.line || month.line > year.end || monthLine > month.end || headerTextTop(month, geometry) >= under)) {
        month = undefined;
    }

    // The year's end pushes the whole stack up; a month's end pushes it up under the year
    const yearEnd = yearEndBottom - top;
    const shift = Math.min(0, yearEnd - PINNED_YEAR_HEIGHT - (month ? PINNED_MONTH_HEIGHT : 0));
    const yearBottom = shift + PINNED_YEAR_HEIGHT;
    const layout: PinnedLayout = { year: { box: year, top: shift }, height: Math.max(0, yearBottom) };
    if (month) {
        const monthEnd = geometry.blockOf(month.end).bottom - top;
        const monthTop = Math.min(yearBottom, monthEnd - PINNED_MONTH_HEIGHT);
        if (monthTop + PINNED_MONTH_HEIGHT > yearBottom) {
            layout.month = { box: month, top: monthTop };
            layout.height = Math.max(layout.height, monthTop + PINNED_MONTH_HEIGHT);
        }
    }
    return layout.height > 0 ? layout : NOTHING;
}
