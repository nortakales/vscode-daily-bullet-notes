// The colors the active color theme gives the .dbm grammar's scopes in the text editor, so the rendered view
// (a webview, which only gets workbench colors as CSS variables) can use the same colors for statuses.
// The extension API doesn't expose token colors, so this finds the active theme's file in the extension that
// contributes it, reads its TextMate rules, adds editor.tokenColorCustomizations and resolves the scopes like
// the editor does (see scopeMatcher.ts). Works on desktop and web, never throws: unresolved colors are missing.
// Limitation: vscode.extensions.all only lists the extensions of this extension host. In a remote window (WSL,
// SSH, containers) where this extension runs remotely, theme extensions run locally, so no colors are found.

import * as vscode from 'vscode';
import { StatusColors, StatusKey } from './protocol';
import { customizationRules, loadThemeTokenRules, ThemeFileReader, TokenColorMatcher } from './scopeMatcher';

import { DAY_HEADER_SCOPE, HEADER_SCOPE, ROOT_SCOPE, STATUS_SCOPES } from './grammarScopes';

// Kept here too for existing importers
export { DAY_HEADER_SCOPE, HEADER_SCOPE, ROOT_SCOPE, STATUS_SCOPES };

/** Reading a theme should take milliseconds; give up after this (resolutions are queued, see below) */
const RESOLVE_TIMEOUT_MS = 5000;

let lastResolution: Promise<unknown> = Promise.resolve();

/** The compiled rules of the last theme + customizations used */
let cachedMatcher: { key: string; matcher: Promise<TokenColorMatcher> } | undefined;

/**
 * The theme's foreground color for each scope (nested in the grammar's root scope), as a CSS color, e.g.
 * { keyword: '#569CD6' }. A scope is undefined if the theme gives it no color (the editor foreground applies).
 * Resolves to {} if the theme can't be read.
 */
export function resolveScopeColors(scopes: string[]): Promise<Record<string, string | undefined>> {
    // Resolutions complete in the order they were requested, so a listener of onDidChangeTokenColors that
    // posts the result always ends with the colors of the latest change
    const resolution = lastResolution.then(() => resolveNow(scopes));
    lastResolution = resolution;
    return resolution;
}

/** The theme's color for each status (missing if the theme has none or can't be read) */
export async function resolveStatusColors(): Promise<StatusColors> {
    const colors = await resolveScopeColors(Object.values(STATUS_SCOPES));
    const result: StatusColors = {};
    for (const [status, scope] of Object.entries(STATUS_SCOPES) as [StatusKey, string][]) {
        const color = colors[scope];
        if (color) {
            result[status] = color;
        }
    }
    return result;
}

const AFFECTING_SETTINGS = [
    'workbench.colorTheme',
    'workbench.preferredDarkColorTheme',
    'workbench.preferredLightColorTheme',
    'workbench.preferredHighContrastColorTheme',
    'workbench.preferredHighContrastLightColorTheme',
    'window.autoDetectColorScheme',
    'window.autoDetectHighContrast',
    'editor.tokenColorCustomizations',
];

/**
 * Fires when the token colors may have changed: the active color theme changed, or a setting that selects the
 * theme or customizes token colors. (Changing the theme usually fires twice: the setting, then the theme.)
 */
export function onDidChangeTokenColors(listener: () => void): vscode.Disposable {
    const changed = () => {
        cachedMatcher = undefined;
        listener();
    };
    return vscode.Disposable.from(
        vscode.window.onDidChangeActiveColorTheme(changed),
        vscode.workspace.onDidChangeConfiguration(event => {
            if (AFFECTING_SETTINGS.some(setting => event.affectsConfiguration(setting))) {
                changed();
            }
        }),
    );
}

// ---------------------------------------------------------------------------------------------------------------

async function resolveNow(scopes: string[]): Promise<Record<string, string | undefined>> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('Timed out reading the color theme')), RESOLVE_TIMEOUT_MS);
        });
        const matcher = await Promise.race([activeThemeMatcher(), timeout]);
        if (!matcher) {
            return {};
        }
        const colors: Record<string, string | undefined> = {};
        for (const scope of scopes) {
            colors[scope] = matcher.foreground([ROOT_SCOPE, scope]);
        }
        return colors;
    } catch (error) {
        console.warn('Daily Bullet Notes: could not resolve the color theme\'s token colors', error);
        return {};
    } finally {
        clearTimeout(timer);
    }
}

