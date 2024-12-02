import * as vscode from 'vscode';
import { DailyBulletNotesDocument, DailyLog, DailySection, ListSection, MonthSection, YearSection } from './documentModel';
import { getMonthFromString } from './strings';

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

    public parseDocument(): DailyBulletNotesDocument {

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
        let mostRecentDay: DailySection | undefined;

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
                    const day = {
                        day: currentDay!,
                        range: new vscode.FoldingRange(currentDailyHeaderIndex, lineNumber - 1),
                    };
                    currentDaySections.push(day);
                    mostRecentDay = day;
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
                            const monthSection = {
                                monthTitle: previousMonth!,
                                month: getMonthFromString(previousMonth!),
                                dailySections: currentDaySections,
                                range: new vscode.FoldingRange(lastMonthIndex, lastLineBeforeCurrentBox)
                            };
                            // Set up reverse reference
                            for (const dailySection of monthSection.dailySections) {
                                dailySection.monthSection = monthSection;
                            }
                            currentMonthSections.push(monthSection);
                            previousMonth = null;
                            currentDaySections = [];
                            lastBoxIndex.month = null;
                        }
                    }

                    if (currentBoxType === "list" || currentBoxType === "year") {
                        // Close last year box

                        let lastYearIndex = lastBoxIndex.year;
                        if (lastYearIndex !== null && lastLineBeforeCurrentBox !== null) {
                            const yearSection = {
                                year: previousYear!,
                                monthSections: currentMonthSections,
                                range: new vscode.FoldingRange(lastYearIndex, lastLineBeforeCurrentBox)
                            };
                            // Set up reverse reference
                            for (const monthSection of yearSection.monthSections) {
                                monthSection.yearSection = yearSection;
                            }
                            yearSections.push(yearSection);
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
                                range: new vscode.FoldingRange(dailyLogIndex, lastLineBeforeCurrentBox),
                                mostRecentDay: mostRecentDay
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
                        const day = {
                            day: currentDay!,
                            range: new vscode.FoldingRange(currentDailyHeaderIndex, lineNumber - 1),
                        };
                        currentDaySections.push(day);
                        mostRecentDay = day;
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

        if (currentDailyHeaderIndex !== null) {
            // Close out the previous day
            const day = {
                day: currentDay!,
                range: new vscode.FoldingRange(currentDailyHeaderIndex, this.document.lineCount - 1),
            };
            currentDaySections.push(day);
            mostRecentDay = day;
        }

        if (lastBoxIndex.month !== null) {
            const monthSection = {
                monthTitle: currentMonth!,
                month: getMonthFromString(currentMonth!),
                dailySections: currentDaySections,
                range: new vscode.FoldingRange(lastBoxIndex.month, this.document.lineCount - 1)
            };
            // Set up reverse reference
            for (const dailySection of monthSection.dailySections) {
                dailySection.monthSection = monthSection;
            }
            currentMonthSections.push(monthSection);
        }

        if (lastBoxIndex.year !== null) {
            const yearSection = {
                year: currentYear!,
                monthSections: currentMonthSections,
                range: new vscode.FoldingRange(lastBoxIndex.year, this.document.lineCount - 1)
            };
            // Set up reverse reference
            for (const monthSection of yearSection.monthSections) {
                monthSection.yearSection = yearSection;
            }
            yearSections.push(yearSection);
        }
        if (lastBoxIndex.dailyLog !== null) {
            dailyLog = {
                yearSections: yearSections,
                range: new vscode.FoldingRange(lastBoxIndex.dailyLog, this.document.lineCount - 1),
                mostRecentDay: mostRecentDay
            };
        }
        if (lastBoxIndex.list !== null) {
            listSections.push({
                title: currentListTitle!,
                range: new vscode.FoldingRange(lastBoxIndex.list, this.document.lineCount - 1)
            });
        }


        return {
            dailyLog: dailyLog!,
            listSections: listSections
        };
    }
}

interface BoxIndexes {
    dailyLog: number | null;
    year: number | null;
    month: number | null;
    list: number | null;
};



export default Parser;