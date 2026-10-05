import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import {
	customizationRules, loadThemeTokenRules, normalizeColor, parseJsonc, parseTmTheme, resolveForeground,
	TextMateThemeRule, ThemeFileReader, TokenColorMatcher,
} from '../rendered/scopeMatcher';
import { DAY_HEADER_SCOPE, genericScope, HEADER_SCOPE, STATUS_SCOPES } from '../rendered/grammarScopes';

// The expected colors in this file were checked against the text editor's own engine (vscode-textmate 9.3.2 from
// VS Code 1.140, tokenizing with the real grammar), in addition to being worked out from the theme files.

const ROOT = 'source.daily-bullet-notes';

/** VS Code's built-in theme files (extensions/theme-defaults/themes), with their include chains */
const FIXTURES = path.join(__dirname, '..', '..', 'src', 'test', 'fixtures', 'themes');

function rule(scope: string | string[], foreground?: string, fontStyle?: string): TextMateThemeRule {
	return { scope, settings: { foreground, fontStyle } };
}

/** The color of a token with the given scopes below the root scope */
function fg(rules: TextMateThemeRule[], ...scopes: string[]): string | undefined {
	return resolveForeground(rules, [ROOT, ...scopes]);
}

const fileReader: ThemeFileReader<string> = {
	read: file => fs.promises.readFile(file, 'utf8'),
	resolve: (base, relativePath) => path.join(path.dirname(base), relativePath),
	isJson: file => file.endsWith('.json'),
};

function memoryReader(files: Record<string, string>): ThemeFileReader<string> {
	return {
		read: async file => {
			if (!(file in files)) {
				throw new Error(`No such file: ${file}`);
			}
			return files[file];
		},
		resolve: (base, relativePath) => path.posix.join(path.posix.dirname(base), relativePath),
		isJson: file => file.endsWith('.json'),
	};
}

type StatusColorMap = Record<keyof typeof STATUS_SCOPES, string | undefined>;

function statusColors(matcher: TokenColorMatcher): StatusColorMap {
	const result = {} as StatusColorMap;
	for (const [status, scope] of Object.entries(STATUS_SCOPES) as [keyof typeof STATUS_SCOPES, string][]) {
		result[status] = matcher.foreground([ROOT, scope]);
	}
	return result;
}

async function loadFixture(file: string, customizations?: unknown, settingsId = ''): Promise<TokenColorMatcher> {
	const rules = await loadThemeTokenRules(path.join(FIXTURES, file), fileReader);
	return new TokenColorMatcher([...rules, ...customizationRules(customizations, settingsId)]);
}

suite('normalizeColor', () => {

	test('expands and upper-cases hex colors', () => {
		assert.strictEqual(normalizeColor('#abc'), '#AABBCC');
		assert.strictEqual(normalizeColor('#abc8'), '#AABBCC88');
		assert.strictEqual(normalizeColor('#a1b2c3'), '#A1B2C3');
		assert.strictEqual(normalizeColor('#a1b2c380'), '#A1B2C380');
	});

	test('drops an opaque alpha', () => {
		assert.strictEqual(normalizeColor('#a1b2c3ff'), '#A1B2C3');
		assert.strictEqual(normalizeColor('#abcf'), '#AABBCC');
	});

	test('rejects anything else', () => {
		for (const color of ['red', '#ab', '#abcde', '#abcdef1', '#ggg', ' #abc', 'abc', '', 42, undefined, null, {}]) {
			assert.strictEqual(normalizeColor(color), undefined, String(color));
		}
	});
});

