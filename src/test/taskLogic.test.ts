import * as assert from 'assert';
import { carryOverDayContent, computeCombinedStatus, computeParentStatusUpdates, getIndentWidth } from '../taskLogic';

/** Applies the computed status updates to the given day, like the extension does */
function autoUpdate(lines: string[], tabSize = 4): string[] {
	const result = [...lines];
	for (const update of computeParentStatusUpdates(lines, tabSize)) {
		const line = result[update.lineIndex];
		result[update.lineIndex] = line.slice(0, update.boxStart) + update.newBox + line.slice(update.boxEnd);
	}
	return result;
}

suite('computeCombinedStatus', () => {

	const expectations: [string[], string][] = [
		// Unchanged behavior
		[[' ', ' '], ' '],
		[[' ', ''], ' '],
		[[' ', 'x'], '+'],
		[[' ', '+'], '+'],
		[[' ', '/'], ' '],
		[[' ', '-'], ' '],
		[['', ''], ''],
		[['', 'x'], '+'],
		[['', '+'], '+'],
		[['', '/'], ''],
		[['', '-'], ''],
		[['x', 'x'], 'x'],
		[['x', '+'], '+'],
		[['x', '/'], '+'],
		[['x', '-'], 'x'],
		[['+', '+'], '+'],
		[['+', '/'], '+'],
		[['+', '-'], '+'],
		[['/', '/'], '/'],
		[['/', '-'], '/'],
		[['-', '-'], '-'],
		[[' ', '>'], ' '],
		[['', '>'], ''],
		[['+', '>'], '+'],
		[['/', '>'], '/'],
		[['>', '>'], '>'],
		[['x', '/', '-'], '+'],
		[['x', '>', ' '], '+'],
		// A sub-task planned for tomorrow means the parent is not done or removed
		[['x', '>'], '+'],
		[['x', 'x', '>'], '+'],
		[['x', '-', '>'], '+'],
		[['-', '>'], '>'],
	];

	for (const [statuses, expected] of expectations) {
		test(`${statuses.map(s => `[${s}]`).join(' + ')} -> [${expected}]`, () => {
			assert.strictEqual(computeCombinedStatus(statuses), expected);
			assert.strictEqual(computeCombinedStatus([...statuses].reverse()), expected);
		});
	}

	test('single and empty', () => {
		assert.strictEqual(computeCombinedStatus([]), ' ');
		assert.strictEqual(computeCombinedStatus(['>']), '>');
	});
});

suite('getIndentWidth', () => {
	test('expands tabs to the next tab stop', () => {
		assert.strictEqual(getIndentWidth('\t[ ] a', 4), 4);
		assert.strictEqual(getIndentWidth('    [ ] a', 4), 4);
		assert.strictEqual(getIndentWidth('  \t[ ] a', 4), 4);
		assert.strictEqual(getIndentWidth('\t\t[ ] a', 2), 4);
		assert.strictEqual(getIndentWidth('[ ] a', 4), 0);
	});
});

