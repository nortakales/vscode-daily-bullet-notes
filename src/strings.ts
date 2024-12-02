export function getBoxHeader(title: string) {
    // TODO load width preference
    const width = 43;
    const horizontalLine = `+${'-'.repeat(width - 2)}+`;
    const totalSpaces = width - 2 - title.length;
    const centerLineSpaces = ' '.repeat(totalSpaces / 2);
    const extraSpaceForOddWidth = totalSpaces % 2 === 0 ? '' : ' ';
    const centerLine = `|${centerLineSpaces}${title}${centerLineSpaces}${extraSpaceForOddWidth}|`;
    return `${horizontalLine}\n${centerLine}\n${horizontalLine}`;
}

export function getDailyHeader(month: number, day: number, isToday: boolean = false) {
    // TODO get month/day preference
    const includeMonth = true;
    // TODO get width preference
    const width = 43;
    const monthDayText = `${includeMonth ? month : ''}/${day}`;
    const todayText = isToday ? ' < Today' : '';
    const totalDashes = width - 1 - monthDayText.length - todayText.length;

    return `${monthDayText} ${'-'.repeat(totalDashes)}${todayText}`;
}

export function getMonthFromString(month: string) {
    return months.indexOf(month) + 1;
}

export function getStringFromMonth(month: number) {
    return months[month - 1];
}

const months = [
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
];