suite('TokenColorMatcher', () => {

	test('matches a scope and its more specific scopes, at dot boundaries only', () => {
		const rules = [rule('keyword', '#111111')];
		assert.strictEqual(fg(rules, 'keyword'), '#111111');
		assert.strictEqual(fg(rules, 'keyword.control.flow'), '#111111');
		assert.strictEqual(fg(rules, 'keywords'), undefined);
		assert.strictEqual(fg(rules, 'string'), undefined);
		assert.strictEqual(fg([rule('key', '#111111')], 'keyword'), undefined);
		assert.strictEqual(fg([rule('keyword.control', '#111111')], 'keyword'), undefined);
		assert.strictEqual(fg([rule('KEYWORD', '#111111')], 'keyword'), undefined);
	});

	test('a selector with more segments wins, whatever the order', () => {
		for (const rules of [
			[rule('keyword', '#111111'), rule('keyword.control', '#222222')],
			[rule('keyword.control', '#222222'), rule('keyword', '#111111')],
		]) {
			assert.strictEqual(fg(rules, 'keyword.control'), '#222222');
			assert.strictEqual(fg(rules, 'keyword.control.flow'), '#222222');
			assert.strictEqual(fg(rules, 'keyword'), '#111111');
			assert.strictEqual(fg(rules, 'keyword.operator'), '#111111');
		}
	});

	test('later rules win ties', () => {
		assert.strictEqual(fg([rule('keyword', '#111111'), rule('keyword', '#222222')], 'keyword'), '#222222');
		assert.strictEqual(fg([rule('keyword, string', '#111111'), rule(['string'], '#222222')], 'keyword'), '#111111');
		assert.strictEqual(fg([rule('keyword, string', '#111111'), rule(['string'], '#222222')], 'string'), '#222222');
	});

	test('comma-separated selectors and arrays', () => {
		const rules = [rule('string,  keyword.control ,constant', '#111111'), rule([' entity.name ', 'support'], '#222222'), rule(',,comment,', '#333333')];
		assert.strictEqual(fg(rules, 'string'), '#111111');
		assert.strictEqual(fg(rules, 'keyword.control'), '#111111');
		assert.strictEqual(fg(rules, 'constant.numeric'), '#111111');
		assert.strictEqual(fg(rules, 'entity.name.class'), '#222222');
		assert.strictEqual(fg(rules, 'support.function'), '#222222');
		assert.strictEqual(fg(rules, 'comment'), '#333333');
		assert.strictEqual(fg(rules, 'keyword'), undefined);
	});

	test('descendant selectors need their ancestors, in order', () => {
		assert.strictEqual(fg([rule('source.daily-bullet-notes keyword', '#111111')], 'keyword'), '#111111');
		assert.strictEqual(fg([rule('source keyword', '#111111')], 'keyword'), '#111111', 'ancestors match by prefix too');
		assert.strictEqual(fg([rule('source.other keyword', '#111111')], 'keyword'), undefined);
		assert.strictEqual(fg([rule('meta.block keyword', '#111111')], 'keyword'), undefined);
		assert.strictEqual(fg([rule('meta.block keyword', '#111111')], 'meta.block.x', 'meta', 'keyword'), '#111111');
		assert.strictEqual(fg([rule('source.daily-bullet-notes meta.block keyword', '#111111')], 'meta.block', 'keyword'), '#111111');
		assert.strictEqual(fg([rule('meta.block source.daily-bullet-notes keyword', '#111111')], 'meta.block', 'keyword'), undefined);
	});

	test('descendant selectors are more specific than plain ones', () => {
		const rules = [rule('source.daily-bullet-notes keyword', '#111111'), rule('keyword', '#222222'), rule('source.other keyword', '#333333')];
		assert.strictEqual(fg(rules, 'keyword'), '#111111');
	});

	test('between descendant selectors, the longer innermost ancestor wins, then the most ancestors', () => {
		// vscode-textmate compares the ancestors' lengths innermost first, before the number of ancestors
		const rules = [
			rule('source keyword', '#111111'),
			rule('source.daily-bullet-notes keyword', '#222222'),
			rule('meta.block keyword', '#333333'),
			rule('source.daily-bullet-notes meta.block keyword', '#444444'),
		];
		assert.strictEqual(fg(rules, 'keyword'), '#222222');
		assert.strictEqual(fg(rules, 'meta.block', 'keyword'), '#222222');
		assert.strictEqual(fg(rules.slice(2), 'meta.block', 'keyword'), '#444444');
	});

	test('more segments in the scope beat descendant selectors', () => {
		const rules = [rule('keyword.control.flow', '#111111'), rule('source.daily-bullet-notes keyword', '#222222')];
		assert.strictEqual(fg(rules, 'keyword.control.flow'), '#111111');
		assert.strictEqual(fg(rules, 'keyword.control'), '#222222');
	});

	test('child combinator', () => {
		const rules = [rule('source.daily-bullet-notes > keyword', '#111111')];
		assert.strictEqual(fg(rules, 'keyword'), '#111111');
		assert.strictEqual(fg(rules, 'meta.block', 'keyword'), undefined);
	});

	test('exclusions never match, like in the text editor', () => {
		// vscode-textmate takes the '-' as an ancestor scope, which never exists
		assert.strictEqual(fg([rule('keyword - keyword.operator', '#111111')], 'keyword'), undefined);
		assert.strictEqual(fg([rule('keyword - keyword.operator', '#111111')], 'keyword.control'), undefined);
		assert.strictEqual(fg([rule('keyword', '#222222'), rule('keyword - keyword.operator', '#111111')], 'keyword'), '#222222');
		assert.strictEqual(fg([rule('keyword - keyword.operator, string', '#111111')], 'string'), '#111111', 'other selectors of the rule still apply');
	});

	test('the foreground is inherited from the enclosing scopes', () => {
		assert.strictEqual(fg([rule('source', '#111111')], 'keyword'), '#111111');
		assert.strictEqual(fg([rule('source.daily-bullet-notes', '#111111'), rule('keyword', '#222222')], 'keyword'), '#222222');
		assert.strictEqual(fg([rule('source', '#111111'), rule('keyword', undefined, 'italic')], 'keyword'), '#111111');
		assert.strictEqual(fg([rule('meta.block', '#111111'), rule('string', '#222222')], 'meta.block', 'keyword'), '#111111');
		assert.strictEqual(fg([rule('meta.block', '#111111'), rule('string', '#222222')], 'meta.block', 'string'), '#222222');
	});

	test('rules without a (valid) foreground inherit it from less specific rules', () => {
		assert.strictEqual(fg([rule('keyword', '#111111'), rule('keyword.control', undefined, 'italic')], 'keyword.control'), '#111111');
		assert.strictEqual(fg([rule('keyword', '#111111'), rule('keyword.control', 'red')], 'keyword.control'), '#111111');
		assert.strictEqual(fg([rule('keyword', '#111111'), rule('keyword.control', '#12345')], 'keyword.control'), '#111111');
	});

	test('a more specific rule without a foreground hides less specific descendant selectors', () => {
		// A vscode-textmate quirk: the most specific matching rule wins, and it only inherits from rules without ancestors
		const rules = [rule('source.daily-bullet-notes keyword', '#111111'), rule('keyword.control', undefined, 'italic')];
		assert.strictEqual(fg(rules, 'keyword'), '#111111');
		assert.strictEqual(fg(rules, 'keyword.control'), undefined);
	});

	test('rules without a scope or settings are ignored (they only set the default foreground)', () => {
		const rules: TextMateThemeRule[] = [
			{ settings: { foreground: '#111111' } },
			rule('', '#111111'),
			rule(['', ' '], '#111111'),
			rule('keyword,,string', '#222222'),
			{ scope: 'constant' } as unknown as TextMateThemeRule,
			null as unknown as TextMateThemeRule,
		];
		assert.strictEqual(fg(rules, 'comment'), undefined);
		assert.strictEqual(fg(rules, 'constant'), undefined);
		assert.strictEqual(fg(rules, 'keyword'), '#222222');
		assert.strictEqual(fg([], 'keyword'), undefined);
	});

	test('colors are normalized', () => {
		assert.strictEqual(fg([rule('keyword', '#f00')], 'keyword'), '#FF0000');
		assert.strictEqual(fg([rule('keyword', '#ff000080')], 'keyword'), '#FF000080');
		assert.strictEqual(fg([rule('keyword', 'red')], 'keyword'), undefined);
	});

	test('scope stack entries containing spaces are nested scopes', () => {
		const rules = [rule('meta.block keyword', '#111111')];
		assert.strictEqual(resolveForeground(rules, [ROOT, 'meta.block keyword']), '#111111');
		assert.strictEqual(resolveForeground(rules, [`${ROOT} meta.block`, 'keyword']), '#111111');
	});

	test('a matcher resolves any number of scope stacks', () => {
		const matcher = new TokenColorMatcher([rule('keyword', '#111111'), rule('string', '#222222')]);
		assert.strictEqual(matcher.foreground([ROOT, 'keyword']), '#111111');
		assert.strictEqual(matcher.foreground([ROOT, 'string']), '#222222');
		assert.strictEqual(matcher.foreground([ROOT, 'keyword']), '#111111');
		assert.strictEqual(matcher.foreground([]), undefined);
	});
});

