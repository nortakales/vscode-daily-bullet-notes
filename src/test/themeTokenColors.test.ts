import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { StatusColors, StatusKey } from '../rendered/protocol';
import {
	DAY_HEADER_SCOPE, HEADER_SCOPE, onDidChangeTokenColors, resolveScopeColors, resolveStatusColors, STATUS_SCOPES,
} from '../rendered/themeTokenColors';

// Integration tests: they run inside VS Code (vscode-test), with its built-in themes.

/** The status colors of the built-in Dark Modern theme (worked out from its files in scopeMatcher.test.ts) */
const DARK_MODERN: StatusColors = {
	open: '#DCDCAA',
	done: '#569CD6',
	progress: '#569CD6',
	blocked: '#CE9178',
	removed: '#4EC9B0',
	tomorrow: '#B5CEA8',
};

const THEME_SETTING = 'workbench.colorTheme';
const CUSTOMIZATIONS_SETTING = 'editor.tokenColorCustomizations';

async function updateGlobalSetting(key: string, value: unknown): Promise<void> {
	await vscode.workspace.getConfiguration().update(key, value, vscode.ConfigurationTarget.Global);
	// Make sure the extension host sees the new value (normally already the case)
	const expected = JSON.stringify(value);
	for (let i = 0; i < 100 && JSON.stringify(vscode.workspace.getConfiguration().inspect(key)?.globalValue) !== expected; i++) {
		await new Promise(resolve => setTimeout(resolve, 20));
	}
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error(message)), milliseconds);
	});
	try {
		return await Promise.race([promise, timeout]);
	} finally {
		clearTimeout(timer);
	}
}

suite('themeTokenColors', () => {

	let savedTheme: unknown;
	let savedCustomizations: unknown;

	suiteSetup(async () => {
		const config = vscode.workspace.getConfiguration();
		savedTheme = config.inspect(THEME_SETTING)?.globalValue;
		savedCustomizations = config.inspect(CUSTOMIZATIONS_SETTING)?.globalValue;
		// Recent VS Code versions default to "Dark 2026", so select Dark Modern. "Default Dark Modern" is its id
		// before VS Code renamed it "Dark Modern"; newer versions still accept it (and so does themeTokenColors).
		await updateGlobalSetting(THEME_SETTING, 'Default Dark Modern');
		await updateGlobalSetting(CUSTOMIZATIONS_SETTING, undefined);
	});

	teardown(async () => {
		await updateGlobalSetting(CUSTOMIZATIONS_SETTING, undefined);
	});

	suiteTeardown(async () => {
		await updateGlobalSetting(THEME_SETTING, savedTheme);
		await updateGlobalSetting(CUSTOMIZATIONS_SETTING, savedCustomizations);
	});

	test('STATUS_SCOPES and the header scopes match the grammar', () => {
		const grammarFile = path.join(__dirname, '..', '..', 'syntaxes', 'daily-bullet-notes.tmLanguage.json');
		const grammar = JSON.parse(fs.readFileSync(grammarFile, 'utf8')) as { patterns: { match: string; name: string }[] };
		const scopeOf = (text: string) => grammar.patterns.find(pattern => new RegExp(pattern.match).test(text))?.name;
		const boxes: Record<StatusKey, string[]> = {
			open: ['[ ]', '[]'],
			done: ['[x]', '[X]'],
			progress: ['[+]'],
			blocked: ['[/]'],
			removed: ['[-]'],
			tomorrow: ['[>]'],
		};
		for (const [status, texts] of Object.entries(boxes) as [StatusKey, string[]][]) {
			for (const text of texts) {
				assert.strictEqual(scopeOf(text), STATUS_SCOPES[status], text);
			}
		}
		assert.strictEqual(scopeOf(`+${'-'.repeat(30)}+`), HEADER_SCOPE);
		assert.strictEqual(scopeOf('|  Title  |'), HEADER_SCOPE);
		assert.strictEqual(scopeOf(`10/04 ${'-'.repeat(30)} < Today`), DAY_HEADER_SCOPE);
	});

	test('resolves the Dark Modern status colors', async () => {
		assert.deepStrictEqual(await resolveStatusColors(), DARK_MODERN);
	});

	test('resolves any scope', async () => {
		assert.deepStrictEqual(await resolveScopeColors([HEADER_SCOPE, DAY_HEADER_SCOPE, 'no.such.scope']), {
			[HEADER_SCOPE]: '#569CD6',
			[DAY_HEADER_SCOPE]: '#DCDCAA',
			'no.such.scope': undefined,
		});
	});

	test('editor.tokenColorCustomizations textMateRules override the theme', async () => {
		await updateGlobalSetting(CUSTOMIZATIONS_SETTING, {
			textMateRules: [{ scope: 'keyword', settings: { foreground: '#ff0000' } }],
		});
		assert.deepStrictEqual(await resolveStatusColors(), { ...DARK_MODERN, done: '#FF0000' });
	});

	test('theme-specific customizations win over general ones', async () => {
		await updateGlobalSetting(CUSTOMIZATIONS_SETTING, {
			textMateRules: [{ scope: 'keyword', settings: { foreground: '#ff0000' } }],
			// Matches whether this VS Code version calls the theme "Dark Modern" or "Default Dark Modern"
			'[*Dark Modern]': { textMateRules: [{ scope: 'keyword', settings: { foreground: '#00ff00' } }] },
			'[*Light Modern]': { textMateRules: [{ scope: 'keyword', settings: { foreground: '#0000ff' } }] },
		});
		assert.strictEqual((await resolveStatusColors()).done, '#00FF00');
	});

	test('onDidChangeTokenColors fires when the customizations change', async () => {
		let listener: vscode.Disposable | undefined;
		const fired = new Promise<void>(resolve => {
			listener = onDidChangeTokenColors(resolve);
		});
		try {
			await updateGlobalSetting(CUSTOMIZATIONS_SETTING, { strings: '#123456' });
			await withTimeout(fired, 5000, 'onDidChangeTokenColors did not fire');
		} finally {
			listener?.dispose();
		}
		assert.strictEqual((await resolveStatusColors()).blocked, '#123456');
	});

	test('falls back to the default theme when the configured one is not installed', async () => {
		try {
			await updateGlobalSetting(THEME_SETTING, 'No Such Theme');
			const colors = await resolveStatusColors();
			assert.match(colors.done ?? '', /^#[0-9A-F]{6}$/);
		} finally {
			await updateGlobalSetting(THEME_SETTING, 'Default Dark Modern');
		}
	});
});
