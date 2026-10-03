import { CommitStrategy, RealtimeEvents, Scribe, type RealtimeConnection } from "@elevenlabs/client";
import { alignUtterance, nextUnreadPosition } from "./align";
import { normaliseTranscript, tokenisePassage } from "./normalize";
import { soundOut } from "./syllabify";
import { PASSAGES } from "./passages";
import type { Candidate, CoachResponse, PracticedWord, ReaderStatus, Token } from "./types";

const HELP_DELAY_MS = 1000;
const CONNECTION_TIMEOUT_MS = 20_000;
const REQUEST_TIMEOUT_MS = 15_000;

export interface SessionSnapshot {
  passageText: string;
  tokens: Token[];
  status: ReaderStatus;
  position: number;
  connected: boolean;
  readTokenIds: Set<number>;
  offeredTokenIds: Set<number>;
  pendingCandidate: Candidate | null;
  practiced: Map<number, PracticedWord>;
  partial: string;
  lastCommitted: string;
  coach: CoachResponse | null;
  spokenPrompt: string;
  connectionError: string | null;
  busy: boolean;
  assistanceEnabled: boolean;
}

/** Owns the resources for one reader. React subscribes to immutable snapshots;
 * callbacks retain their originating generation instead of reading a new ID.
 */
export class ReaderSession {
  private snapshot: SessionSnapshot;
  private listeners = new Set<() => void>();
  private generation = 0;
  private helpVersion = 0;
  private speechVersion = 0;
  private connection: RealtimeConnection | null = null;
  private helpTimer: ReturnType<typeof setTimeout> | null = null;
  private connectionTimer: ReturnType<typeof setTimeout> | null = null;
  private requests = new Map<AbortController, ReturnType<typeof setTimeout>>();
  private speechRequest: AbortController | null = null;
  private coachRequest: AbortController | null = null;
  private audio: HTMLAudioElement | null = null;
  private audioUrl: string | null = null;
  private continuationPosition = 0;
  private retryCandidate: Candidate | null = null;

