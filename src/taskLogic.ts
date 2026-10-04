// Pure task logic with no dependency on the vscode API, so it can be unit tested directly.

const TASK_REGEX = /^(\s*)\[(.?)\]/;

/**
 * Computes a parent task's status from its sub-tasks' statuses.
 */
export function computeCombinedStatus(statuses: string[]): string {
    if (!statuses || statuses.length === 0) {
        return ' ';
    }
    const uniqueStatuses = new Set(statuses);
    if (uniqueStatuses.size === 1) {
        return statuses[0];
    }

    // Removed sub-tasks don't affect the parent (if every sub-task was removed, that was handled above)
    uniqueStatuses.delete('-');
    if (uniqueStatuses.size === 1) {
        return [...uniqueStatuses][0];
    }

    // Some work was done, but some remains (open, blocked, planned for tomorrow, etc.)
    if (uniqueStatuses.has('x') || uniqueStatuses.has('+')) {
        return '+';
    }

    // No progress yet: anything open wins, then blocked, then planned for tomorrow
    // TODO grab [ ] vs [] setting to decide which to prefer
    for (const status of [' ', '', '/', '>']) {
        if (uniqueStatuses.has(status)) {
            return status;
        }
    }

    // Only unrecognized statuses remain
    return '+';
}

/**
 * Number of leading whitespace characters. Use this when comparing against character positions.
 */
export function getIndentLevel(line: string): number {
    const match = line.match(/^\s+/);
    return match ? match[0].length : 0;
}

/**
 * Visual width of the leading whitespace, with tabs expanded to the next tab stop. Use this when
 * comparing indentation between lines, so a tab and the equivalent number of spaces are treated the same.
 */
export function getIndentWidth(line: string, tabSize: number): number {
    const size = tabSize > 0 ? tabSize : 4;
    let width = 0;
    for (const character of line) {
        if (character === '\t') {
            width += size - (width % size);
        } else if (/\s/.test(character)) {
            width++;
        } else {
            break;
        }
    }
    return width;
}

interface LineNode {
    lineIndex: number;
    text: string;
    /** Box contents if this line is a task, undefined if it is a note */
    status?: string;
    children: LineNode[];
}

/**
 * Builds a tree from the given lines based on indentation. A line's parent is the closest line above
 * it with a smaller indent. Blank lines are skipped and do not affect the structure.
 */
function buildLineTree(lines: string[], tabSize: number): LineNode[] {
    const roots: LineNode[] = [];
    const stack: { indent: number; node: LineNode }[] = [];

    lines.forEach((text, lineIndex) => {
        if (text.trim() === '') {
            return;
        }
        const indent = getIndentWidth(text, tabSize);
        while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
            stack.pop();
        }
        const match = text.match(TASK_REGEX);
        const node: LineNode = { lineIndex, text, status: match ? match[2] : undefined, children: [] };
        if (stack.length > 0) {
            stack[stack.length - 1].node.children.push(node);
        } else {
            roots.push(node);
        }
        stack.push({ indent, node });
    });

    return roots;
}

function isTask(node: LineNode) {
    return node.status !== undefined;
}

function isFinished(node: LineNode) {
    return node.status === 'x' || node.status === '-';
}

export interface StatusUpdate {
    /** Index into the lines that were passed in */
    lineIndex: number;
    /** Character range of the existing box, e.g. "[ ]" */
    boxStart: number;
    boxEnd: number;
    /** Replacement box, e.g. "[+]" */
    newBox: string;
}

/**
 * Given the lines of a single day, returns the box edits needed so every parent task's status
 * reflects its sub-tasks.
 *
 * A task's sub-tasks are the tasks indented under it, including tasks indented under one of its
 * notes. Tasks indented under a note that is not itself under a task have no parent task.
 */
export function computeParentStatusUpdates(lines: string[], tabSize: number): StatusUpdate[] {
    const updates: StatusUpdate[] = [];

    // Returns the statuses of the closest tasks within the given nodes (looking through notes),
    // after resolving each of those tasks' own statuses
    const resolveStatuses = (nodes: LineNode[]): string[] => {
        const statuses: string[] = [];
        for (const node of nodes) {
            if (isTask(node)) {
                statuses.push(resolveTask(node));
            } else {
                statuses.push(...resolveStatuses(node.children));
            }
        }
        return statuses;
    };

    const resolveTask = (task: LineNode): string => {
        const subtaskStatuses = resolveStatuses(task.children);
        if (subtaskStatuses.length === 0) {
            return task.status!;
        }
        const newStatus = computeCombinedStatus(subtaskStatuses);
        if (newStatus !== task.status) {
            const match = task.text.match(TASK_REGEX)!;
            updates.push({
                lineIndex: task.lineIndex,
                boxStart: match[1].length,
                boxEnd: match[0].length,
                newBox: '[' + newStatus + ']'
            });
        }
        return newStatus;
    };

    resolveStatuses(buildLineTree(lines, tabSize));
    return updates;
}

/**
 * Given the content of a day, returns the content to start the next day with:
 * - Open tasks are carried over with their box reset to [ ], along with their notes and open sub-tasks
 * - Finished tasks ([x] done or [-] removed) are dropped along with everything indented under them
 * - Top level notes are not carried over, unless open tasks are indented under them, in which case
 *   the note comes along as a heading for those tasks
 * - Blank lines are dropped
 */
export function carryOverDayContent(content: string, tabSize: number): string {
    // TODO a setting to preserve un-indented notes, not just tasks
    // TODO grab [ ] vs [] setting

    const output: string[] = [];

    const render = (node: LineNode) => {
        if (isFinished(node)) {
            return;
        }
        // Clear out any progress/blocked/etc markers
        output.push(isTask(node) ? node.text.replace(/\[.?\]/, '[ ]') : node.text);
        node.children.forEach(render);
    };

    const hasOpenTask = (node: LineNode): boolean =>
        node.children.some(child => isTask(child) ? !isFinished(child) : hasOpenTask(child));

    for (const root of buildLineTree(content.split(/\r?\n/), tabSize)) {
        if (isTask(root) || hasOpenTask(root)) {
            render(root);
        }
    }

    return output.join('\n');
}
