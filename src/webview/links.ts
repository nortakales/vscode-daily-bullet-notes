// Links in task, note and list text: markdown links "[text](url)" and bare URLs. Pure, unit tested in Node.

export interface LinkRange {
    kind: 'markdown' | 'url';
    /** Character range of the whole link in the line ("[" to ")" for markdown links) */
    from: number;
    to: number;
    /** The visible text: between "[" and "](" for markdown links, the whole URL for bare URLs */
    textFrom: number;
    textTo: number;
    href: string;
}

const MARKDOWN_LINK_REGEX = /\[([^[\]\n]+)\]\(([^()\s]+)\)/g;
const BARE_URL_REGEX = /\b(?:[a-zA-Z][a-zA-Z0-9+.-]*:\/\/|mailto:)[^\s<>[\]()"'`]+/g;
/** Punctuation that ends a sentence rather than a URL */
const TRAILING_PUNCTUATION_REGEX = /[.,;:!?]+$/;
/** Bare URLs are only recognized with these schemes */
const URL_SCHEMES = /^https?:\/\/|^mailto:/i;

/** Markdown links and bare URLs in a line of text, sorted, from character `start` on */
export function findLinks(text: string, start = 0): LinkRange[] {
    const links: LinkRange[] = [];
    MARKDOWN_LINK_REGEX.lastIndex = start;
    for (let match = MARKDOWN_LINK_REGEX.exec(text); match; match = MARKDOWN_LINK_REGEX.exec(text)) {
        const from = match.index;
        links.push({ kind: 'markdown', from, to: from + match[0].length, textFrom: from + 1, textTo: from + 1 + match[1].length, href: match[2] });
    }
    BARE_URL_REGEX.lastIndex = start;
    for (let match = BARE_URL_REGEX.exec(text); match; match = BARE_URL_REGEX.exec(text)) {
        const url = match[0].replace(TRAILING_PUNCTUATION_REGEX, '');
        const from = match.index, to = from + url.length;
        if (!URL_SCHEMES.test(url) || url.length < 8 || links.some(link => link.kind === 'markdown' && from < link.to && to > link.from)) {
            continue;
        }
        links.push({ kind: 'url', from, to, textFrom: from, textTo: to, href: url });
    }
    return links.sort((a, b) => a.from - b.from);
}

/** The URL if the text (trimmed) is exactly one URL: scheme://... or mailto:..., with no whitespace */
export function singleUrl(text: string): string | undefined {
    const trimmed = text.trim();
    return /^(?:[a-zA-Z][a-zA-Z0-9+.-]*:\/\/\S+|mailto:\S+)$/.test(trimmed) ? trimmed : undefined;
}

/**
 * Pasting a URL over selected text makes a markdown link: the replacement for the selection, or undefined when
 * this paste isn't one (no URL, or the selection has brackets or a line break that would break the link)
 */
export function linkForPaste(selected: string, pasted: string): string | undefined {
    const url = singleUrl(pasted);
    if (!url || selected.length === 0 || /[[\]\n]/.test(selected)) {
        return undefined;
    }
    // Parentheses would end the link early
    return `[${selected}](${url.replace(/\(/g, '%28').replace(/\)/g, '%29')})`;
}