suite('customizationRules', () => {

	test('nothing to add', () => {
		assert.deepStrictEqual(customizationRules(undefined, 'Dark Modern'), []);
		assert.deepStrictEqual(customizationRules(null, 'Dark Modern'), []);
		assert.deepStrictEqual(customizationRules('#ff0000', 'Dark Modern'), []);
		assert.deepStrictEqual(customizationRules({}, 'Dark Modern'), []);
	});

	test('shorthands use the scopes VS Code maps them to, before textMateRules', () => {
		const rules = customizationRules({
			textMateRules: [{ scope: 'keyword', settings: { foreground: '#111111' } }, { scope: 'string' }, { settings: { foreground: '#222222' } }],
			functions: '#333333',
			strings: { foreground: '#444444', fontStyle: 'italic' },
			numbers: '',
		}, 'Dark Modern');
		assert.deepStrictEqual(rules, [
			{ scope: 'string', settings: { foreground: '#444444', fontStyle: 'italic' } },
			{ scope: 'meta.embedded.assembly', settings: { foreground: '#444444', fontStyle: 'italic' } },
			{ scope: 'entity.name.function', settings: { foreground: '#333333' } },
			{ scope: 'support.function', settings: { foreground: '#333333' } },
			{ scope: 'keyword', settings: { foreground: '#111111' } },
		]);
	});

	test('the keywords shorthand does not color the keyword scope, like in the text editor', () => {
		// VS Code maps it to 'keyword - keyword.operator', which the editor never applies (see the exclusions test)
		const rules = customizationRules({ keywords: '#111111' }, 'Dark Modern');
		assert.strictEqual(fg(rules, 'keyword'), undefined);
		assert.strictEqual(fg(rules, 'keyword.control'), '#111111');
		assert.strictEqual(fg(rules, 'storage.type'), '#111111');
	});

	test('theme-specific blocks come after the general settings, for matching themes only', () => {
		const customizations = {
			'[Light Modern]': { textMateRules: [rule('keyword', '#333333')] },
			'[Dark Modern]': { textMateRules: [rule('keyword', '#222222')], strings: '#444444' },
			textMateRules: [rule('keyword', '#111111')],
			strings: '#555555',
		};
		const rules = customizationRules(customizations, 'Dark Modern');
		assert.deepStrictEqual(rules.map(r => r.settings.foreground), ['#555555', '#555555', '#111111', '#444444', '#444444', '#222222']);
		assert.strictEqual(fg(rules, 'keyword'), '#222222');
		assert.strictEqual(fg(customizationRules(customizations, 'Monokai'), 'keyword'), '#111111');
	});

	test('theme names with wildcards, and several themes per block', () => {
		const settingsId = 'Default Dark Modern';
		const keywordColor = (key: string) => fg(customizationRules({ [key]: { textMateRules: [rule('keyword', '#111111')] } }, settingsId), 'keyword');
		for (const key of ['[Default Dark Modern]', '[*Dark*]', '[Default*]', '[*Modern]', '[Light+][Default Dark Modern]']) {
			assert.strictEqual(keywordColor(key), '#111111', key);
		}
		for (const key of ['[Dark Modern]', '[*Light*]', '[Dark*]', '[*Dark]', '[Light+]', 'Default Dark Modern', '[default dark modern]']) {
			assert.strictEqual(keywordColor(key), undefined, key);
		}
	});

	test('rules of several matching blocks are combined', () => {
		const rules = customizationRules({
			'[*Dark*]': { textMateRules: [rule('keyword', '#111111')], functions: '#222222' },
			'[*Modern]': { textMateRules: [rule('string', '#333333')], functions: '#444444' },
		}, 'Dark Modern');
		assert.strictEqual(fg(rules, 'keyword'), '#111111');
		assert.strictEqual(fg(rules, 'string'), '#333333');
		assert.strictEqual(fg(rules, 'support.function'), '#444444');
	});
});

