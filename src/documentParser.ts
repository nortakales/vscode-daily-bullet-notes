import * as vscode from 'vscode';
import { DailyBulletNotesDocument, DailyLog, DailySection, ListSection, MonthSection, YearSection } from './documentModel';

class Parser {

    private startOrEndOfBoxRegex = /^\+\-{20,100}\+/;
    private dailyLogTitleLineRegex = /^\|\s+Daily Log\s+\|/;
    private yearBoxTitleLineRegex = /^\|\s+(\d{4})\s+\|/;
    private monthBoxTitleLineRegex = /^\|\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+\|/;
    private listBoxTitleLineRegex = /^\|\s+([^\s]+)\s+\|/;

    private dailyHeaderRegex = /^\d{1,2}(\/(\d{1,2}))? \-{20,100}( < Today)?/;

    private document: vscode.TextDocument;

    public constructor(document: vscode.TextDocument) {
        this.document = document;
    }

    public parseHeirarchy(): DailyBulletNotesDocument {

        let currentDailyHeaderIndex: number | null = null;

        let insideBox = false;
        let currentBoxType: string | null = null;
        let lastLineBeforeCurrentBox: number | null = null;
        let lastBoxIndex: BoxIndexes = {
            dailyLog: null,
            year: null,
            month: null,
            list: null
        };

        let dailyLog: DailyLog | null = null;
        let yearSections: YearSection[] = [];

        let previousYear: number | null = null;
        let currentYear: number | null = null;
        let currentMonthSections: MonthSection[] = [];

        let previousMonth: string | null = null;
        let currentMonth: string | null = null;
        let currentDaySections: DailySection[] = [];

        let currentDay: number | null = null;

        let previousListTitle: string | null = null;
        let currentListTitle: string | null = null;
        let listSections: ListSection[] = [];


        for (let lineNumber = 0; lineNumber < this.document.lineCount; lineNumber++) {
            const line = this.document.lineAt(lineNumber);

            let dailyHeaderMatcher = line.text.match(this.dailyHeaderRegex);
            if (dailyHeaderMatcher) {

                if (currentDailyHeaderIndex !== null) {

                    // Close out the previous day
                    currentDaySections.push({
                        day: currentDay!,
                        range: new vscode.FoldingRange(currentDailyHeaderIndex, lineNumber - 1),
                    });
                }
                // Start a new day
                currentDay = +dailyHeaderMatcher[2];
                currentDailyHeaderIndex = lineNumber;
            }

            // if (line.text === "" && lastDailyHeaderIndex !== null) {
            //     ranges.push(new vscode.FoldingRange(lastDailyHeaderIndex, lineNumber - 1));
            //     lastDailyHeaderIndex = null;
            // }


            if (line.text.match(this.startOrEndOfBoxRegex)) {

                if (insideBox) {


                    if (currentBoxType === "list" || currentBoxType === "year" || currentBoxType === "month") {
                        // Close last month box
                        let lastMonthIndex = lastBoxIndex.month;
                        if (lastMonthIndex !== null && lastLineBeforeCurrentBox !== null) {
                            currentMonthSections.push({
                                monthTitle: previousMonth!,
                                month: this.getMonthFromString(previousMonth!),
                                dailySections: currentDaySections,
                                range: new vscode.FoldingRange(lastMonthIndex, lastLineBeforeCurrentBox)
                            });
                            previousMonth = null;
                            currentDaySections = [];
                            lastBoxIndex.month = null;
                        }
                    }

                    if (currentBoxType === "list" || currentBoxType === "year") {
                        // Close last year box

                        let lastYearIndex = lastBoxIndex.year;
                        if (lastYearIndex !== null && lastLineBeforeCurrentBox !== null) {
                            yearSections.push({
                                year: previousYear!,
                                monthSections: currentMonthSections,
                                range: new vscode.FoldingRange(lastYearIndex, lastLineBeforeCurrentBox)
                            });
                            previousYear = null;
                            currentMonthSections = [];
                            lastBoxIndex.year = null;
                        }
                    }

                    if (currentBoxType === "list") {

                        // Close daily log if it is open still
                        let dailyLogIndex = lastBoxIndex.dailyLog;
                        if (dailyLogIndex !== null && lastLineBeforeCurrentBox !== null) {
                            dailyLog = {
                                yearSections: yearSections,
                                range: new vscode.FoldingRange(dailyLogIndex, lastLineBeforeCurrentBox)
                            };
                            lastBoxIndex.dailyLog = null;
                        }


                        // Close last list
                        let lastListIndex = lastBoxIndex.list;
                        if (lastListIndex !== null && lastLineBeforeCurrentBox !== null) {
                            listSections.push({
                                title: previousListTitle!,
                                range: new vscode.FoldingRange(lastListIndex, lastLineBeforeCurrentBox)
                            });
                            previousListTitle = null;
                            lastBoxIndex.list = null;
                        }
                    }

                    if (currentBoxType === "dailyLog") {
                        // Nothing to do?
                    }


                    lastBoxIndex[currentBoxType as keyof BoxIndexes] = lineNumber;
                    lastLineBeforeCurrentBox = null;
                    currentBoxType = null;
                    insideBox = false;
                } else {

                    // We are starting a box, close out a day if we were in one

                    if (currentDailyHeaderIndex !== null) {
                        // Close out the previous day
                        currentDaySections.push({
                            day: currentDay!,
                            range: new vscode.FoldingRange(currentDailyHeaderIndex, lineNumber - 1),
                        });
                        currentDailyHeaderIndex = null;
                        currentDay = null;
                    }

                    // TODO only collapse content, not newlines before a box
                    lastLineBeforeCurrentBox = lineNumber - 1;
                    insideBox = true;
                }

            } else if (line.text.match(this.monthBoxTitleLineRegex)) {
                currentBoxType = "month";
                previousMonth = currentMonth;
                currentMonth = line.text.match(this.monthBoxTitleLineRegex)![1];
            } else if (line.text.match(this.yearBoxTitleLineRegex)) {
                currentBoxType = "year";
                previousYear = currentYear;
                currentYear = +line.text.match(this.yearBoxTitleLineRegex)![1];

                previousMonth = currentMonth;
            } else if (line.text.match(this.dailyLogTitleLineRegex)) {
                currentBoxType = "dailyLog";
            } else if (line.text.match(this.listBoxTitleLineRegex)) {
                currentBoxType = "list";
                previousListTitle = currentListTitle;
                currentListTitle = line.text.match(this.listBoxTitleLineRegex)![1];

                previousMonth = currentMonth;
                previousYear = currentYear;
            }
        }

        // If we have unclosed box ranges, close them at the end of the file

        if (lastBoxIndex.month !== null) {
            currentMonthSections.push({
                monthTitle: currentMonth!,
                month: this.getMonthFromString(currentMonth!),
                dailySections: currentDaySections,
                range: new vscode.FoldingRange(lastBoxIndex.month, this.document.lineCount - 1)
            });
        }

        if (lastBoxIndex.year !== null) {
            yearSections.push({
                year: currentYear!,
                monthSections: currentMonthSections,
                range: new vscode.FoldingRange(lastBoxIndex.year, this.document.lineCount - 1)
            });
        }
        if (lastBoxIndex.dailyLog !== null) {
            dailyLog = {
                yearSections: yearSections,
                range: new vscode.FoldingRange(lastBoxIndex.dailyLog, this.document.lineCount - 1)
            };
        }
        if (lastBoxIndex.list !== null) {
            listSections.push({
                title: currentListTitle!,
                range: new vscode.FoldingRange(lastBoxIndex.list, this.document.lineCount - 1)
            });
        }

        // TODO unclosed daily range (e.g. no lists)?

        return {
            dailyLog: dailyLog!,
            listSections: listSections
        };
    }

    private getMonthFromString(month: string) {
        return this.months.indexOf(month) + 1;
    }

    private months = [
        'January',
        'February',
        'March',
        'April',
        'May',
        'June',
        'July',
        'August',
        'September',
        'October',
        'November',
        'December'
    ]

}

interface BoxIndexes {
    dailyLog: number | null;
    year: number | null;
    month: number | null;
    list: number | null;
};



export default Parser;