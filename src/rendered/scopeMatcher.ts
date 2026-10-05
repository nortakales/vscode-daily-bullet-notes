// Works out which foreground color a TextMate color theme gives a token, exactly like VS Code's text editor.
// Pure (no vscode import) so it can be unit tested; themeTokenColors.ts feeds it the active theme.
//
// How VS Code colors a TextMate token:
// - colorThemeData.ts builds the rule list: the theme's rules (included files first), then the
//   editor.tokenColorCustomizations rules. Rules without a scope are dropped (the editor foreground is the default).
// - vscode-textmate's Theme (theme.ts) resolves every scope of the token's scope stack, outermost first. A scope
//   that resolves to a foreground overrides the one inherited from the enclosing scopes.
// TokenColorMatcher is a port of vscode-textmate's theme.ts (v9.3, the version in VS Code 1.140), foreground only.
// Notable consequences of that algorithm, which differ from TextMate's own scope selectors:
// - A selector is split on spaces: the last segment is the scope, the others are ancestors (and '>' a child
//   combinator). Exclusions are not supported: in "keyword - keyword.operator" the '-' is taken as an ancestor
//   scope that never exists, so the selector never matches anything (the text editor ignores it too).
// - Specificity is decided by the number of dot segments of the matched scope first, then by the ancestors.
//   The most specific matching rule wins even if it has no foreground; it inherits the foreground of less
//   specific rules without ancestors, but not of less specific rules with ancestors.

/** A TextMate theme rule, as found in a theme's tokenColors or in editor.tokenColorCustomizations.textMateRules */
export interface TextMateThemeRule {
    readonly name?: string;
    /** Comma-separated selectors, or an array of selectors */
    readonly scope?: string | readonly string[];
    readonly settings: TextMateThemeRuleSettings;
}

export interface TextMateThemeRuleSettings {
    readonly foreground?: string;
    readonly [setting: string]: unknown;
}

// ---------------------------------------------------------------------------------------------------------------
// Colors

/**
 * Normalizes a theme color like VS Code does before using it for tokens: '#RGB', '#RGBA', '#RRGGBB' and
 * '#RRGGBBAA' become upper case '#RRGGBB' (or '#RRGGBBAA' if not opaque), valid as a CSS color.
 * Anything else (including color names, which themes cannot use for tokens) gives undefined.
 */
export function normalizeColor(color: unknown): string | undefined {
    if (typeof color !== 'string' || !/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color)) {
        return undefined;
    }
    let hex = color.slice(1).toUpperCase();
    if (hex.length <= 4) {
        hex = [...hex].map(digit => digit + digit).join('');
    }
    if (hex.length === 8 && hex.endsWith('FF')) {
        hex = hex.slice(0, 6);
    }
    return '#' + hex;
}

// ---------------------------------------------------------------------------------------------------------------
// Matching (port of vscode-textmate's theme.ts)

interface ParsedRule {
    readonly scope: string;
    /** Ancestor selectors, innermost first (null: no ancestors) */
    readonly parentScopes: string[] | null;
    readonly index: number;
    readonly foreground: string | null;
}

const NO_PARENT_SCOPES: readonly string[] = Object.freeze([]);

class TrieRule {
    constructor(
        public scopeDepth: number,
        public readonly parentScopes: readonly string[],
        public foreground: string | null,
    ) { }

    clone(): TrieRule {
        return new TrieRule(this.scopeDepth, this.parentScopes, this.foreground);
    }

    acceptOverwrite(scopeDepth: number, foreground: string | null): void {
        if (this.scopeDepth <= scopeDepth) {
            this.scopeDepth = scopeDepth;
        }
        if (foreground !== null) {
            this.foreground = foreground;
        }
    }
}

class TrieElement {
    private readonly children = new Map<string, TrieElement>();

    constructor(
        private readonly mainRule: TrieRule,
        private readonly rulesWithParentScopes: TrieRule[],
    ) { }

    /** All rules that can apply to the scope, most specific first */
    match(scope: string): TrieRule[] {
        if (scope !== '') {
            const [head, tail] = splitHead(scope);
            const child = this.children.get(head);
            if (child) {
                return child.match(tail);
            }
        }
        return [...this.rulesWithParentScopes, this.mainRule].sort(compareBySpecificity);
    }

