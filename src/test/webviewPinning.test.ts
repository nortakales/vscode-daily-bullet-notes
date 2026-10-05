import * as assert from 'assert';
import { computePinned, PinGeometry, PINNED_MONTH_HEIGHT, PINNED_YEAR_HEIGHT } from '../webview/pinning';
import { parseStructure } from '../webview/structure';
import { sampleLines } from './webviewStructure.test';

const LINE = 20;

/**
 * A fake height map: every line is 20px, each box's three lines are one 60px block, and `groups` (first and last
 * line, inclusive) are blocks of their own, like folded sections.
 */
function geometry(lines: string[], boxLines: number[], groups: [number, number, number][] = []): PinGeometry {
    const blocks: { from: number; to: number; top: number; bottom: number }[] = [];
    let top = 0;
    for (let line = 0; line < lines.length;) {
        const group = groups.find(g => g[0] === line);
        const isBox = boxLines.includes(line);
        const to = group ? group[1] : isBox ? line + 2 : line;
        const height = group ? group[2] : (to - line + 1) * LINE;
        blocks.push({ from: line, to, top, bottom: top + height });
        top += height;
        line = to + 1;
    }
    return {
        lineAtHeight: height => (blocks.find(block => height < block.bottom) ?? blocks[blocks.length - 1]).from,
        blockOf: line => blocks.find(block => block.from <= line && line <= block.to)!,
    };
}

function days(month: number, count: number): string[] {
    const spec: string[] = [];
    for (let day = 1; day <= count; day++) {
        spec.push(`#day ${month}/${day}`, '[ ] a', '[ ] b', '');
    }
    return spec;
}

const LINES = sampleLines([
    '#box Daily Log',
    '#box 2025', '#box November', ...days(11, 3), '#box December', ...days(12, 3),
    '#box 2026', '#box January', ...days(1, 3),
    '#box Notes', '- a', '- b', '- c', '- d', '- e', '- f', '- g', '- h', '- i', '- j',
]);
const STRUCTURE = parseStructure(LINES);
const BOX_LINES = STRUCTURE.boxes.map(box => box.line);
const GEOMETRY = geometry(LINES, BOX_LINES);
const box = (key: string) => STRUCTURE.boxes.find(b => b.key === key)!;
const top = (line: number) => GEOMETRY.blockOf(line).top;
const bottom = (line: number) => GEOMETRY.blockOf(line).bottom;
const pinned = (at: number) => {
    const layout = computePinned(STRUCTURE, at, GEOMETRY);
    return { year: layout.year && [layout.year.box.title, layout.year.top], month: layout.month && [layout.month.box.title, layout.month.top], height: layout.height };
};

suite('Webview pinned headers', () => {

    test('nothing before the first year header has scrolled away', () => {
        assert.deepStrictEqual(pinned(0), { year: undefined, month: undefined, height: 0 });
        const yearText = bottom(box('year:2025').line) - PINNED_YEAR_HEIGHT;
        assert.strictEqual(pinned(yearText).height, 0);
        assert.deepStrictEqual(pinned(yearText + 1).year, ['2025', 0]);
    });

    test('the current year and month, mid-month', () => {
        const november = box('month:2025-11');
        const at = top(november.line + 5);
        assert.deepStrictEqual(pinned(at), { year: ['2025', 0], month: ['November', PINNED_YEAR_HEIGHT], height: PINNED_YEAR_HEIGHT + PINNED_MONTH_HEIGHT });
    });

    test('a month is pinned once its header scrolls under the pinned year', () => {
        const december = box('month:2025-12');
        const monthText = bottom(december.line) - 2 - PINNED_MONTH_HEIGHT;
        assert.deepStrictEqual(pinned(monthText - PINNED_YEAR_HEIGHT).month, undefined);
        assert.deepStrictEqual(pinned(monthText - PINNED_YEAR_HEIGHT + 1).month, ['December', PINNED_YEAR_HEIGHT]);
    });

    test('the next month pushes the pinned month up under the year, continuously', () => {
        const november = box('month:2025-11');
        const end = bottom(november.end);
        const stack = PINNED_YEAR_HEIGHT + PINNED_MONTH_HEIGHT;
        assert.deepStrictEqual(pinned(end - stack).month, ['November', PINNED_YEAR_HEIGHT]);
        const offsets = [5, 10, 15, 20, 25].map(d => pinned(end - stack + d).month);
        assert.deepStrictEqual(offsets, [5, 10, 15, 20, 25].map(d => ['November', PINNED_YEAR_HEIGHT - d]));
        // Fully behind the year: no month until December's header gets there
        assert.strictEqual(pinned(end - PINNED_YEAR_HEIGHT).month, undefined);
        assert.deepStrictEqual(pinned(end - PINNED_YEAR_HEIGHT).year, ['2025', 0]);
    });

    test('the next year pushes the whole stack up, then takes its place', () => {
        const year = box('year:2025');
        const end = bottom(year.end);
        const stack = PINNED_YEAR_HEIGHT + PINNED_MONTH_HEIGHT;
        assert.deepStrictEqual(pinned(end - stack), { year: ['2025', 0], month: ['December', PINNED_YEAR_HEIGHT], height: stack });
        assert.deepStrictEqual(pinned(end - stack + 30), { year: ['2025', -30], month: ['December', PINNED_YEAR_HEIGHT - 30], height: stack - 30 });
        assert.deepStrictEqual(pinned(end - 20), { year: ['2025', -56], month: ['December', -10], height: 20 });
        // Continuous all the way: the stack's bottom is always the year's end
        for (let d = 1; d < 76; d++) {
            assert.strictEqual(pinned(end - d).height, d, `at ${d}px before the end`);
        }
        // 2026's header is visible right at the top: nothing pinned until it scrolls away
        assert.strictEqual(pinned(end).height, 0);
        assert.deepStrictEqual(pinned(bottom(box('year:2026').line) - PINNED_YEAR_HEIGHT + 1).year, ['2026', 0]);
    });

    test('nothing in a list section', () => {
        const notes = box('list:Notes');
        assert.strictEqual(pinned(top(notes.line + 5)).height, 0);
        assert.strictEqual(pinned(top(notes.line)).height, 0);
    });

    test('a folded year slides away with its own header', () => {
        const year = box('year:2025');
        const folded = geometry(LINES, BOX_LINES.filter(line => line <= year.line || line > year.end), [[year.line, year.end, 48]]);
        const header = folded.blockOf(year.line);
        assert.strictEqual(computePinned(STRUCTURE, header.top, folded).height, 0);
        const layout = computePinned(STRUCTURE, header.top + 10, folded);
        assert.deepStrictEqual([layout.year?.top, layout.month, layout.height], [-8, undefined, 38]);
        assert.strictEqual(computePinned(STRUCTURE, header.bottom, folded).height, 0);
    });
});
