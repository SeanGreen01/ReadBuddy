import { describe, expect, it } from "vitest";
import { alignUtterance } from "../lib/align";
import { normaliseTranscript, tokenisePassage } from "../lib/normalize";

function align(passage: string, heard: string, position = 0, confirmed = new Set<number>()) {
  return alignUtterance({ tokens: tokenisePassage(passage), heardWords: normaliseTranscript(heard),
    position, alreadyOffered: new Set(), confirmedTokenIds: confirmed });
}

describe("incremental reading alignment", () => {
  it.each(["the", "the cat", "the cat sat", "the cat sat on", "the cat sat on the"])(
    "accepts the correct prefix '%s' without inventing skipped words", (heard) => {
      const result = align("The cat sat on the mat.", heard);
      expect(result.candidate).toBeNull();
      expect(result.newPosition).toBe(heard.split(" ").length);
    });
  it("preserves all progress across sentence boundaries", () => {
    const result = align("The cat sat. The dog ran.", "the cat sat the dog ran");
    expect(result.newPosition).toBe(6);
    expect(result.matchedTokenIds).toEqual([0, 1, 2, 3, 4, 5]);
    expect(result.candidate).toBeNull();
  });
  it("does not treat silence or unrelated speech as an error", () => {
    for (const heard of ["", "hello there", "dog"]) {
      expect(align("The cat sat.", heard)).toMatchObject({ newPosition: 0, candidate: null });
    }
  });
  it("ignores fillers and immediate repetitions", () => {
    expect(align("The cat sat.", "um the the cat uh cat sat"))
      .toMatchObject({ newPosition: 3, candidate: null });
  });
  it("accepts self-correction within an utterance", () => {
    expect(align("The cat sat.", "the dog cat sat"))
      .toMatchObject({ newPosition: 3, candidate: null });
  });
  it("accepts a single corrected word without demanding later words", () => {
    expect(align("The cat sat.", "dog cat", 1))
      .toMatchObject({ newPosition: 2, candidate: null });
  });
  it("requires following evidence before suggesting a substitution", () => {
    expect(align("The cat sat on the mat.", "the dog"))
      .toMatchObject({ newPosition: 1, candidate: null });
    const result = align("The cat sat on the mat.", "the dog sat on the mat");
    expect(result).toMatchObject({ newPosition: 1, continuationPosition: 6,
      candidate: { tokenId: 1, expected: "cat", heard: "dog", kind: "substitution" } });
    expect(result.matchedTokenIds).toEqual([0, 2, 3, 4, 5]);
  });
  it("detects a skip with two following matches", () => {
    expect(align("The cat sat on the mat.", "the sat on the mat"))
      .toMatchObject({ newPosition: 1, continuationPosition: 6,
        candidate: { tokenId: 1, kind: "skip" } });
  });
  it("waits when a mismatch has only one supporting word", () => {
    expect(align("The cat sat on the mat.", "the dog sat"))
      .toMatchObject({ newPosition: 1, candidate: null });
  });
  it("keeps equally plausible alignments unresolved", () => {
    expect(align("a b a.", "b a b"))
      .toMatchObject({ newPosition: 0, candidate: null });
  });
  it("retains words after a candidate when the reader retries", () => {
    const passage = "The cat sat on the mat.";
    const initial = align(passage, "the dog sat on the mat");
    expect(align(passage, "cat", 1, new Set(initial.matchedTokenIds)))
      .toMatchObject({ newPosition: 6, candidate: null, matchedTokenIds: [1] });
  });
  it("skips punctuation-only tokens at the end", () => {
    expect(align("Go home —", "go home"))
      .toMatchObject({ newPosition: 3, candidate: null });
  });
  it("skips standalone punctuation between sentences", () => {
    expect(align("Go home. — Come back.", "go home come back"))
      .toMatchObject({ newPosition: 5, candidate: null });
  });
  it("does not re-offer an already offered word", () => {
    const result = alignUtterance({ tokens: tokenisePassage("The cat sat on the mat."),
      heardWords: normaliseTranscript("the dog sat on the mat"), position: 0,
      alreadyOffered: new Set([1]) });
    expect(result).toMatchObject({ newPosition: 6, candidate: null });
  });
});
