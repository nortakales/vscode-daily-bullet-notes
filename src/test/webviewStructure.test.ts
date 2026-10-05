import * as assert from 'assert';
import { getBoxHeader, getDailyHeader } from '../strings';
import {
    analyzeLine, countListItems, dayLabel, daysTouching, directSubtaskStatuses, findDayAt, headerAt, isToday, parseStructure,
    sectionsContaining, sectionsOf, standupDays, standupFoldKeys, statusKind, summarizeDay
} from '../webview/structure';

/** Expands "#box Title" and "#day M/D" shorthands with the extension's own header formatting */
export function sampleLines(spec: string[]): string[] {
    return spec.flatMap(line => {
        if (line.startsWith('#box ')) {
            return getBoxHeader(line.slice(5)).split('\n');
        }
        if (line.startsWith('#day ')) {
            const [month, day] = line.slice(5).split('/').map(Number);
            return [getDailyHeader(month, day)];
        }
        return [line];
    });
}

const README_EXAMPLE = sampleLines([
    '#box Daily Log',
    '#box 2024',
    '#box December',
    '#day 12/4',
    'here is whatever you did yesterday',
    '',
    '#day 12/5',
    'and this is today',
    '[x] this task is complete',
    '[/] this task is blocked',
    '[-] this task is removed',
    '[+] you made some progress',
    '[ ] this task is ready',
    '[>] this task is for tomorrow',
    'Here is a quick note',
    '',
    '#box Example List',
    'This is an example list,',
    '    with an indented line',
    'and a second item',
]);

suite('Webview structure: parsing', () => {

    test('box headers, days and sections of the README example', () => {
        const structure = parseStructure(README_EXAMPLE);
        assert.deepStrictEqual(structure.boxes.map(box => [box.kind, box.title, box.key, box.line, box.end]), [
            ['dailyLog', 'Daily Log', 'log', 0, 2],
            ['year', '2024', 'year:2024', 3, 21],
            ['month', 'December', 'month:2024-12', 6, 21],
            ['list', 'Example List', 'list:Example List', 22, 27],
        ]);
        assert.deepStrictEqual(structure.days.map(day => [day.key, day.line, day.end, day.month, day.day, day.year]), [
            ['day:2024-12-04', 9, 11, 12, 4, 2024],
            ['day:2024-12-05', 12, 21, 12, 5, 2024],
        ]);
        const month = structure.boxes[2];
        assert.strictEqual(month.dayCount, 2);
        assert.deepStrictEqual(structure.boxes[1].monthTitles, ['December']);
        assert.strictEqual(structure.boxes[3].itemCount, 2);
        assert.strictEqual(structure.boxes[3].firstList, true);
        assert.strictEqual(structure.lineCount, README_EXAMPLE.length);
    });

    test('malformed boxes stay plain lines', () => {
        const border = '+' + '-'.repeat(40) + '+';
        const lines = [
            border, '|   Missing bottom   |', 'not a border',      // no bottom border
            border, '|NoSpaces|', border,                          // title needs whitespace around it
            '+' + '-'.repeat(19) + '+', '|  Short  |', '+' + '-'.repeat(19) + '+', // borders need 20 dashes
            border, '|   Real   |', border,
        ];
        const structure = parseStructure(lines);
        assert.deepStrictEqual(structure.boxes.map(box => [box.title, box.line]), [['Real', 9]]);
    });

    test('a box border ends a day even when the box is malformed, like documentParser', () => {
        const lines = sampleLines(['#box 2026', '#box October', '#day 10/4', '[ ] task', '+' + '-'.repeat(30) + '+', 'after']);
        const structure = parseStructure(lines);
        assert.deepStrictEqual(structure.days.map(day => [day.line, day.end]), [[6, 7]]);
    });

    test('days without a month take it from the month box, and unknown parts stay unknown', () => {
        const lines = sampleLines(['#box 2026', '#box October']).concat([
            '4 ' + '-'.repeat(30),
            'note',
            '+' + '-'.repeat(40) + '+', '|   List   |', '+' + '-'.repeat(40) + '+',
            '7 ' + '-'.repeat(30),
        ]);
        const structure = parseStructure(lines);
        assert.deepStrictEqual(structure.days.map(day => [day.key, day.month, day.year]), [
            ['day:2026-10-04', 10, 2026],
            ['day:?-??-07', undefined, undefined],
        ]);
    });

    test('the month in a day header wins over the month box', () => {
        const structure = parseStructure(sampleLines(['#box 1988', '#box November', '#day 5/5']));
        assert.deepStrictEqual([structure.days[0].month, structure.days[0].day, structure.days[0].key], [5, 5, 'day:1988-05-05']);
    });

    test('duplicate identities get a suffix', () => {
        const structure = parseStructure(sampleLines(['#box 2026', '#box October', '#day 10/4', '#day 10/4', '#box Notes', '#box Notes']));
        assert.deepStrictEqual(structure.days.map(day => day.key), ['day:2026-10-04', 'day:2026-10-04#2']);
        assert.deepStrictEqual(structure.boxes.filter(box => box.kind === 'list').map(box => box.key), ['list:Notes', 'list:Notes#2']);
    });

    test('years run until the next year, months until the next box, lists until the next box', () => {
        const lines = sampleLines([
            '#box Daily Log', '#box 2025', '#box December', '#day 12/31', 'a',
            '#box 2026', '#box January', '#day 1/1', 'b', '#box February', '#day 2/1', 'c', '',
            '#box List one', 'x', '#box List two', 'y',
        ]);
        const structure = parseStructure(lines);
        const ends = Object.fromEntries(structure.boxes.map(box => [box.key, [box.line, box.end]]));
        assert.deepStrictEqual(ends, {
            'log': [0, 2],
            'year:2025': [3, 10],
            'month:2025-12': [6, 10],
            'year:2026': [11, 24],
            'month:2026-01': [14, 18],
            'month:2026-02': [19, 24],
            'list:List one': [25, 28],
            'list:List two': [29, 32],
        });
        assert.deepStrictEqual(structure.boxes.find(box => box.key === 'year:2026')!.monthTitles, ['January', 'February']);
        assert.strictEqual(structure.boxes.find(box => box.key === 'year:2026')!.dayCount, 2);
        assert.deepStrictEqual(structure.boxes.filter(box => box.kind === 'list').map(box => box.firstList), [true, false]);
    });

    test('sections and lookups', () => {
        const structure = parseStructure(README_EXAMPLE);
        assert.deepStrictEqual(sectionsOf(structure).map(section => section.key),
            ['year:2024', 'month:2024-12', 'day:2024-12-04', 'day:2024-12-05', 'list:Example List']);
        assert.deepStrictEqual(sectionsContaining(structure, 14).map(section => section.key), ['year:2024', 'month:2024-12', 'day:2024-12-05']);
        assert.deepStrictEqual(sectionsContaining(structure, 26).map(section => section.key), ['list:Example List']);
        assert.strictEqual(headerAt(structure, 1)?.kind, 'box');
        assert.strictEqual(headerAt(structure, 12)?.kind, 'day');
        assert.strictEqual(headerAt(structure, 13), undefined);
    });

    test('standup view folds everything but the two most recent days and their year and month', () => {
        const lines = sampleLines([
            '#box Daily Log', '#box 2025', '#box December', '#day 12/31', 'a',
            '#box 2026', '#box January', '#day 1/1', 'b', '#box February', '#day 2/1', 'c', '#day 2/2', 'd',
            '#box List', '#day 3/3', 'days inside lists are not part of the log',
        ]);
        const structure = parseStructure(lines);
        assert.deepStrictEqual(standupFoldKeys(structure), ['year:2025', 'month:2025-12', 'day:2025-12-31', 'month:2026-01', 'day:2026-01-01', 'list:List', 'day:?-03-03']);
        assert.deepStrictEqual(standupDays(structure).map(day => day.key), ['day:2026-02-01', 'day:2026-02-02']);
    });
});

