export function getBoxHeader(title: string) {
    // TODO load width preference
    const width = 42;
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
    const width = 42;
    const monthDayText = `${includeMonth ? month : ''}/${day}`;
    const todayText = isToday ? ' < Today' : '';
    const totalDashes = width - 1 - monthDayText.length - todayText.length;

    return `${monthDayText} ${'-'.repeat(totalDashes)}${todayText}`;
}

/**
 * The headers every log needs: the Daily Log box, plus year, month and day headers for the given date
 */
export function getNewLogHeaders(date: Date) {
    const month = date.getMonth() + 1;
    return [
        getBoxHeader("Daily Log"),
        getBoxHeader(date.getFullYear() + ""),
        getBoxHeader(getStringFromMonth(month)),
        getDailyHeader(month, date.getDate())
    ].join("\n");
}

/**
 * Content for a brand new file: the headers needed for the given date, with that day pre-populated
 * with an example of each type of bullet, followed by an example list
 */
export function getNewFileTemplate(date: Date) {
    const exampleDay = [
        "[x] this task is complete",
        "[/] this task is blocked, you are waiting on someone or something before more progress can be made",
        "[-] this task is either no longer relevant or tracked by someone else now",
        "[+] you made some progress on this task today, but it isn't done yet",
        "[ ] this task is ready and waiting to be worked on",
        "[>] this task was added today, but you plan to work on it tomorrow",
        "Here is a quick note you took about the day, like you took the afternoon off or attended an event"
    ];

    // TODO could make a list of example commands and preferences
    const exampleList = [
        "This is an example where you might keep things like your career goals,",
        "longstanding tasks on your backburner, ideas for an upcoming hackathon,",
        "some inspirational quotes, or even just your last meeting notes.",
        "You can create many lists like this, and they will always live just below",
        "your latest daily entry."
    ];

    return [
        getNewLogHeaders(date),
        ...exampleDay,
        "",
        getBoxHeader("Example List"),
        ...exampleList
    ].join("\n") + "\n";
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