    insert(scopeDepth: number, scope: string, parentScopes: string[] | null, foreground: string | null): void {
        if (scope === '') {
            this.insertHere(scopeDepth, parentScopes, foreground);
            return;
        }
        const [head, tail] = splitHead(scope);
        let child = this.children.get(head);
        if (!child) {
            // A new, more specific scope starts with everything that applies to this one
            child = new TrieElement(this.mainRule.clone(), this.rulesWithParentScopes.map(rule => rule.clone()));
            this.children.set(head, child);
        }
        child.insert(scopeDepth + 1, tail, parentScopes, foreground);
    }

    private insertHere(scopeDepth: number, parentScopes: string[] | null, foreground: string | null): void {
        if (parentScopes === null) {
            this.mainRule.acceptOverwrite(scopeDepth, foreground);
            return;
        }
        for (const rule of this.rulesWithParentScopes) {
            if (compareStringArrays(rule.parentScopes, parentScopes) === 0) {
                rule.acceptOverwrite(scopeDepth, foreground);
                return;
            }
        }
        this.rulesWithParentScopes.push(new TrieRule(scopeDepth, parentScopes, foreground ?? this.mainRule.foreground));
    }
}

function splitHead(scope: string): [string, string] {
    const dot = scope.indexOf('.');
    return dot === -1 ? [scope, ''] : [scope.substring(0, dot), scope.substring(dot + 1)];
}