suite('Webview structure: dates', () => {

    test('weekday and date', () => {
        assert.deepStrictEqual(dayLabel({ year: 2026, month: 10, day: 4 }), { weekday: 'Sun', date: 'Oct 4', long: 'Sunday, October 4, 2026' });
        assert.deepStrictEqual(dayLabel({ year: 2024, month: 2, day: 29 }).weekday, 'Thu');
    });

    test('no weekday without a year or for impossible dates', () => {
        assert.deepStrictEqual(dayLabel({ month: 10, day: 4 }), { weekday: undefined, date: 'Oct 4', long: 'October 4' });
        assert.strictEqual(dayLabel({ year: 2026, month: 2, day: 30 }).weekday, undefined);
        assert.strictEqual(dayLabel({ day: 7 }).date, 'Day 7');
    });

    test('today', () => {
        assert.ok(isToday({ year: 2026, month: 10, day: 4 }, { year: 2026, month: 10, day: 4 }));
        assert.ok(!isToday({ month: 10, day: 4 }, { year: 2026, month: 10, day: 4 }));
    });
});

suite('Webview structure: lines, summaries and day boundaries', () => {

    test('line analysis', () => {
        assert.deepStrictEqual(analyzeLine('    [x] done thing', 4), {
            kind: 'task', indentLength: 4, indentWidth: 4, boxStart: 4, boxEnd: 7, status: 'x', textStart: 8
        });
        const empty = analyzeLine('[]text', 4);
        assert.deepStrictEqual([empty.kind, empty.status, empty.boxEnd, empty.textStart], ['task', '', 2, 2]);
        const note = analyzeLine('\ta note', 4);
        assert.deepStrictEqual([note.kind, note.indentLength, note.indentWidth, note.textStart, note.list], ['note', 1, 4, 1, undefined]);
        const item = analyzeLine('\t- an item', 4);
        assert.deepStrictEqual([item.kind, item.indentLength, item.textStart, item.list?.kind], ['note', 1, 3, 'bullet']);
        const blank = analyzeLine('   ', 4);
        assert.deepStrictEqual([blank.kind, blank.textStart], ['blank', 3]);
    });

    test('status kinds', () => {
        assert.deepStrictEqual(['', ' ', 'x', 'X', '+', '/', '-', '>', '?'].map(statusKind),
            ['open', 'open', 'done', 'done', 'progress', 'blocked', 'removed', 'tomorrow', 'unknown']);
    });

    test('day summary counts top level tasks, looking through notes', () => {
        const summary = summarizeDay([
            '[+] Migrate reports service',
            '    [x] dump + restore staging',
            '[/] Fix flaky test',
            '[x] Review PR',
            'A heading note',
            '    [ ] task under a note',
            '[-] removed',
            '[>] tomorrow',
            '',
        ], 4);
        assert.deepStrictEqual(summary.statuses, ['progress', 'blocked', 'done', 'open', 'removed', 'tomorrow']);
        assert.strictEqual(summary.text, '1 done · 1 blocked · 4 carried');
        assert.strictEqual(summarizeDay(['just a note'], 4).text, 'Notes only');
        assert.strictEqual(summarizeDay(['', ''], 4).text, 'Empty');
    });

    test('direct sub-tasks look through notes but not into sub-tasks', () => {
        assert.deepStrictEqual(directSubtaskStatuses([
            '[ ] parent',
            '    [x] child',
            '        [ ] grandchild',
            '    a note',
            '        [-] task under the note',
            '    [/] another child',
        ], 4), ['x', '-', '/']);
        assert.deepStrictEqual(directSubtaskStatuses(['[ ] leaf', 'next'], 4), []);
    });

    test('day boundaries without a full parse match the parser', () => {
        const structure = parseStructure(README_EXAMPLE);
        const get = (i: number) => README_EXAMPLE[i];
        for (const day of structure.days) {
            for (let line = day.line; line <= day.end; line++) {
                assert.deepStrictEqual(findDayAt(get, README_EXAMPLE.length, line), { line: day.line, end: day.end });
            }
        }
        assert.strictEqual(findDayAt(get, README_EXAMPLE.length, 7), undefined);
        assert.strictEqual(findDayAt(get, README_EXAMPLE.length, 26), undefined);
        assert.deepStrictEqual(daysTouching(get, README_EXAMPLE.length, 10, 14), [{ line: 9, end: 11 }, { line: 12, end: 21 }]);
    });

    test('list items are the lines that are not indented', () => {
        assert.strictEqual(countListItems(['a', '    b', '', 'c', '\td'], 0, 4), 2);
    });
});

