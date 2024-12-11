import { UrlWithStringQuery } from "url";

function findAllStartIndicesOfAnagrams(mainString: string, anagramString: string) {

    const startIndices: number[] = [];
    const allAnagrams = getAllAnagramsOfString(anagramString);

    for (let anagram of allAnagrams) {
        let lastIndex = 0;
        while (lastIndex > -1) {
            lastIndex = mainString.indexOf(anagram, lastIndex);
            if (lastIndex > -1) {
                startIndices.push(lastIndex);
                lastIndex++;
            }
        }
    }

    return startIndices;
}

function getAllAnagramsOfString(string: string) {

    if (string.length === 1) {
        return [string];
    }

    const anagrams: string[] = [];
    const allCharacters = string.split(''); // Don't modify this!

    // Brute force, start a word with each letter, then recurse with remaining letters
    for (let [index, character] of allCharacters.entries()) {
        let remainingCharacters = allCharacters.slice(0, index).concat(allCharacters.slice(index + 1, allCharacters.length));
        const substringAnagrams = getAllAnagramsOfString(remainingCharacters.join(''));
        for (let anagram of substringAnagrams) {
            anagrams.push(character + anagram);
        }
    }
    return anagrams;
}

//console.log(getAllAnagramsOfString("abc"));

console.log(findAllStartIndicesOfAnagrams('tacocat', 'cat'));