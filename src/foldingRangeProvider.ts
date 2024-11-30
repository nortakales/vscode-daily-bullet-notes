import * as vscode from 'vscode';
import Parser from './documentParser';

class DBMFoldingRangeProvider implements vscode.FoldingRangeProvider {


    provideFoldingRanges(document: vscode.TextDocument, context: vscode.FoldingContext, token: vscode.CancellationToken): vscode.FoldingRange[] {
        const parser = new Parser(document);
        const parsedDocument = parser.parseHeirarchy();

        const ranges: vscode.FoldingRange[] = [];

        ranges.push(parsedDocument.dailyLog.range);
        parsedDocument.dailyLog.yearSections.forEach(yearSection => {
            ranges.push(yearSection.range);
            yearSection.monthSections.forEach(monthSection => {
                ranges.push(monthSection.range);
                monthSection.dailySections.forEach(dailySection => {
                    ranges.push(dailySection.range);
                });
            });
        });
        parsedDocument.listSections.forEach(listSection => {
            ranges.push(listSection.range);
        });

        return ranges;
    }

}

export default DBMFoldingRangeProvider;