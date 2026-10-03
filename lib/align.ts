import type { Candidate, Token } from "./types";

export interface AlignInput {
  tokens: Token[];
  position: number;
  heardWords: string[];
  alreadyOffered: Set<number>;
  /** Confirmed words after an unresolved candidate need not be read again. */
  confirmedTokenIds?: Set<number>;
}

export interface AlignResult {
  newPosition: number;
  /** Where Continue can resume, preserving words read after the candidate. */
  continuationPosition: number;
  candidate: Candidate | null;
  matchedTokenIds: number[];
}

export function nextUnreadPosition(
  tokens: Token[], position: number, confirmed: Set<number> = new Set(),
): number {
  return tokens.find((t) => t.id >= position && t.normalised && !confirmed.has(t.id))?.id
    ?? tokens.length;
}

/**
 * Incremental, bounded alignment. Exact prefixes always win, even when a word
 * occurs again later. A skip/substitution requires two following exact words;
 * ties, unsupported guesses and trailing mismatches wait for more evidence.
 * Sentence boundaries do not delimit speech. At most one help candidate is
 * returned, while clean words following it are retained for Retry/Continue.
 */
export function alignUtterance({
  tokens, position, heardWords, alreadyOffered, confirmedTokenIds = new Set(),
}: AlignInput): AlignResult {
  const expected = tokens.filter((t) =>
    t.id >= position && t.normalised && !confirmedTokenIds.has(t.id));
  const confirmed = new Set(confirmedTokenIds);
  const matchedTokenIds: number[] = [];
  let candidate: Candidate | null = null;
  let ei = 0;
  let hj = 0;
  let continuationPosition = nextUnreadPosition(tokens, position, confirmed);

  while (ei < expected.length && hj < heardWords.length) {
    const token = expected[ei];
    if (token.normalised === heardWords[hj]) {
      confirmed.add(token.id);
      matchedTokenIds.push(token.id);
      continuationPosition = nextUnreadPosition(tokens, token.id + 1, confirmed);
      ei++;
      hj++;
      continue;
    }

    // Harmless fillers and immediate repeats must not become corrections.
    const previous = ei > 0 ? expected[ei - 1].normalised
      : tokens.filter((t) => t.id < position && t.normalised).at(-1)?.normalised;
    if (["um", "uh"].includes(heardWords[hj]) || heardWords[hj] === previous) {
      hj++;
      continue;
    }

    const anchors: { expectedGap: number; heardGap: number; cost: number }[] = [];
    for (let expectedGap = 0; expectedGap <= 3; expectedGap++) {
      for (let heardGap = 0; heardGap <= 3; heardGap++) {
        if (!expectedGap && !heardGap) continue;
        const e = ei + expectedGap;
        const h = hj + heardGap;
        if (!expected[e] || h >= heardWords.length || expected[e].normalised !== heardWords[h]) continue;
        const twoMatches = expected[e + 1] && h + 1 < heardWords.length
          && expected[e + 1].normalised === heardWords[h + 1];
        // "dog ... cat" can be a single-word self-correction. No expected
        // words are skipped here, so a final exact word is sufficient.
        const correctedWord = expectedGap === 0 && h === heardWords.length - 1;
        if (twoMatches || correctedWord) {
          anchors.push({ expectedGap, heardGap, cost: expectedGap + heardGap });
        }
      }
    }
    anchors.sort((a, b) => a.cost - b.cost);
    const best = anchors[0];
    if (!best || anchors[1]?.cost === best.cost) break;

    if (best.expectedGap > 0) {
      const unoffered = expected.slice(ei, ei + best.expectedGap)
        .find((t) => !alreadyOffered.has(t.id));
      if (unoffered) {
        if (candidate) break;
        candidate = {
          tokenId: unoffered.id,
          expected: unoffered.display,
          heard: best.heardGap ? heardWords[hj] : "",
          kind: best.heardGap ? "substitution" : "skip",
        };
      }
      continuationPosition = nextUnreadPosition(tokens, expected[ei + best.expectedGap].id, confirmed);
    }
    ei += best.expectedGap;
    hj += best.heardGap;
  }

  return {
    newPosition: candidate?.tokenId ?? continuationPosition,
    continuationPosition,
    candidate,
    matchedTokenIds,
  };
}