function compareStrings(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

function compareStringArrays(a: readonly string[] | null, b: readonly string[] | null): number {
    if (a === null && b === null) {
        return 0;
    }
    if (!a) {
        return -1;
    }
    if (!b) {
        return 1;
    }
    if (a.length !== b.length) {
        return a.length - b.length;
    }
    for (let i = 0; i < a.length; i++) {
        const result = compareStrings(a[i], b[i]);
        if (result !== 0) {
            return result;
        }
    }
    return 0;
}

function compareBySpecificity(a: TrieRule, b: TrieRule): number {
    // More dot segments in the scope first
    if (a.scopeDepth !== b.scopeDepth) {
        return b.scopeDepth - a.scopeDepth;
    }
    // Then compare the ancestors innermost first: a longer ancestor selector is more specific
    let aIndex = 0;
    let bIndex = 0;
    for (; ;) {
        // Child combinators don't affect specificity
        if (a.parentScopes[aIndex] === '>') {
            aIndex++;
        }
        if (b.parentScopes[bIndex] === '>') {
            bIndex++;
        }
        if (aIndex >= a.parentScopes.length || bIndex >= b.parentScopes.length) {
            break;
        }
        const lengthDifference = b.parentScopes[bIndex].length - a.parentScopes[aIndex].length;
        if (lengthDifference !== 0) {
            return lengthDifference;
        }
        aIndex++;
        bIndex++;
    }
    // Then more ancestors first
    return b.parentScopes.length - a.parentScopes.length;
}

/** Whether a scope matches a selector scope: the same, or more specific at a dot boundary */
function matchesScope(scope: string, selector: string): boolean {
    return selector === scope || (scope.startsWith(selector) && scope[selector.length] === '.');
}

/** Whether the ancestors scopes[0..end-1] (outermost first) satisfy the rule's ancestor selectors */
function parentScopesMatch(scopes: readonly string[], end: number, parentScopes: readonly string[]): boolean {
    let position = end - 1;
    for (let index = 0; index < parentScopes.length; index++) {
        let selector = parentScopes[index];
        let mustBeParent = false;
        if (selector === '>') {
            if (index === parentScopes.length - 1) {
                return false;
            }
            selector = parentScopes[++index];
            mustBeParent = true;
        }
        while (position >= 0 && !matchesScope(scopes[position], selector)) {
            if (mustBeParent) {
                return false;
            }
            position--;
        }
        if (position < 0) {
            return false;
        }
        position--;
    }
    return true;
}

function parseRules(rules: readonly TextMateThemeRule[]): ParsedRule[] {
    const result: ParsedRule[] = [];
    rules.forEach((rule, index) => {
        // VS Code only passes rules with a scope and settings to vscode-textmate
        if (!isObject(rule) || !rule.scope || !isObject(rule.settings)) {
            return;
        }
        let selectors: readonly unknown[];
        if (typeof rule.scope === 'string') {
            selectors = rule.scope.replace(/^,+/, '').replace(/,+$/, '').split(',');
        } else if (Array.isArray(rule.scope)) {
            selectors = rule.scope;
        } else {
            return;
        }
        const foreground = normalizeColor(rule.settings.foreground) ?? null;
        for (const selector of selectors) {
            if (typeof selector !== 'string') {
                continue;
            }
            const segments = selector.trim().split(' ');
            const scope = segments[segments.length - 1];
            if (scope === '') {
                // An empty selector sets the default style, which is not a token color of the theme
                continue;
            }
            const parentScopes = segments.length > 1 ? segments.slice(0, -1).reverse() : null;
            result.push({ scope, parentScopes, index, foreground });
        }
    });
    return result;
}

/** Resolves the foreground color of tokens for a list of theme rules (compiled once, then reused) */
export class TokenColorMatcher {
    private readonly root = new TrieElement(new TrieRule(0, NO_PARENT_SCOPES, null), []);
    private readonly matchCache = new Map<string, TrieRule[]>();

    /** @param rules theme rules in order (included theme files first, customizations last) */
    constructor(rules: readonly TextMateThemeRule[]) {
        const parsed = parseRules(rules);
        parsed.sort((a, b) => compareStrings(a.scope, b.scope) || compareStringArrays(a.parentScopes, b.parentScopes) || a.index - b.index);
        for (const rule of parsed) {
            this.root.insert(0, rule.scope, rule.parentScopes, rule.foreground);
        }
    }

    /**
     * The foreground color for a token, or undefined if the theme gives it none (the editor foreground applies).
     * @param scopeStack the token's scopes, outermost first, e.g. ['source.daily-bullet-notes', 'keyword']
     *                   (an entry containing spaces counts as several nested scopes)
     */
    foreground(scopeStack: readonly string[]): string | undefined {
        const scopes = scopeStack.flatMap(scope => scope.split(' '));
        let foreground: string | undefined;
        for (let i = 0; i < scopes.length; i++) {
            const rule = this.rulesFor(scopes[i]).find(candidate => parentScopesMatch(scopes, i, candidate.parentScopes));
            if (rule?.foreground) {
                foreground = rule.foreground;
            }
        }
        return foreground;
    }

    private rulesFor(scope: string): TrieRule[] {
        let rules = this.matchCache.get(scope);
        if (!rules) {
            rules = this.root.match(scope);
            this.matchCache.set(scope, rules);
        }
        return rules;
    }
}

/** One-off version of TokenColorMatcher.foreground */
export function resolveForeground(rules: readonly TextMateThemeRule[], scopeStack: readonly string[]): string | undefined {
    return new TokenColorMatcher(rules).foreground(scopeStack);
}

// ---------------------------------------------------------------------------------------------------------------
// editor.tokenColorCustomizations (port of colorThemeData.ts setCustomTokenColors)

/** The scopes VS Code uses for the shorthand settings of editor.tokenColorCustomizations */
export const TOKEN_GROUP_SCOPES: Readonly<Record<string, readonly string[]>> = {
    comments: ['comment', 'punctuation.definition.comment'],
    strings: ['string', 'meta.embedded.assembly'],
    // Note: the editor never applies 'keyword - keyword.operator' (see the top of this file), so the
    // "keywords" shorthand doesn't color a plain 'keyword' scope
    keywords: ['keyword - keyword.operator', 'keyword.control', 'storage', 'storage.type'],
    numbers: ['constant.numeric'],
    types: ['entity.name.type', 'entity.name.class', 'support.type', 'support.class'],
    functions: ['entity.name.function', 'support.function'],
    variables: ['variable', 'entity.name.variable'],
};

/**
 * The rules editor.tokenColorCustomizations adds after the theme's rules: the general settings first, then the
 * settings of the "[Theme Name]" blocks that apply to the theme (so they win). In each, the shorthand settings
 * (comments, strings, ...) come before textMateRules, so specific rules can override them.
 * @param themeSettingsId the theme's id as used in settings (its contribution's id, or else its label)
 */
export function customizationRules(customizations: unknown, themeSettingsId: string): TextMateThemeRule[] {
    const rules: TextMateThemeRule[] = [];
    if (isObject(customizations)) {
        addCustomizationRules(customizations, rules);
        const themeSpecific = themeSpecificCustomizations(customizations, themeSettingsId);
        if (themeSpecific) {
            addCustomizationRules(themeSpecific, rules);
        }
    }
    return rules;
}

function addCustomizationRules(customizations: Record<string, unknown>, rules: TextMateThemeRule[]): void {
    for (const [group, scopes] of Object.entries(TOKEN_GROUP_SCOPES)) {
        // A color, or an object with foreground (and fontStyle)
        const value = customizations[group];
        const settings = typeof value === 'string' && value ? { foreground: value } : isObject(value) ? value as TextMateThemeRuleSettings : undefined;
        if (settings) {
            for (const scope of scopes) {
                rules.push({ scope, settings });
            }
        }
    }
    if (Array.isArray(customizations.textMateRules)) {
        for (const rule of customizations.textMateRules) {
            if (isObject(rule) && rule.scope && rule.settings) {
                rules.push(rule as unknown as TextMateThemeRule);
            }
        }
    }
}

/** Merges the "[Theme Name]" blocks matching the theme ('*' wildcards at the start/end, several "[A][B]" per key) */
function themeSpecificCustomizations(customizations: Record<string, unknown>, themeSettingsId: string): Record<string, unknown> | undefined {
    let result: Record<string, unknown> | undefined;
    for (const [key, value] of Object.entries(customizations)) {
        if (!key.startsWith('[') || !key.endsWith(']') || !isObject(value)) {
            continue;
        }
        for (const [, themeId] of key.matchAll(/\[(.+?)\]/g)) {
            if (!themeIdMatches(themeId, themeSettingsId)) {
                continue;
            }
            result ??= {};
            for (const [subkey, override] of Object.entries(value)) {
                const original = result[subkey];
                if (Array.isArray(original) && Array.isArray(override)) {
                    result[subkey] = original.concat(override);
                } else if (override) {
                    result[subkey] = override;
                }
            }
        }
    }
    return result;
}

function themeIdMatches(themeId: string, settingsId: string): boolean {
    const startsWithWildcard = themeId.startsWith('*');
    const endsWithWildcard = themeId.endsWith('*');
    return themeId === settingsId
        || (startsWithWildcard && endsWithWildcard && settingsId.includes(themeId.slice(1, -1)))
        || (endsWithWildcard && settingsId.startsWith(themeId.slice(0, -1)))
        || (startsWithWildcard && settingsId.endsWith(themeId.slice(1)));
}

// ---------------------------------------------------------------------------------------------------------------
// Theme files (port of colorThemeData.ts _loadColorTheme), with the file access injected

/** File access for loadThemeTokenRules (L: the location type, e.g. a vscode.Uri or a file path) */
export interface ThemeFileReader<L> {
    read(location: L): Promise<string>;
    /** The location of a path relative to the folder of the file at base */
    resolve(base: L, relativePath: string): L;
    /** Whether the file is a JSON theme (otherwise a .tmTheme plist) */
    isJson(location: L): boolean;
}

const MAX_INCLUDE_DEPTH = 16;

/**
 * Reads the TextMate rules of a color theme file, in the order VS Code uses them: the rules of the "include"d
 * theme (recursively) first, then the theme's "tokenColors" (an array, or the path of a .tmTheme or .json file) or
 * its tmTheme-style "settings" array. A .tmTheme file contributes its "settings" array.
 * Rejects if a JSON file can't be read or parsed (VS Code doesn't load such a theme either).
 */
export async function loadThemeTokenRules<L>(location: L, reader: ThemeFileReader<L>): Promise<TextMateThemeRule[]> {
    const rules: TextMateThemeRule[] = [];
    await loadThemeFile(location, reader, rules, 0);
    return rules;
}

async function loadThemeFile<L>(location: L, reader: ThemeFileReader<L>, rules: TextMateThemeRule[], depth: number): Promise<void> {
    if (depth > MAX_INCLUDE_DEPTH) {
        throw new Error('Theme includes are nested too deeply');
    }
    const text = await reader.read(location);
    if (!reader.isJson(location)) {
        rules.push(...parseTmTheme(text));
        return;
    }
    const theme = parseJsonc(text);
    if (Array.isArray(theme)) {
        // A tokenColors file containing just the rules
        pushRules(theme, rules);
        return;
    }
    if (!isObject(theme)) {
        throw new Error('Invalid theme file: object expected');
    }
    if (typeof theme.include === 'string') {
        await loadThemeFile(reader.resolve(location, theme.include), reader, rules, depth + 1);
    }
    if (Array.isArray(theme.settings)) {
        pushRules(theme.settings, rules);
        return;
    }
    if (Array.isArray(theme.tokenColors)) {
        pushRules(theme.tokenColors, rules);
    } else if (typeof theme.tokenColors === 'string') {
        await loadThemeFile(reader.resolve(location, theme.tokenColors), reader, rules, depth + 1);
    }
}

function pushRules(values: readonly unknown[], rules: TextMateThemeRule[]): void {
    for (const value of values) {
        if (isObject(value)) {
            rules.push(value as unknown as TextMateThemeRule);
        }
    }
}

/**
 * Parses JSON with comments and trailing commas (like VS Code does for theme files); throws on other errors.
 * (jsonc-parser isn't used: its main entry is a UMD build that breaks when bundled by esbuild for node.)
 */
export function parseJsonc(text: string): unknown {
    // Each regex matches strings first, so that they are kept as they are
    const withoutComments = text.replace(/("(?:[^"\\]|\\.)*")|\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/g,
        (_match, string: string | undefined) => string ?? ' ');
    const json = withoutComments.replace(/("(?:[^"\\]|\\.)*")|,(\s*[}\]])/g,
        (_match, string: string | undefined, closing: string | undefined) => string ?? closing ?? '');
    return JSON.parse(json.replace(/^﻿/, ''));
}