suite('computeParentStatusUpdates', () => {

	test('[>] sub-task keeps a parent with a done sibling in progress', () => {
		assert.deepStrictEqual(autoUpdate([
			'[ ] Deploy service',
			'    [x] build and push',
			'    [>] announce in #eng channel',
		]), [
			'[+] Deploy service',
			'    [x] build and push',
			'    [>] announce in #eng channel',
		]);
	});

	test('[>] sub-task with a removed sibling makes the parent [>]', () => {
		assert.deepStrictEqual(autoUpdate([
			'[ ] Plan offsite',
			'    [-] book venue',
			'    [>] send agenda',
		])[0], '[>] Plan offsite');
	});

	test('tasks indented under a plain note are not sub-tasks of the task above the note', () => {
		const lines = [
			'[ ] Write report',
			'Meeting notes w/ Bob:',
			'    [x] send him the doc',
			'    [ ] schedule follow-up',
		];
		assert.deepStrictEqual(autoUpdate(lines), lines);
	});

	test('tasks under a note that is under a task are still sub-tasks of that task', () => {
		assert.deepStrictEqual(autoUpdate([
			'[ ] Project',
			'    - kickoff notes',
			'        [x] step 1',
			'        [x] step 2',
		])[0], '[x] Project');
	});

	test('a day whose first task is indented still updates', () => {
		assert.deepStrictEqual(autoUpdate([
			'Standup notes:',
			'    [ ] ask about on-call',
			'[ ] Deploy service',
			'    [x] build',
			'    [x] push',
		])[2], '[x] Deploy service');
		assert.deepStrictEqual(autoUpdate([
			'    [ ] orphaned task',
			'[ ] Deploy service',
			'    [x] build',
		])[1], '[x] Deploy service');
	});

	test('sub-tasks at an in-between indent are not ignored', () => {
		assert.deepStrictEqual(autoUpdate([
			'[ ] Parent',
			'    [x] child A',
			'        [x] grandchild',
			'  [ ] child B',
			'  [x] child C',
		])[0], '[+] Parent');
	});

	test('tab and space indented siblings are siblings', () => {
		assert.deepStrictEqual(autoUpdate([
			'[ ] Parent',
			'\t[x] child A',
			'    [ ] child B',
		]), [
			'[+] Parent',
			'\t[x] child A',
			'    [ ] child B',
		]);
	});

	test('multiple levels resolve bottom up', () => {
		assert.deepStrictEqual(autoUpdate([
			'[ ] A',
			'    [ ] B',
			'        [x] C',
			'        [x] D',
			'    [-] E',
			'',
			'[ ] F',
			'    [/] G',
		]), [
			'[x] A',
			'    [x] B',
			'        [x] C',
			'        [x] D',
			'    [-] E',
			'',
			'[/] F',
			'    [/] G',
		]);
	});

	test('only the box is replaced', () => {
		assert.deepStrictEqual(computeParentStatusUpdates([
			'  [] Parent',
			'      [x] child',
		], 4), [{ lineIndex: 0, boxStart: 2, boxEnd: 4, newBox: '[x]' }]);
	});
});

suite('carryOverDayContent', () => {

	const carry = (lines: string[]) => carryOverDayContent(lines.join('\n'), 4).split('\n');

	test('open tasks are reset and keep their notes', () => {
		assert.deepStrictEqual(carry([
			'[+] Migrate DB',
			'    - ticket 123',
			'    [/] get approval',
			'    [>] run in prod',
			'[] empty box',
		]), [
			'[ ] Migrate DB',
			'    - ticket 123',
			'    [ ] get approval',
			'    [ ] run in prod',
			'[ ] empty box',
		]);
	});

	test('notes under a finished sub-task are dropped with it', () => {
		assert.deepStrictEqual(carry([
			'[+] Migrate DB',
			'    [x] write script',
			'        - script lives in ops/migrate.sh',
			'    [-] old approach',
			'        - notes about old approach',
			'    [ ] run in prod',
		]), [
			'[ ] Migrate DB',
			'    [ ] run in prod',
		]);
	});

	test('everything under a finished task is dropped, including open sub-tasks', () => {
		assert.deepStrictEqual(carry([
			'[x] Deploy service',
			'    [x] build',
			'    [ ] announce',
			'[ ] Write report',
		]), [
			'[ ] Write report',
		]);
	});

	test('top level notes are not carried over', () => {
		assert.deepStrictEqual(carry([
			'[ ] Write report',
			'Took the afternoon off',
			'Lunch with team:',
			'    - talked about the offsite',
			'    [x] booked the table',
			'',
		]), [
			'[ ] Write report',
		]);
	});

	test('a top level note with open tasks under it comes along as their heading', () => {
		assert.deepStrictEqual(carry([
			'Meeting notes w/ Bob:',
			'    - he wants the doc by Friday',
			'    [x] send him the doc',
			'    [+] schedule follow-up',
			'[ ] Write report',
		]), [
			'Meeting notes w/ Bob:',
			'    - he wants the doc by Friday',
			'    [ ] schedule follow-up',
			'[ ] Write report',
		]);
	});

	test('blank lines are dropped but do not break up a task', () => {
		assert.deepStrictEqual(carry([
			'[ ] Write report',
			'',
			'    - note after a blank line',
			'',
			'',
		]), [
			'[ ] Write report',
			'    - note after a blank line',
		]);
	});
});