  constructor(text = PASSAGES[0].text) {
    const tokens = tokenisePassage(text);
    this.snapshot = {
      passageText: text, tokens, status: "idle",
      position: nextUnreadPosition(tokens, 0), connected: false,
      readTokenIds: new Set(), offeredTokenIds: new Set(),
      pendingCandidate: null, practiced: new Map(), partial: "", lastCommitted: "",
      coach: null, spokenPrompt: "", connectionError: null, busy: false,
      assistanceEnabled: true,
    };
  }

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private update(change: Partial<SessionSnapshot>) {
    this.snapshot = { ...this.snapshot, ...change };
    this.listeners.forEach((listener) => listener());
  }
  private clearHelpTimer() {
    if (this.helpTimer) clearTimeout(this.helpTimer);
    this.helpTimer = null;
  }
  private clearConnectionTimer() {
    if (this.connectionTimer) clearTimeout(this.connectionTimer);
    this.connectionTimer = null;
  }
  private request() {
    const controller = new AbortController();
    this.requests.set(controller, setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS));
    return controller;
  }
  private releaseRequest(controller: AbortController | null) {
    if (!controller) return;
    clearTimeout(this.requests.get(controller));
    this.requests.delete(controller);
  }
  private cancelRequest(controller: AbortController | null) {
    controller?.abort();
    this.releaseRequest(controller);
  }
  private releaseAudio() {
    if (this.audio) {
      this.audio.onended = null;
      this.audio.onerror = null;
      this.audio.pause();
      this.audio = null;
    }
    if (this.audioUrl) URL.revokeObjectURL(this.audioUrl);
    this.audioUrl = null;
  }
  private cancelHelp() {
    this.helpVersion++;
    this.speechVersion++;
    this.clearHelpTimer();
    this.cancelRequest(this.speechRequest);
    this.cancelRequest(this.coachRequest);
    this.speechRequest = null;
    this.coachRequest = null;
    this.releaseAudio();
  }
  private closeResources() {
    // Invalidate first: close() may synchronously emit a callback.
    this.generation++;
    this.cancelHelp();
    this.clearConnectionTimer();
    for (const controller of this.requests.keys()) this.cancelRequest(controller);
    const connection = this.connection;
    this.connection = null;
    connection?.close();
    this.retryCandidate = null;
  }
  stop = () => {
    this.closeResources();
    this.update({ status: "idle", connected: false, busy: false,
      pendingCandidate: null, coach: null, partial: "", spokenPrompt: "" });
  };
  dispose = () => { this.stop(); };
  private finish() {
    this.closeResources();
    this.update({ status: "finished", position: this.snapshot.tokens.length,
      connected: false, busy: false, pendingCandidate: null, coach: null,
      partial: "", spokenPrompt: "" });
  }
  loadPassage = (text: string) => {
    const tokens = tokenisePassage(text);
    if (!tokens.some((t) => t.normalised)) {
      this.update({ connectionError: "Please enter a passage containing words." });
      return false;
    }
    this.closeResources();
    this.update({ passageText: text, tokens, status: "idle", connected: false,
      position: nextUnreadPosition(tokens, 0), readTokenIds: new Set(),
      offeredTokenIds: new Set(), practiced: new Map(), pendingCandidate: null,
      coach: null, spokenPrompt: "", partial: "", lastCommitted: "",
      connectionError: null, busy: false });
    return true;
  };

  start = async () => {
    if (!["idle", "finished"].includes(this.snapshot.status)) return;
    if (!this.snapshot.tokens.some((t) => t.normalised)) {
      this.update({ connectionError: "Please enter a passage containing words." });
      return;
    }
    if (this.snapshot.status === "finished") this.loadPassage(this.snapshot.passageText);
    this.closeResources();
    const generation = this.generation;
    this.update({ status: "starting", busy: true, connectionError: null });
    const controller = this.request();
    try {
      const response = await fetch("/api/scribe-token", { method: "POST", signal: controller.signal });
      const body = await response.json();
      if (generation !== this.generation) return;
      if (!response.ok || typeof body?.token !== "string") {
        throw new Error(body?.error || "Could not start the microphone.");
      }
      const connection = Scribe.connect({ token: body.token, modelId: "scribe_v2_realtime",
        commitStrategy: CommitStrategy.VAD, languageCode: "en",
        microphone: { echoCancellation: true, noiseSuppression: true } });
      this.connection = connection;
      const current = () => generation === this.generation && this.connection === connection;
      connection.on(RealtimeEvents.SESSION_STARTED, () => {
        if (!current()) return;
        this.clearConnectionTimer();
        this.update({ status: "listening", connected: true, busy: false });
      });
      connection.on(RealtimeEvents.PARTIAL_TRANSCRIPT, ({ text }) => {
        if (!current() || !this.acceptsSpeech()) return;
        if (normaliseTranscript(text).length) {
          this.clearHelpTimer();
          if (this.snapshot.status === "checking") this.update({ status: "listening" });
        }
        this.update({ partial: text });
      });
      connection.on(RealtimeEvents.COMMITTED_TRANSCRIPT, ({ text }) => {
        if (current() && this.acceptsSpeech()) this.handleCommitted(text);
      });
      connection.on(RealtimeEvents.ERROR, (error) => {
        if (current()) this.fail(error.error || "Could not connect to the microphone.");
      });
      connection.on(RealtimeEvents.CLOSE, () => {
        if (current()) this.fail("Microphone disconnected. Press Start to reconnect.");
      });
      this.connectionTimer = setTimeout(() => {
        if (current()) this.fail("Microphone connection timed out. Please try again.");
      }, CONNECTION_TIMEOUT_MS);
    } catch (error) {
      if (generation === this.generation) {
        this.fail(controller.signal.aborted ? "Microphone connection timed out. Please try again."
          : error instanceof Error ? error.message : "Could not start listening.");
      }
    } finally {
      this.releaseRequest(controller);
    }
  };
  private fail(message: string) {
    this.stop();
    this.update({ connectionError: message });
  }
  private acceptsSpeech() {
    return ["listening", "checking", "helping", "retrying"].includes(this.snapshot.status);
  }

  private handleCommitted(text: string) {
    const heardWords = normaliseTranscript(text);
    if (!heardWords.length) return;
    const outstanding = this.snapshot.pendingCandidate;
    this.cancelHelp();
    const result = alignUtterance({ tokens: this.snapshot.tokens,
      position: this.snapshot.position, heardWords,
      alreadyOffered: this.snapshot.offeredTokenIds,
      confirmedTokenIds: this.snapshot.readTokenIds });
    const readTokenIds = new Set(this.snapshot.readTokenIds);
    result.matchedTokenIds.forEach((id) => readTokenIds.add(id));
    if (this.retryCandidate && readTokenIds.has(this.retryCandidate.tokenId)) {
      this.recordPractice(this.retryCandidate, "retried");
      this.retryCandidate = null;
    }
    this.continuationPosition = result.continuationPosition;
    this.update({ position: result.newPosition, readTokenIds, pendingCandidate: null,
      coach: null, busy: false, partial: "", lastCommitted: text, spokenPrompt: "" });
    if (result.newPosition >= this.snapshot.tokens.length) { this.finish(); return; }
    if (!result.candidate) {
      // Keep manual controls available when a retry is inconclusive. Silence
      // or uncertain recognition must not trap the reader on a word.
      const unresolved = outstanding && result.newPosition <= outstanding.tokenId;
      this.update({ pendingCandidate: unresolved ? outstanding : null,
        status: unresolved ? (this.retryCandidate ? "retrying" : "helping") : "listening" });
      return;
    }
    if (!this.snapshot.assistanceEnabled) {
      this.advance(result.continuationPosition);
      return;
    }
    this.update({ status: "checking" });
    const generation = this.generation;
    const version = this.helpVersion;
    const candidate = result.candidate;
    this.helpTimer = setTimeout(() => {
      this.helpTimer = null;
      if (generation !== this.generation || version !== this.helpVersion) return;
      const offeredTokenIds = new Set(this.snapshot.offeredTokenIds).add(candidate.tokenId);
      // Record the struggle the moment help is offered, so the practice list
      // captures it even if the reader just re-reads without pressing a button.
      this.recordPractice(candidate, "prompted");
      this.update({ pendingCandidate: candidate, offeredTokenIds, status: "helping" });
      // Reassure, name the specific word, and invite a repeat — no button press.
      void this.speak(
        `That's okay. The word here is ${candidate.expected}. ` +
          `Let's try it again — can you say ${candidate.expected}?`
      );
    }, HELP_DELAY_MS);
  }

  private resumeListening() {
    if (!this.connection) return;
    try {
      if (this.connection.isMuted) this.connection.unmute();
      this.update({ status: this.retryCandidate ? "retrying"
        : this.snapshot.pendingCandidate ? "helping" : "listening" });
    } catch {
      this.fail("Could not resume the microphone. Press Start to reconnect.");
    }
  }
  private speak = async (text: string) => {
    this.cancelRequest(this.speechRequest);
    this.releaseAudio();
    const version = ++this.speechVersion;
    const generation = this.generation;
    const current = () => generation === this.generation && version === this.speechVersion;
    const controller = this.request();
    this.speechRequest = controller;
    this.update({ spokenPrompt: text, status: "paused" });
    const complete = (error = false) => {
      if (!current()) return;
      this.releaseAudio();
      if (error) this.update({ connectionError: "Could not play spoken audio. You can keep reading." });
      this.resumeListening();
    };
    try {
      // Disable the microphone track, rather than merely ignoring callbacks.
      this.connection?.mute();
      const response = await fetch("/api/speak", { method: "POST", signal: controller.signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
      if (!current()) return;
      if (!response.ok) throw new Error("Speech request failed");
      const blob = await response.blob();
      if (!current()) return;
      this.audioUrl = URL.createObjectURL(blob);
      this.audio = new Audio(this.audioUrl);
      this.audio.onended = () => complete();
      this.audio.onerror = () => complete(true);
      await this.audio.play();
    } catch {
      complete(true);
    } finally {
      this.releaseRequest(controller);
      if (this.speechRequest === controller) this.speechRequest = null;
    }
  };
  private recordPractice(candidate: Candidate, outcome: PracticedWord["outcome"]) {
    const practiced = new Map(this.snapshot.practiced);
    practiced.set(candidate.tokenId, { tokenId: candidate.tokenId, word: candidate.expected, outcome });
    this.update({ practiced });
  }
  private advance(position: number) {
    this.update({ position: nextUnreadPosition(this.snapshot.tokens, position, this.snapshot.readTokenIds) });
    if (this.snapshot.position >= this.snapshot.tokens.length) this.finish();
    else this.resumeListening();
  }
  retry = () => {
    const candidate = this.snapshot.pendingCandidate;
    if (!candidate) return;
    this.cancelHelp();
    this.retryCandidate = candidate;
    this.update({ coach: null, busy: false, spokenPrompt: "" });
    this.resumeListening();
  };
  continueReading = () => {
    const candidate = this.snapshot.pendingCandidate;
    if (!candidate) return;
    this.recordPractice(candidate, "dismissed");
    this.cancelHelp();
    this.retryCandidate = null;
    this.update({ pendingCandidate: null, coach: null, busy: false, spokenPrompt: "" });
    this.advance(Math.max(candidate.tokenId + 1, this.continuationPosition));
  };
  hearWord = () => {
    const candidate = this.snapshot.pendingCandidate;
    if (!candidate) return;
    this.cancelHelp();
    this.update({ busy: false });
    void this.speak(candidate.expected);
  };
  explain = async () => {
    const candidate = this.snapshot.pendingCandidate;
    if (!candidate) return;
    this.cancelHelp();
    this.recordPractice(candidate, "explained");
    if (!this.connection) return;
    const version = this.helpVersion;
    const generation = this.generation;
    const current = () => generation === this.generation && version === this.helpVersion;
    const controller = this.request();
    this.coachRequest = controller;
    this.update({ busy: true, coach: null });
    // Start the (slow) model request first so it's in flight, then give the
    // reader instant, offline pronunciation help without waiting on it.
    const sentenceId = this.snapshot.tokens[candidate.tokenId].sentenceId;
    const sentence = this.snapshot.tokens.filter((t) => t.sentenceId === sentenceId)
      .map((t) => t.display).join(" ");
    const coachRequest = fetch("/api/coach", { method: "POST", signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ word: candidate.expected, sentence }) });
    const guide = soundOut(candidate.expected);
    const lead = guide.mode === "syllables" ? "Let's sound it out" : "Let's spell it out";
    void this.speak(`${lead}: ${guide.spoken}.`);
    try {
      const response = await coachRequest;
      if (!current()) return;
      if (!response.ok) throw new Error("Explanation request failed");
      const data = await response.json() as CoachResponse;
      if (!current()) return;
      if (!data || typeof data.explanation !== "string" || !data.explanation.trim()
        || data.word !== candidate.expected || !["model", "fallback"].includes(data.source)) {
        throw new Error("Invalid explanation");
      }
      // The meaning follows once ready; the sound-out has already been spoken.
      this.update({ coach: data });
      void this.speak(data.explanation);
    } catch {
      if (current()) this.update({ connectionError: "Could not fetch an explanation. You can keep reading." });
    } finally {
      this.releaseRequest(controller);
      if (this.coachRequest === controller) this.coachRequest = null;
      if (current()) this.update({ busy: false });
    }
  };
  setAssistance = (enabled: boolean) => {
    this.update({ assistanceEnabled: enabled });
    if (!enabled && (this.helpTimer || this.snapshot.pendingCandidate)) {
      this.cancelHelp();
      this.update({ pendingCandidate: null, coach: null, busy: false, spokenPrompt: "" });
      this.advance(this.continuationPosition);
    }
  };
}