/** The rules ("settings" array entries) of a .tmTheme plist file; [] if it can't be parsed */
export function parseTmTheme(text: string): TextMateThemeRule[] {
    try {
        const theme = parsePlist(text);
        const rules: TextMateThemeRule[] = [];
        if (isObject(theme) && Array.isArray(theme.settings)) {
            pushRules(theme.settings, rules);
        }
        return rules;
    } catch {
        return [];
    }
}

type PlistToken = { kind: 'open' | 'close' | 'empty'; name: string } | { kind: 'text'; value: string };

/** Minimal XML plist parser (dict, array, key, string, numbers, booleans) */
function parsePlist(text: string): unknown {
    const tokens: PlistToken[] = [];
    for (const match of text.matchAll(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<![^>]*>|<(\/?)([\w.-]+)[^>]*?(\/?)>|([^<]+)/g)) {
        if (match[2]) {
            tokens.push({ kind: match[1] ? 'close' : match[3] ? 'empty' : 'open', name: match[2] });
        } else if (match[4] !== undefined) {
            tokens.push({ kind: 'text', value: match[4] });
        }
    }
    let position = 0;

    function nextElement(): PlistToken | undefined {
        while (position < tokens.length) {
            const token = tokens[position];
            if (token.kind !== 'text' || token.value.trim()) {
                return token;
            }
            position++;
        }
        return undefined;
    }

    function readText(name: string): string {
        let value = '';
        for (; position < tokens.length; position++) {
            const token = tokens[position];
            if (token.kind === 'close' && token.name === name) {
                position++;
                return decodeXmlEntities(value);
            }
            if (token.kind === 'text') {
                value += token.value;
            }
        }
        throw new Error(`Unclosed <${name}>`);
    }

    function parseValue(): unknown {
        const token = nextElement();
        position++;
        if (!token || token.kind === 'text' || token.kind === 'close') {
            throw new Error('Unexpected plist content');
        }
        if (token.kind === 'empty') {
            return token.name === 'true' ? true : token.name === 'false' ? false
                : token.name === 'dict' ? {} : token.name === 'array' ? [] : '';
        }
        switch (token.name) {
            case 'plist':
                return parseValue();
            case 'dict': {
                const dict: Record<string, unknown> = {};
                for (let next = nextElement(); next?.kind !== 'close'; next = nextElement()) {
                    if (next?.kind !== 'open' || next.name !== 'key') {
                        throw new Error('Expected <key>');
                    }
                    position++;
                    const key = readText('key');
                    dict[key] = parseValue();
                }
                position++;
                return dict;
            }
            case 'array': {
                const array: unknown[] = [];
                for (let next = nextElement(); next?.kind !== 'close'; next = nextElement()) {
                    if (!next) {
                        throw new Error('Unclosed <array>');
                    }
                    array.push(parseValue());
                }
                position++;
                return array;
            }
            case 'integer':
            case 'real':
                return Number(readText(token.name));
            default:
                // string, data, date, and anything unknown: keep the text
                return readText(token.name);
        }
    }

    return parseValue();
}

function decodeXmlEntities(text: string): string {
    const named: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
    return text.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (entity, name: string) => {
        if (name.startsWith('#')) {
            const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
            return Number.isFinite(code) && code <= 0x10FFFF ? String.fromCodePoint(code) : entity;
        }
        return named[name.toLowerCase()] ?? entity;
    });
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
