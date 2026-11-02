export function normalizeDescriptor(input: string): string {
  return input
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function descriptorWords(input: string): string[] {
  const normalized = normalizeDescriptor(input);
  return normalized ? normalized.split(" ") : [];
}

export function hasWord(words: string[], word: string): boolean {
  return words.includes(word);
}

export function hasPhrase(words: string[], phrase: string[]): boolean {
  if (phrase.length === 1) return words.includes(phrase[0]);
  for (let index = 0; index <= words.length - phrase.length; index += 1) {
    if (phrase.every((word, offset) => words[index + offset] === word)) return true;
  }
  return false;
}

export function matchesPattern(words: string[], phrase: string[]): boolean {
  if (hasPhrase(words, phrase)) return true;
  return phrase.length > 1 && phrase.every((word) => words.includes(word));
}
