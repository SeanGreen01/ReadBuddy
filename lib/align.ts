import type { Candidate, Token } from "./types";

/**
 * Sequence alignment for "follow known text".
 *
 * We align the words we *heard* (normalised, committed) against the expected
 * tokens of the active sentence, starting at the reader's current position.
 * From the alignment we derive:
 *   - how far the reading position should advance (only across clean matches)
 *   - at most ONE help candidate (the earliest likely mismatch)
 *
 * Design rules drawn from the product spec:
 *   - Offer at most one intervention per committed utterance.
 *   - Keep the position stable when alignment is ambiguous; don't guess hard.
 *   - Silence / stopping early is never an error.
 *   - Never re-offer a word already offered or dismissed (`alreadyOffered`).
 *   - Extra/filler heard words and simple repeats are ignored (insertions).
 */

export interface AlignInput {
  /** Matchable tokens of the active sentence (punctuation-only already filtered). */
  sentenceTokens: Token[];
  /** Current global token position (id into the full passage). */
  position: number;
  /** Normalised words from the committed utterance. */
  heardWords: string[];
  /** Token ids we've already offered help on; don't offer again. */
  alreadyOffered: Set<number>;
}

export interface AlignResult {
  /** New global position (id of the next expected token). */
  newPosition: number;
  /** At most one pending help candidate, or null. */
  candidate: Candidate | null;
  /** Token ids newly confirmed as correctly read this utterance. */
  matchedTokenIds: number[];
}

type Op =
  | { type: "match"; ei: number; hj: number }
  | { type: "sub"; ei: number; hj: number }
  | { type: "del"; ei: number } // expected word not heard
  | { type: "ins"; hj: number }; // extra heard word

const MATCH = 2;
const MISMATCH = -1;
const GAP = -1;

/** Global (Needleman–Wunsch) alignment, returns ops start-to-end. */
function align(expected: string[], heard: string[]): Op[] {
  const n = expected.length;
  const m = heard.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0)
  );
  for (let i = 1; i <= n; i++) dp[i][0] = i * GAP;
  for (let j = 1; j <= m; j++) dp[0][j] = j * GAP;

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const diagScore =
        dp[i - 1][j - 1] + (expected[i - 1] === heard[j - 1] ? MATCH : MISMATCH);
      const delScore = dp[i - 1][j] + GAP;
      const insScore = dp[i][j - 1] + GAP;
      dp[i][j] = Math.max(diagScore, delScore, insScore);
    }
  }

  // Traceback, then reverse to get start-to-end order.
  const ops: Op[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const equal = expected[i - 1] === heard[j - 1];
      const diagScore = dp[i - 1][j - 1] + (equal ? MATCH : MISMATCH);
      if (dp[i][j] === diagScore) {
        ops.push({ type: equal ? "match" : "sub", ei: i - 1, hj: j - 1 });
        i--;
        j--;
        continue;
      }
    }
    if (i > 0 && dp[i][j] === dp[i - 1][j] + GAP) {
      ops.push({ type: "del", ei: i - 1 });
      i--;
      continue;
    }
    ops.push({ type: "ins", hj: j - 1 });
    j--;
  }
  return ops.reverse();
}

export function alignUtterance(input: AlignInput): AlignResult {
  const { sentenceTokens, position, heardWords, alreadyOffered } = input;

  // Expected window: tokens of the active sentence from `position` onward.
  const expectedTokens = sentenceTokens.filter((t) => t.id >= position);
  const expected = expectedTokens.map((t) => t.normalised);

  const matchedTokenIds: number[] = [];
  let newPosition = position;

  // Nothing expected (end of sentence) or nothing heard: no change, no help.
  if (expected.length === 0 || heardWords.length === 0) {
    return { newPosition, candidate: null, matchedTokenIds };
  }

  const ops = align(expected, heardWords);

  // Precompute whether a real match occurs at or after each op index, so a
  // "del" is only treated as a genuine skip when the reader actually moved on.
  const matchAfter: boolean[] = new Array(ops.length + 1).fill(false);
  for (let k = ops.length - 1; k >= 0; k--) {
    matchAfter[k] = matchAfter[k + 1] || ops[k].type === "match";
  }

  for (let k = 0; k < ops.length; k++) {
    const op = ops[k];

    if (op.type === "ins") {
      // Extra heard word (filler, repeat, recognition noise) — ignore.
      continue;
    }

    if (op.type === "match") {
      const token = expectedTokens[op.ei];
      matchedTokenIds.push(token.id);
      newPosition = token.id + 1;
      continue;
    }

    if (op.type === "sub") {
      const token = expectedTokens[op.ei];
      if (alreadyOffered.has(token.id)) {
        // Already helped on this word; don't stall — move past it.
        newPosition = token.id + 1;
        continue;
      }
      return {
        newPosition: token.id, // hold position on the problem word
        candidate: {
          tokenId: token.id,
          expected: token.display,
          heard: heardWords[op.hj],
          kind: "substitution",
        },
        matchedTokenIds,
      };
    }

    // op.type === "del": expected word wasn't heard.
    const token = expectedTokens[op.ei];
    if (!matchAfter[k]) {
      // No later match — the reader simply stopped/paused here. Not an error.
      newPosition = token.id;
      break;
    }
    if (alreadyOffered.has(token.id)) {
      newPosition = token.id + 1; // skip past a word already offered
      continue;
    }
    return {
      newPosition: token.id,
      candidate: {
        tokenId: token.id,
        expected: token.display,
        heard: "",
        kind: "skip",
      },
      matchedTokenIds,
    };
  }

  return { newPosition, candidate: null, matchedTokenIds };
}