async function activeThemeMatcher(): Promise<TokenColorMatcher | undefined> {
    const theme = await findActiveTheme();
    const customizations = vscode.workspace.getConfiguration().get<unknown>('editor.tokenColorCustomizations');
    if (!theme) {
        if (!isRemoteExtensionHost()) {
            return undefined;
        }
        // The theme is installed on the local computer, which a remote (WSL, SSH, container) extension host can't
        // see. The settings can still say how the theme is customized; the webview has fallbacks for the rest.
        return new TokenColorMatcher(customizationRules(customizations, candidateThemeNames()[0] ?? DEFAULT_THEME));
    }
    const key = JSON.stringify([theme.extension.id, theme.extension.packageJSON?.version, theme.path, theme.settingsId, customizations ?? null]);
    if (cachedMatcher?.key !== key) {
        const matcher = loadThemeTokenRules(vscode.Uri.joinPath(theme.extension.extensionUri, theme.path), themeFileReader)
            .then(rules => new TokenColorMatcher([...rules, ...customizationRules(customizations, theme.settingsId)]));
        const entry = { key, matcher };
        cachedMatcher = entry;
        // Don't keep a failure: try again next time
        matcher.catch(() => {
            if (cachedMatcher === entry) {
                cachedMatcher = undefined;
            }
        });
    }
    return cachedMatcher.matcher;
}

const themeFileReader: ThemeFileReader<vscode.Uri> = {
    read: readTextFile,
    resolve: (base, relativePath) => vscode.Uri.joinPath(base, '..', relativePath),
    isJson: uri => uri.path.endsWith('.json'),
};

