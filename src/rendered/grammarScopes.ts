// The TextMate scopes syntaxes/daily-bullet-notes.tmLanguage.json gives each part of a .dbm file (no vscode
// import, so tests can use it).
//
// Each status and header has its own scope, so themes and users (editor.tokenColorCustomizations) can color them
// individually. Every scope extends a common generic scope (keyword, string, ...) with segments no theme uses,
// so themes that don't know about this extension color them exactly as they color the generic scope.

import { StatusKey } from './protocol';

/** Root scope of the grammar */
export const ROOT_SCOPE = 'source.daily-bullet-notes';

/** The scope of each status box, e.g. [x] */
export const STATUS_SCOPES: Record<StatusKey, string> = {
    open: 'support.function.status-open.daily-bullet-notes',
    done: 'keyword.status-done.daily-bullet-notes',
    progress: 'constant.character.status-progress.daily-bullet-notes',
    blocked: 'string.status-blocked.daily-bullet-notes',
    removed: 'entity.name.class.status-removed.daily-bullet-notes',
    tomorrow: 'constant.numeric.status-tomorrow.daily-bullet-notes',
};

/** The scope of box header lines (+----+ and | Title |) */
export const HEADER_SCOPE = 'constant.character.box-header.daily-bullet-notes';

/** The scope of day header lines (10/4 ------- < Today) */
export const DAY_HEADER_SCOPE = 'entity.name.function.day-header.daily-bullet-notes';

/** The generic scope a specific scope extends, e.g. keyword for keyword.status-done.daily-bullet-notes */
export function genericScope(scope: string): string {
    return scope.split('.').slice(0, -2).join('.');
}