/** A large generated document: years of days with nested tasks and notes */
export function largeDocument(years = 3, daysPerYear = 250): string[] {
    const spec: string[] = ['#box Daily Log'];
    for (let y = 0; y < years; y++) {
        spec.push(`#box ${2024 + y}`);
        let day = 0;
        for (let month = 1; month <= 12 && day < daysPerYear; month++) {
            spec.push(`#box ${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][month - 1]}`);
            for (let d = 1; d <= 28 && day < daysPerYear; d++) {
                if (d % 7 === 0) {
                    continue;
                }
                day++;
                spec.push(`#day ${month}/${d}`,
                    '[+] Migrate reports service to Postgres 16',
                    '    [x] audit extensions + collations',
                    '    [ ] dump + restore staging',
                    '        - staging disk full, ticket INFRA-2231',
                    '    [/] prod cutover',
                    '[x] Review the billing retries PR',
                    '[/] Fix flaky checkout e2e test',
                    '    - fails about 1 in 20 runs, CI only',
                    '[ ] Write Q4 planning doc',
                    '[>] Draft onboarding guide for new hires',
                    '[-] Investigate old cron alerts (moved to SRE)',
                    'Team lunch at noon',
                    '');
            }
        }
    }
    spec.push('#box Backburner', '- try the new tracing dashboards', '[ ] read the Postgres 16 release notes');
    return sampleLines(spec);
}

suite('Webview structure: performance', () => {
    test('parsing a large document is fast', () => {
        const lines = largeDocument();
        parseStructure(lines);
        const start = process.hrtime.bigint();
        const runs = 5;
        let structure;
        for (let i = 0; i < runs; i++) {
            structure = parseStructure(lines);
        }
        const ms = Number(process.hrtime.bigint() - start) / 1e6 / runs;
        console.log(`      parseStructure: ${lines.length} lines, ${structure!.days.length} days, ${structure!.boxes.length} boxes in ${ms.toFixed(2)} ms`);
        assert.ok(ms < 200, `parse took ${ms} ms`);
    });
});