async function readTextFile(uri: vscode.Uri): Promise<string> {
    try {
        return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
    } catch (error) {
        // On the web, extensions can be served over http(s), which workspace.fs may not support
        if (uri.scheme === 'https' || uri.scheme === 'http') {
            const response = await fetch(uri.toString(true));
            if (response.ok) {
                return response.text();
            }
        }
        throw error;
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Finding the active theme

interface ThemeContribution {
    readonly extension: vscode.Extension<unknown>;
    /** The id used in settings (VS Code uses the theme's id, or else its label) */
    readonly settingsId: string;
    readonly path: string;
    readonly kind: vscode.ColorThemeKind;
}

/** The default dark theme of VS Code 1.95 (where workbench.colorTheme has no value at all) */
const DEFAULT_THEME = 'Default Dark Modern';

/** Built-in theme ids that VS Code renamed (it migrates the settings): [old id, current id] */
const RENAMED_THEME_IDS: readonly (readonly [string, string])[] = [
    ['Default Dark Modern', 'Dark Modern'],
    ['Default Light Modern', 'Light Modern'],
    ['Default Dark+', 'Dark+'],
    ['Default Light+', 'Light+'],
    ['Experimental Dark', 'Dark 2026'],
    ['VS Code Dark', 'Dark 2026'],
    ['Experimental Light', 'Light 2026'],
    ['VS Code Light', 'Light 2026'],
];

const KIND_BY_UI_THEME: Record<string, vscode.ColorThemeKind> = {
    'vs': vscode.ColorThemeKind.Light,
    'vs-dark': vscode.ColorThemeKind.Dark,
    'hc-black': vscode.ColorThemeKind.HighContrast,
    'hc-light': vscode.ColorThemeKind.HighContrastLight,
};

const PREFERRED_THEME_SETTING: Record<vscode.ColorThemeKind, string> = {
    [vscode.ColorThemeKind.Light]: 'workbench.preferredLightColorTheme',
    [vscode.ColorThemeKind.Dark]: 'workbench.preferredDarkColorTheme',
    [vscode.ColorThemeKind.HighContrast]: 'workbench.preferredHighContrastColorTheme',
    [vscode.ColorThemeKind.HighContrastLight]: 'workbench.preferredHighContrastLightColorTheme',
};

/** True when running in a remote (WSL, SSH, container) extension host, which only sees extensions installed there */
function isRemoteExtensionHost(): boolean {
    return vscode.env.remoteName !== undefined &&
        vscode.extensions.getExtension('nortakales.daily-bullet-notes')?.extensionKind === vscode.ExtensionKind.Workspace;
}

/** The theme names that may be active, most likely first */
function candidateThemeNames(): string[] {
    const config = vscode.workspace.getConfiguration();
    const kind = vscode.window.activeColorTheme.kind;
    const preferredSetting = PREFERRED_THEME_SETTING[kind] ?? PREFERRED_THEME_SETTING[vscode.ColorThemeKind.Dark];
    const isHighContrast = kind === vscode.ColorThemeKind.HighContrast || kind === vscode.ColorThemeKind.HighContrastLight;

    // The extension API doesn't say which setting selected the theme (that depends on the OS color scheme), so
    // take the candidates in order of likelihood, and prefer one of the kind of the active theme
    const names: (string | undefined)[] = [];
    if (config.get<boolean>('window.autoDetectColorScheme') && !isHighContrast) {
        // The OS dark/light mode selects the preferred theme for that mode
        names.push(config.get<string>(preferredSetting));
    }
    names.push(config.get<string>('workbench.colorTheme') || DEFAULT_THEME);
    if (isHighContrast && config.get<boolean>('window.autoDetectHighContrast') !== false) {
        // The OS high contrast mode selects the preferred high contrast theme
        names.push(config.get<string>(preferredSetting));
    }

    return names.filter((name): name is string => !!name);
}

async function findActiveTheme(): Promise<ThemeContribution | undefined> {
    const config = vscode.workspace.getConfiguration();
    const kind = vscode.window.activeColorTheme.kind;
    const preferredSetting = PREFERRED_THEME_SETTING[kind] ?? PREFERRED_THEME_SETTING[vscode.ColorThemeKind.Dark];
    const names = candidateThemeNames();
    const themes = contributedThemes();
    const found: ThemeContribution[] = [];
    for (const name of names) {
        const theme = name ? await findTheme(themes, name) : undefined;
        if (theme) {
            found.push(theme);
        }
    }
    if (found.length) {
        return found.find(theme => theme.kind === kind) ?? found[0];
    }
    if (isRemoteExtensionHost()) {
        // Not found because the theme is installed locally, not because VS Code is showing its default theme
        return undefined;
    }
    // The configured theme isn't installed: VS Code uses its default theme of the kind
    const defaultName = config.inspect<string>(preferredSetting)?.defaultValue;
    return defaultName ? findTheme(themes, defaultName) : undefined;
}

function contributedThemes(): ThemeContribution[] {
    const result: ThemeContribution[] = [];
    for (const extension of vscode.extensions.all) {
        const themes: unknown = extension.packageJSON?.contributes?.themes;
        if (!Array.isArray(themes)) {
            continue;
        }
        for (const theme of themes) {
            if (typeof theme?.path !== 'string') {
                continue;
            }
            const label = typeof theme.label === 'string' && theme.label ? theme.label : theme.path.split('/').pop();
            const settingsId = typeof theme.id === 'string' && theme.id ? theme.id : label;
            const kind = KIND_BY_UI_THEME[theme.uiTheme] ?? vscode.ColorThemeKind.Dark;
            result.push({ extension, settingsId, path: theme.path, kind });
        }
    }
    return result;
}

async function findTheme(themes: ThemeContribution[], name: string): Promise<ThemeContribution | undefined> {
    const ids = [name];
    for (const [oldId, currentId] of RENAMED_THEME_IDS) {
        if (name === oldId) {
            ids.push(currentId);
        } else if (name === currentId) {
            // VS Code versions before the rename use the old id
            ids.push(oldId);
        }
    }
    for (const id of ids) {
        const theme = themes.find(candidate => candidate.settingsId === id);
        if (theme) {
            return theme;
        }
    }
    // A theme without an id whose label wasn't localized: the setting has the label from package.nls.json
    for (const theme of themes) {
        const nlsKey = /^%(.+)%$/.exec(theme.settingsId)?.[1];
        if (nlsKey) {
            const label = await localizedString(theme.extension, nlsKey);
            if (label && ids.includes(label)) {
                return { ...theme, settingsId: label };
            }
        }
    }
    return undefined;
}

async function localizedString(extension: vscode.Extension<unknown>, key: string): Promise<string | undefined> {
    try {
        const strings: unknown = JSON.parse(await readTextFile(vscode.Uri.joinPath(extension.extensionUri, 'package.nls.json')));
        const value = (strings as Record<string, unknown> | null)?.[key];
        // Either a string, or { message, comment }
        const message = typeof value === 'object' && value !== null ? (value as { message?: unknown }).message : value;
        return typeof message === 'string' ? message : undefined;
    } catch {
        return undefined;
    }
}
