import { FoldingRange } from "vscode";

export interface DailyBulletNotesDocument {
    dailyLog: DailyLog;
    listSections: ListSection[];
}

export interface DailyLog {
    yearSections: YearSection[]
    mostRecentDay?: DailySection;

    range: FoldingRange;
}

export interface YearSection {
    year: number;
    monthSections: MonthSection[]

    range: FoldingRange;
}

export interface MonthSection {
    monthTitle: string;
    month: number;
    dailySections: DailySection[]
    yearSection?: YearSection

    range: FoldingRange;
}
export interface DailySection {
    day: number;
    monthSection?: MonthSection;
    previousDailySection?: DailySection;
    nextDailySection?: DailySection;

    range: FoldingRange;
}

export interface ListSection {
    title: string;

    range: FoldingRange;
}