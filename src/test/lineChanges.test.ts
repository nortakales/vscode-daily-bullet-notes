import * as assert from 'assert';
import { applyLineChanges, toLf } from '../rendered/lineChanges';

suite('lineChanges', () => {

	const text = ['10/4 ----', '[ ] Deploy', '    [ ] build', ''].join('\n');

	test('toLf converts CRLF only', () => {
		assert.strictEqual(toLf('a\r\nb\nc\r\n'), 'a\nb\nc\n');
	});

	test('applies a single replacement', () => {
		assert.strictEqual(
			applyLineChanges(text, [{ fromLine: 2, fromCharacter: 5, toLine: 2, toCharacter: 6, text: 'x' }]),
			['10/4 ----', '[ ] Deploy', '    [x] build', ''].join('\n'));
	});

	test('applies several changes in original coordinates', () => {
		assert.strictEqual(
			applyLineChanges(text, [
				{ fromLine: 1, fromCharacter: 1, toLine: 1, toCharacter: 2, text: 'x' },
				{ fromLine: 2, fromCharacter: 5, toLine: 2, toCharacter: 6, text: 'x' },
			]),
			['10/4 ----', '[x] Deploy', '    [x] build', ''].join('\n'));
	});

	test('inserts and deletes across lines', () => {
		assert.strictEqual(
			applyLineChanges(text, [{ fromLine: 1, fromCharacter: 10, toLine: 1, toCharacter: 10, text: '\n    [ ] push' }]),
			['10/4 ----', '[ ] Deploy', '    [ ] push', '    [ ] build', ''].join('\n'));
		assert.strictEqual(
			applyLineChanges(text, [{ fromLine: 1, fromCharacter: 10, toLine: 2, toCharacter: 13, text: '' }]),
			['10/4 ----', '[ ] Deploy', ''].join('\n'));
		assert.strictEqual(
			applyLineChanges(text, [{ fromLine: 3, fromCharacter: 0, toLine: 3, toCharacter: 0, text: 'end' }]),
			['10/4 ----', '[ ] Deploy', '    [ ] build', 'end'].join('\n'));
	});

	test('rejects positions that do not exist', () => {
		assert.strictEqual(applyLineChanges(text, [{ fromLine: 9, fromCharacter: 0, toLine: 9, toCharacter: 0, text: 'a' }]), undefined);
		assert.strictEqual(applyLineChanges(text, [{ fromLine: 1, fromCharacter: 11, toLine: 1, toCharacter: 11, text: 'a' }]), undefined);
		assert.strictEqual(applyLineChanges(text, [{ fromLine: 2, fromCharacter: 4, toLine: 1, toCharacter: 0, text: '' }]), undefined);
		assert.strictEqual(applyLineChanges(text, [
			{ fromLine: 2, fromCharacter: 0, toLine: 2, toCharacter: 4, text: '' },
			{ fromLine: 1, fromCharacter: 0, toLine: 1, toCharacter: 1, text: '' },
		]), undefined);
	});
});
