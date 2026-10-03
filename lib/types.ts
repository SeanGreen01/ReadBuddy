// Shared types for the Read Along reading companion.
// These are intentionally small and serialisable so they can cross the
// browser <-> server-route boundary unchanged.

/** A single word of the passage, with its original display form and a
 * normalised form used only for matching against recognised speech. */
export interface Token {
  /** Stable index into the flattened passage token list. */
  id: number;
  /** Which sentence (0-based) this token belongs to. */
  sentenceId: number;
  /** The word exactly as it appears in the passage, incl. punctuation. */
  display: string;
  /** Lowercased, punctuation-stripped form for comparison. May be "" for
   * tokens that are pure punctuation and should be skipped when matching. */
  normalised: string;
}

/** A recognised chunk of speech coming from ElevenLabs Scribe. */
export interface TranscriptEvent {
  /** Reader session this event belongs to; stale sessions are ignored. */
  sessionId: string;
  /** Monotonic id for the utterance within the session. */
  utteranceId: string;
  text: string;
  /** true once the utterance is committed (speaker paused), false for partials. */
  final: boolean;
}

export type CandidateKind = "substitution" | "skip";

/** A single piece of pending help: the companion thinks the reader may have
 * said something other than the expected word at `tokenId`. */
export interface Candidate {
  tokenId: number;
  /** Expected (passage) word, display form. */
  expected: string;
  /** What we think we heard, if anything (empty for a skip). */
  heard: string;
  kind: CandidateKind;
}

export type ReaderStatus =
  | "idle" // not started
  | "starting" // requesting permission / opening a connection
  | "listening" // mic open, following along
  | "checking" // utterance committed, running alignment
  | "helping" // offering a candidate / speaking a prompt
  | "retrying" // mic reopened for a single-word retry
  | "paused" // companion audio playing; input ignored
  | "finished"; // reached end of passage

/** The full in-memory reader state. Kept in React state; no persistence. */
export interface ReaderState {
  status: ReaderStatus;
  /** Index of the next expected token in the flattened passage list. */
  position: number;
  /** Index of the sentence currently in focus. */
  activeSentenceId: number;
  pendingCandidate: Candidate | null;
  /** Token ids the reader has already successfully read. */
  readTokenIds: number[];
}

/** A word the reader practised during the session (for the summary list). */
export interface PracticedWord {
  tokenId: number;
  word: string;
  // "prompted" is recorded when help is first offered; it is upgraded if the
  // reader then retries, dismisses (Continue), or asks for an explanation.
  outcome: "prompted" | "retried" | "dismissed" | "explained";
}

/** Response shape of POST /api/coach. */
export interface CoachResponse {
  word: string;
  explanation: string;
  source: "model" | "fallback";
}