suite('parseJsonc', () => {

	test('comments and trailing commas', () => {
		const text = '﻿{\n\t// line comment\n\t"a": [1, 2, /* block */ 3,],\n\t/* multi\n\tline */ "b": { "c": true, },\n}\n// end';
		assert.deepStrictEqual(parseJsonc(text), { a: [1, 2, 3], b: { c: true } });
	});

	test('strings are kept as they are', () => {
		const text = '{ "url": "http://example.com/*x*/", "s": "a,]b,}", "q": "say \\"hi\\" // not a comment", }';
		assert.deepStrictEqual(parseJsonc(text), { url: 'http://example.com/*x*/', s: 'a,]b,}', q: 'say "hi" // not a comment' });
	});

	test('other errors throw', () => {
		assert.throws(() => parseJsonc('{ "a": }'));
		assert.throws(() => parseJsonc('{ "a": 1'));
		assert.throws(() => parseJsonc('{ a: 1 }'));
	});
});

const SAMPLE_TM_THEME = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>name</key>
	<string>Sample &amp; Test</string>
	<key>settings</key>
	<array>
		<dict>
			<key>settings</key>
			<dict>
				<key>background</key>
				<string>#272822</string>
				<key>foreground</key>
				<string>#F8F8F2</string>
			</dict>
		</dict>
		<!-- <dict><key>scope</key><string>commented.out</string></dict> -->
		<dict>
			<key>name</key>
			<string>Keyword &lt;3</string>
			<key>scope</key>
			<string>keyword, storage</string>
			<key>settings</key>
			<dict>
				<key>foreground</key>
				<string>#F92672</string>
			</dict>
		</dict>
		<dict>
			<key>scope</key>
			<string>source string - string.quoted</string>
			<key>settings</key>
			<dict>
				<key>fontStyle</key>
				<string></string>
				<key>foreground</key>
				<string>#E6DB74</string>
			</dict>
		</dict>
		<dict>
			<key>scope</key>
			<string>constant.numeric</string>
			<key>settings</key>
			<dict>
				<key>foreground</key>
				<string>#AE81FF</string>
			</dict>
		</dict>
	</array>
	<key>uuid</key>
	<string>D8D5E82E-3D5B-46B5-B38E-8C841C21347D</string>
	<key>semanticClass</key><true/>
	<key>version</key><integer>2</integer>
