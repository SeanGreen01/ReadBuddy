import type { Token } from "./types";

/** Normalise a word for comparison: lowercase, strip surrounding punctuation
 * and common typographic marks, collapse curly quotes. Internal apostrophes
 * and hyphens are kept so "don't" and "well-known" stay intact. */
export function normaliseWord(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[‘’]/g, "'") // curly single quotes -> '
    .replace(/[“”]/g, '"') // curly double quotes
    .replace(/^[^a-z0-9]+/, "") // leading punctuation
    .replace(/[^a-z0-9]+$/, "") // trailing punctuation
    .trim();
}

/** Split a committed transcript into normalised words, dropping empties. */
export function normaliseTranscript(text: string): string[] {
  return text
    .split(/\s+/)
    .map(normaliseWord)
    .filter((w) => w.length > 0);
}

// Matches sentence terminators while keeping them attached to the sentence.
const SENTENCE_SPLIT = /[^.!?]+[.!?]*/g;

/**
 * Turn a passage string into a flat list of tokens with stable ids and
 * sentence ids. Punctuation-only tokens get a normalised form of "" so the
 * aligner can skip them.
 */
export function tokenisePassage(passage: string): Token[] {
  const tokens: Token[] = [];
  const sentences = passage.match(SENTENCE_SPLIT) ?? [passage];
  let id = 0;

  sentences.forEach((sentence, sentenceId) => {
    const words = sentence.trim().split(/\s+/).filter(Boolean);
    for (const word of words) {
      tokens.push({
        id: id++,
        sentenceId,
        display: word,
        normalised: normaliseWord(word),
      });
    }
  });

  return tokens;
}

/** Group a flat token list back into sentences for rendering. */
export function groupBySentence(tokens: Token[]): Token[][] {
  const sentences: Token[][] = [];
  for (const token of tokens) {
    (sentences[token.sentenceId] ??= []).push(token);
  }
  return sentences;
}
