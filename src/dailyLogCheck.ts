import * as vscode from 'vscode';
import { DailyBulletNotesDocument, DailySection } from './documentModel';
import { BOX_BORDER_REGEX, DAILY_LOG_TITLE_REGEX } from './documentParser';
import { getBoxHeader } from './strings';

const NEW_FILE_COMMAND = 'daily-bullet-notes.newFile';
const NEW_FILE_ACTION = 'Initialize New DBM File';

const EXAMPLE_BORDER = getBoxHeader('Daily Log').split('\n')[0];

/**
 * Returns the most recent day in the daily log. If there isn't one, shows an error explaining
 * exactly what is wrong with the file, with an option to start a new file.
 */
export function getMostRecentDayOrShowError(document: vscode.TextDocument, dbmDoc: DailyBulletNotesDocument, commandTitle: string): DailySection | undefined {
    const mostRecentDay = dbmDoc.dailyLog?.mostRecentDay;
    if (mostRecentDay) {
        return mostRecentDay;
    }

    const problem = dbmDoc.dailyLog ?
        'Found the "Daily Log" box, but no days under it. Each day starts with a header line like "12/5 ' + '-'.repeat(36) + '" (month/day, a space, then 20 or more dashes), inside a year box and a month box.' :
        describeMissingDailyLog(document);

    vscode.window.showErrorMessage(`${commandTitle} can't run. ${problem}`, NEW_FILE_ACTION).then(choice => {
        if (choice === NEW_FILE_ACTION) {
            vscode.commands.executeCommand(NEW_FILE_COMMAND);
        }
    });
    return undefined;
}

export function describeMissingDailyLog(document: vscode.TextDocument): string {
    for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber++) {
        const text = document.lineAt(lineNumber).text;
        // Look for something that was probably meant to be the Daily Log title
        if (!/^\s*\|.*daily\s*log/i.test(text)) {
            continue;
        }
        const where = `Line ${lineNumber + 1} looks like your "Daily Log" header`;

        if (!DAILY_LOG_TITLE_REGEX.test(text)) {
            return `${where}, but it must read "|  Daily Log  |": starting at the very beginning of the line with "|", "Daily Log" capitalized exactly like that with at least one space on each side, and ending with "|".`;
        }
        const lineAbove = lineNumber > 0 ? document.lineAt(lineNumber - 1).text : '';
        const lineBelow = lineNumber + 1 < document.lineCount ? document.lineAt(lineNumber + 1).text : '';
        if (!BOX_BORDER_REGEX.test(lineAbove) || !BOX_BORDER_REGEX.test(lineBelow)) {
            return `${where}, but it needs a border line directly above and below it: "+", then 20 or more "-", then "+" (like "${EXAMPLE_BORDER}").`;
        }
        return `${where} and it looks correct, but the boxes before it couldn't be read. Check that every box above it has a border line both above and below its title.`;
    }

    return `This file has no "Daily Log" header box. Add one at the very top of the file, above your first year box, in the same style as your year and month boxes: a "|  Daily Log  |" line between two border lines like "${EXAMPLE_BORDER}".`;
}