</dict>
</plist>
`;

suite('parseTmTheme', () => {

	test('reads the settings array', () => {
		const rules = parseTmTheme(SAMPLE_TM_THEME);
		assert.strictEqual(rules.length, 4);
		assert.deepStrictEqual(rules[0], { settings: { background: '#272822', foreground: '#F8F8F2' } });
		assert.deepStrictEqual(rules[1], { name: 'Keyword <3', scope: 'keyword, storage', settings: { foreground: '#F92672' } });
		assert.deepStrictEqual(rules[2], { scope: 'source string - string.quoted', settings: { fontStyle: '', foreground: '#E6DB74' } });
		const matcher = new TokenColorMatcher(rules);
		assert.strictEqual(matcher.foreground([ROOT, 'keyword']), '#F92672');
		assert.strictEqual(matcher.foreground([ROOT, 'string']), undefined);
		assert.strictEqual(matcher.foreground([ROOT, 'constant.numeric']), '#AE81FF');
	});

	test('anything else gives no rules', () => {
		assert.deepStrictEqual(parseTmTheme(''), []);
		assert.deepStrictEqual(parseTmTheme('not a plist'), []);
		assert.deepStrictEqual(parseTmTheme('{ "settings": [] }'), []);
		assert.deepStrictEqual(parseTmTheme('<plist><dict><key>settings</key><array><dict>'), []);
		assert.deepStrictEqual(parseTmTheme('<plist><dict><key>name</key><string>x</string></dict></plist>'), []);
	});
});

suite('loadThemeTokenRules', () => {

	test('follows includes: included rules first', async () => {
		const rules = await loadThemeTokenRules(path.join(FIXTURES, 'dark_modern.json'), fileReader);
		const fixtureRules = (file: string) => (parseJsonc(fs.readFileSync(path.join(FIXTURES, file), 'utf8')) as { tokenColors: unknown[] }).tokenColors;
		// dark_modern.json has no tokenColors of its own; it includes dark_plus.json, which includes dark_vs.json
		assert.deepStrictEqual(rules, [...fixtureRules('dark_vs.json'), ...fixtureRules('dark_plus.json')]);
	});

	test('includes and tokenColors files are relative to the including file', async () => {
		const reader = memoryReader({
			'/ext/themes/main.json': '{ "include": "../base/base.json", "tokenColors": "./colors/tokens.tmTheme" }',
			'/ext/base/base.json': '{ "include": "./base2.json", "tokenColors": [{ "scope": "base", "settings": {} }] }',
			'/ext/base/base2.json': '{ "tokenColors": "tokens.json" }',
			'/ext/base/tokens.json': '[{ "scope": "base2", "settings": {} }, 42]',
			'/ext/themes/colors/tokens.tmTheme': SAMPLE_TM_THEME,
		});
		const rules = await loadThemeTokenRules('/ext/themes/main.json', reader);
		assert.deepStrictEqual(rules.map(r => r.scope), ['base2', 'base', undefined, 'keyword, storage', 'source string - string.quoted', 'constant.numeric']);
	});

	test('a tmTheme-style settings array replaces tokenColors', async () => {
		const reader = memoryReader({
			'/t/theme.json': '{ "settings": [{ "settings": { "foreground": "#FFFFFF" } }, { "scope": "keyword", "settings": { "foreground": "#111111" } }], "tokenColors": [{ "scope": "string", "settings": {} }] }',
		});
		const rules = await loadThemeTokenRules('/t/theme.json', reader);
		assert.deepStrictEqual(rules.map(r => r.scope), [undefined, 'keyword']);
	});

	test('a .tmTheme theme file', async () => {
		const rules = await loadThemeTokenRules('/t/Sample.tmTheme', memoryReader({ '/t/Sample.tmTheme': SAMPLE_TM_THEME }));
		assert.strictEqual(rules.length, 4);
	});

	test('broken themes reject', async () => {
		const reader = memoryReader({
			'/t/cycle.json': '{ "include": "./cycle.json" }',
			'/t/invalid.json': '{ "tokenColors": [ }',
			'/t/notAnObject.json': '"theme"',
			'/t/missingInclude.json': '{ "include": "./nothing.json", "tokenColors": [] }',
		});
		for (const file of ['/t/cycle.json', '/t/invalid.json', '/t/notAnObject.json', '/t/missingInclude.json', '/t/nothing.json']) {
			await assert.rejects(loadThemeTokenRules(file, reader), file);
		}
	});
});

suite('Built-in theme colors', () => {

	// Status colors, worked out from the fixture files. In all of these themes progress ('constant.character')
	// has the same color as done ('keyword'): Dark+ / Light+ / High Contrast give 'constant.character' the keyword color.

	test('Dark Modern', async () => {
		// dark_modern.json only has workbench colors: the token colors come from dark_plus.json (support.function,
		// entity.name.class, constant.character) and dark_vs.json (keyword, string, constant.numeric)
		const matcher = await loadFixture('dark_modern.json');
		assert.deepStrictEqual(statusColors(matcher), {
			open: '#DCDCAA',
			done: '#569CD6',
			progress: '#569CD6',
			blocked: '#CE9178',
			removed: '#4EC9B0',
			tomorrow: '#B5CEA8',
		});
		assert.strictEqual(matcher.foreground([ROOT, 'entity.name.function']), '#DCDCAA');
		assert.strictEqual(matcher.foreground([ROOT, 'constant.character']), '#569CD6');
	});

	test('Dark+ (same as Dark Modern)', async () => {
		assert.deepStrictEqual(statusColors(await loadFixture('dark_plus.json')), statusColors(await loadFixture('dark_modern.json')));
	});

	test('Light Modern', async () => {
		// Like Dark Modern: from light_plus.json and light_vs.json
		assert.deepStrictEqual(statusColors(await loadFixture('light_modern.json')), {
			open: '#795E26',
			done: '#0000FF',
			progress: '#0000FF',
			blocked: '#A31515',
			removed: '#267F99',
			tomorrow: '#098658',
		});
	});

	test('Light+ (same as Light Modern)', async () => {
		assert.deepStrictEqual(statusColors(await loadFixture('light_plus.json')), statusColors(await loadFixture('light_modern.json')));
	});

	test('Dark High Contrast', async () => {
		// Surprising but true: hc_black.json gives these scopes exactly the Dark+ colors
		const matcher = await loadFixture('hc_black.json');
		assert.deepStrictEqual(statusColors(matcher), statusColors(await loadFixture('dark_modern.json')));
		assert.deepStrictEqual(statusColors(matcher), {
			open: '#DCDCAA',
			done: '#569CD6',
			progress: '#569CD6',
			blocked: '#CE9178',
			removed: '#4EC9B0',
			tomorrow: '#B5CEA8',
		});
	});

	test('Light High Contrast', async () => {
		// hc_light.json uses #0F4A85 for 'keyword', 'string' and 'constant.character': done, progress and blocked look the same
		assert.deepStrictEqual(statusColors(await loadFixture('hc_light.json')), {
			open: '#5E2CBC',
			done: '#0F4A85',
			progress: '#0F4A85',
			blocked: '#0F4A85',
			removed: '#185E73',
			tomorrow: '#096D48',
		});
	});

	test('Visual Studio Dark / Light have no color for some statuses', async () => {
		// No rule matches support.function, constant.character or entity.name.class: the editor foreground applies
		assert.deepStrictEqual(statusColors(await loadFixture('dark_vs.json')), {
			open: undefined,
			done: '#569CD6',
			progress: undefined,
			blocked: '#CE9178',
			removed: undefined,
			tomorrow: '#B5CEA8',
		});
		assert.deepStrictEqual(statusColors(await loadFixture('light_vs.json')), {
			open: undefined,
			done: '#0000FF',
			progress: undefined,
			blocked: '#A31515',
			removed: undefined,
			tomorrow: '#098658',
		});
	});

	test('Dark 2026 / Light 2026 (the default themes of recent VS Code versions)', async () => {
		// They include Dark/Light Modern and add their own rules. Their broader 'support', 'entity.name' and
		// 'constant' rules lose to the more specific Dark+/Light+ rules, so open, removed and tomorrow don't change.
		const dark = await loadFixture('2026-dark.json');
		assert.deepStrictEqual(statusColors(dark), {
			open: '#DCDCAA',
			done: '#FF7B72',
			progress: '#FF7B72',
			blocked: '#A5D6FF',
			removed: '#4EC9B0',
			tomorrow: '#B5CEA8',
		});
		assert.strictEqual(dark.foreground([ROOT, 'entity.name.function']), '#D2A8FF');
		assert.deepStrictEqual(statusColors(await loadFixture('2026-light.json')), {
			open: '#795E26',
			done: '#CF222E',
			progress: '#CF222E',
			blocked: '#0A3069',
			removed: '#267F99',
			tomorrow: '#098658',
		});
	});

	test('customizations override the theme', async () => {
		const done = async (customizations: unknown, settingsId = 'Dark Modern') =>
			statusColors(await loadFixture('dark_modern.json', customizations, settingsId)).done;
		assert.strictEqual(await done({ textMateRules: [rule('keyword', '#ff0000')] }), '#FF0000');
		assert.strictEqual(await done({ '[Dark Modern]': { textMateRules: [rule('keyword', '#00ff00')] }, textMateRules: [rule('keyword', '#ff0000')] }), '#00FF00');
		assert.strictEqual(await done({ '[Dark Modern]': { textMateRules: [rule('keyword', '#00ff00')] } }, 'Default Dark Modern'), '#569CD6');
		assert.strictEqual(await done({ keywords: '#ff0000' }), '#569CD6', 'the keywords shorthand does not apply to keyword');
		const colors = statusColors(await loadFixture('dark_modern.json', { functions: '#123', strings: { foreground: '#456' } }, 'Dark Modern'));
		assert.strictEqual(colors.open, '#112233');
		assert.strictEqual(colors.blocked, '#445566');
		assert.strictEqual(colors.removed, '#4EC9B0');
	});

	test('a theme with descendant selectors and exclusions', async () => {
		const reader = memoryReader({
			'/t/base.json': '{ "tokenColors": [{ "scope": "keyword", "settings": { "foreground": "#111111" } }] }',
			'/t/theme.json': `{
				"include": "./base.json",
				"tokenColors": [
					{ "scope": "source.daily-bullet-notes keyword", "settings": { "foreground": "#222222" } },
					{ "scope": "source.other keyword", "settings": { "foreground": "#333333" } },
					{ "scope": "keyword - keyword.operator", "settings": { "foreground": "#444444" } },
					{ "scope": "string - string.quoted", "settings": { "foreground": "#555555" } },
					{ "scope": "text.html constant.numeric, source constant.numeric", "settings": { "foreground": "#666666" } },
					{ "scope": "constant", "settings": { "foreground": "#777777" } },
					{ "scope": "source.daily-bullet-notes > entity.name", "settings": { "foreground": "#888888" } },
					{ "scope": "meta.embedded support.function", "settings": { "foreground": "#999999" } },
				],
			}`,
		});
		const matcher = new TokenColorMatcher(await loadThemeTokenRules('/t/theme.json', reader));
		assert.deepStrictEqual(statusColors(matcher), {
			// No meta.embedded ancestor
			open: undefined,
			// The descendant selector beats the plain one; the later exclusion selector never applies
			done: '#222222',
			// From 'constant'
			progress: '#777777',
			// Only an exclusion selector
			blocked: undefined,
			// 'source.daily-bullet-notes > entity.name': the root scope is the direct parent
			removed: '#888888',
			// 'source constant.numeric' (an ancestor prefix) beats 'constant'
			tomorrow: '#666666',
		});
	});
});

suite('Grammar scopes', () => {

	test('every built-in theme colors the specific scopes exactly like the generic scopes they extend', async () => {
		const scopes = [...Object.values(STATUS_SCOPES), HEADER_SCOPE, DAY_HEADER_SCOPE];
		const files = fs.readdirSync(FIXTURES).filter(file => file.endsWith('.json'));
		assert.ok(files.length >= 10);
		for (const file of files) {
			const matcher = await loadFixture(file);
			for (const scope of scopes) {
				assert.strictEqual(matcher.foreground([ROOT, scope]), matcher.foreground([ROOT, genericScope(scope)]), `${file}: ${scope}`);
			}
		}
	});

	test('each status scope can be colored on its own', () => {
		const rules = [rule('keyword', '#111111'), rule(STATUS_SCOPES.done, '#222222'), rule('constant.character', '#333333')];
		assert.strictEqual(fg(rules, STATUS_SCOPES.done), '#222222');
		assert.strictEqual(fg(rules, 'keyword'), '#111111');
		assert.strictEqual(fg(rules, STATUS_SCOPES.progress), '#333333');
		assert.strictEqual(fg(rules, HEADER_SCOPE), '#333333');
	});
});
