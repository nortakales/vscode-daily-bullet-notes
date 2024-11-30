import * as vscode from 'vscode';

interface BoxIndexes {
    top: number | null;
    year: number | null;
    month: number | null;
};

class DBMFoldingRangeProviderOld implements vscode.FoldingRangeProvider {

    private dailyHeaderRegex = /^\d{1,2}\/\d{1,2} \-{30,100}/;

    private startOrEndOfBoxRegex = /^\+\-{30,100}\+/;
    private yearBoxTitleLineRegex = /^\|\s+\d{4}\s+\|/;
    private monthBoxTitleLineRegex = /^\|\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+\|/;
    private otherBoxTitleLineRegex = /^\|\s+[^\s]+\s+\|/;

    provideFoldingRanges(document: vscode.TextDocument, context: vscode.FoldingContext, token: vscode.CancellationToken): vscode.FoldingRange[] {

        const ranges: vscode.FoldingRange[] = [];

        let lastDailyHeaderIndex: number | null = null;

        let insideBox = false;
        let currentBoxType: string | null = null;
        let currentBoxStart: number | null = null;
        let lastBoxIndex: BoxIndexes = {
            top: null,
            year: null,
            month: null
        };

        for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber++) {
            const line = document.lineAt(lineNumber);

            if (line.text.match(this.dailyHeaderRegex)) {

                if (lastDailyHeaderIndex !== null) {
                    // we are already in a header, let's close it
                    ranges.push(new vscode.FoldingRange(lastDailyHeaderIndex, lineNumber - 1));
                }
                // Start a new range
                lastDailyHeaderIndex = lineNumber;
            }

            // if (line.text === "" && lastDailyHeaderIndex !== null) {
            //     ranges.push(new vscode.FoldingRange(lastDailyHeaderIndex, lineNumber - 1));
            //     lastDailyHeaderIndex = null;
            // }


            if (line.text.match(this.startOrEndOfBoxRegex)) {

                if (insideBox) {

                    // TODO only collapse content, not newlines before a box
                    // TODO Allow spaces in box title in syntax highlighting
                    if (currentBoxType === "top") {
                        // Close last top, month and year boxes

                        let lastTopIndex = lastBoxIndex.top;
                        if (lastTopIndex !== null && currentBoxStart !== null) {
                            ranges.push(new vscode.FoldingRange(lastTopIndex, currentBoxStart));
                            lastBoxIndex.top = null;
                        }
                    }

                    if (currentBoxType === "top" || currentBoxType === "year") {
                        // Close last year and month boxes

                        let lastYearIndex = lastBoxIndex.year;
                        if (lastYearIndex !== null && currentBoxStart !== null) {
                            ranges.push(new vscode.FoldingRange(lastYearIndex, currentBoxStart));
                            lastBoxIndex.year = null;
                        }

                    }

                    if (currentBoxType === "top" || currentBoxType === "year" || currentBoxType === "month") {
                        // Close last month box
                        let lastMonthIndex = lastBoxIndex.month;
                        if (lastMonthIndex !== null && currentBoxStart !== null) {
                            ranges.push(new vscode.FoldingRange(lastMonthIndex, currentBoxStart));
                            lastBoxIndex.month = null;
                        }
                    }

                    lastBoxIndex[currentBoxType as keyof BoxIndexes] = lineNumber;
                    currentBoxStart = null;
                    currentBoxType = null;
                    insideBox = false;
                } else {

                    if (lastDailyHeaderIndex !== null) {
                        // we are in a header, let's close it
                        ranges.push(new vscode.FoldingRange(lastDailyHeaderIndex, lineNumber - 1));
                        lastDailyHeaderIndex = null;
                    }

                    currentBoxStart = lineNumber - 1;
                    insideBox = true;
                }

            } else if (line.text.match(this.monthBoxTitleLineRegex)) {
                currentBoxType = "month";
            } else if (line.text.match(this.yearBoxTitleLineRegex)) {
                currentBoxType = "year";
            } else if (line.text.match(this.otherBoxTitleLineRegex)) {
                currentBoxType = "top";
            }
        }

        // If we have unclosed box ranges, close them at the end of the file
        if (lastBoxIndex.top !== null) {
            ranges.push(new vscode.FoldingRange(lastBoxIndex.top, document.lineCount - 1));
        }
        if (lastBoxIndex.year !== null) {
            ranges.push(new vscode.FoldingRange(lastBoxIndex.year, document.lineCount - 1));
        }
        if (lastBoxIndex.month !== null) {
            ranges.push(new vscode.FoldingRange(lastBoxIndex.month, document.lineCount - 1));
        }


        return ranges;
    }

}

export default DBMFoldingRangeProviderOld;