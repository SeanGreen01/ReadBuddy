import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RealtimeEvents, Scribe } from "@elevenlabs/client";
import { ReaderSession } from "../lib/reader-session";

vi.mock("@elevenlabs/client", () => ({
  CommitStrategy: { VAD: "vad" },
  RealtimeEvents: { SESSION_STARTED: "ready", PARTIAL_TRANSCRIPT: "partial",
    COMMITTED_TRANSCRIPT: "committed", ERROR: "error", CLOSE: "close" },
  Scribe: { connect: vi.fn() },
}));

// Keep listeners after close deliberately: late callbacks must be harmless even
// if an SDK/socket dispatch already had an event queued before cancellation.
class Connection {
  handlers = new Map<string, (payload: never) => void>();
  isMuted = false;
  on = vi.fn((event: string, handler: (payload: never) => void) => this.handlers.set(event, handler));
  close = vi.fn(() => this.emit(RealtimeEvents.CLOSE));
  mute = vi.fn(() => { this.isMuted = true; });
  unmute = vi.fn(() => { this.isMuted = false; });
  emit(event: string, payload: unknown = {}) { this.handlers.get(event)?.(payload as never); }
  say(text: string) { this.emit(RealtimeEvents.COMMITTED_TRANSCRIPT, { text }); }
}
class Playback {
  static instances: Playback[] = [];
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  play = vi.fn(async () => {});
  pause = vi.fn();
  constructor() { Playback.instances.push(this); }
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "Content-Type": "application/json" },
});
const audioResponse = () => new Response(new Blob(["audio"], { type: "audio/mpeg" }));
let session: ReaderSession;
let connections: Connection[];
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
async function start() {
  await session.start();
  const connection = connections.at(-1)!;
  connection.emit(RealtimeEvents.SESSION_STARTED);
  return connection;
}
async function offer(connection: Connection) {
  connection.say("the dog sat on the mat");
  await vi.advanceTimersByTimeAsync(1000);
}

beforeEach(() => {
  vi.useFakeTimers();
  Playback.instances = [];
  connections = [];
  vi.mocked(Scribe.connect).mockImplementation(() => {
    const connection = new Connection();
    connections.push(connection);
    return connection as unknown as ReturnType<typeof Scribe.connect>;
  });
  fetchMock = vi.fn<typeof fetch>(async (url) => {
    if (url === "/api/scribe-token") return json({ token: "temporary-token" });
    if (url === "/api/speak") return audioResponse();
    return json({ word: "cat", explanation: "A cat is an animal.", source: "model" });
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("Audio", Playback);
  vi.stubGlobal("URL", Object.assign(URL, {
    createObjectURL: vi.fn(() => "blob:test"), revokeObjectURL: vi.fn(),
  }));
  session = new ReaderSession("The cat sat on the mat.");
});
afterEach(() => {
  session.dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("reader session lifecycle", () => {
  it("closes the microphone on completion and resets on Read again", async () => {
    const first = await start();
    first.say("the cat sat on the mat");
    expect(first.close).toHaveBeenCalledOnce();
    expect(session.getSnapshot()).toMatchObject({ status: "finished", connected: false, position: 6 });
    const second = await start();
    expect(second).not.toBe(first);
    expect(session.getSnapshot()).toMatchObject({ status: "listening", position: 0 });
    expect(session.getSnapshot().readTokenIds.size).toBe(0);
    first.say("the cat sat on the mat");
    first.emit(RealtimeEvents.ERROR, { error: "old failure" });
    expect(session.getSnapshot()).toMatchObject({ status: "listening", position: 0, connectionError: null });
  });
  it("stops while fetching a token, even if fetch resolves after abort", async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);
    const starting = session.start();
    expect(session.getSnapshot().status).toBe("starting");
    session.stop();
    expect((fetchMock.mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true);
    pending.resolve(json({ token: "late" }));
    await starting;
    expect(connections).toHaveLength(0);
    expect(session.getSnapshot().status).toBe("idle");
  });
  it("closes a connecting microphone and ignores a late ready event", async () => {
    await session.start();
    const connection = connections[0];
    session.stop();
    connection.emit(RealtimeEvents.SESSION_STARTED);
    expect(connection.close).toHaveBeenCalledOnce();
    expect(session.getSnapshot()).toMatchObject({ status: "idle", connected: false });
  });
  it("does not allow a late old token to replace a new session", async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);
    const oldStart = session.start();
    session.stop();
    const current = await start();
    pending.resolve(json({ token: "late" }));
    await oldStart;
    expect(connections).toHaveLength(1);
    expect(current.close).not.toHaveBeenCalled();
    expect(session.getSnapshot().status).toBe("listening");
  });
  it("prevents double starts", async () => {
    await Promise.all([session.start(), session.start()]);
    expect(connections).toHaveLength(1);
  });
  it("cancels a pending speech response on Stop", async () => {
    const connection = await start();
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);
    await offer(connection);
    expect(connection.mute).toHaveBeenCalledOnce();
    session.stop();
    pending.resolve(audioResponse());
    await vi.advanceTimersByTimeAsync(0);
    expect(Playback.instances).toHaveLength(0);
    expect(session.getSnapshot().status).toBe("idle");
  });
  it("stops playing audio, revokes its URL, and ignores its queued end event", async () => {
    const connection = await start();
    await offer(connection);
    const audio = Playback.instances[0];
    const ended = audio.onended;
    session.stop();
    ended?.();
    expect(audio.pause).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test");
    expect(session.getSnapshot()).toMatchObject({ status: "idle", connected: false });
  });
  it("mutes during speech and unmutes when playback ends", async () => {
    const connection = await start();
    await offer(connection);
    expect(connection.isMuted).toBe(true);
    connection.say("cat");
    expect(session.getSnapshot().position).toBe(1);
    Playback.instances[0].onended?.();
    expect(connection.isMuted).toBe(false);
    expect(session.getSnapshot().status).toBe("helping");
  });
  it("recovers from audio playback errors", async () => {
    const connection = await start();
    await offer(connection);
    Playback.instances[0].onerror?.();
    expect(connection.isMuted).toBe(false);
    expect(session.getSnapshot().status).toBe("helping");
    expect(session.getSnapshot().connectionError).toContain("Could not play");
  });
  it("drops late explanations after changing passages", async () => {
    const connection = await start();
    await offer(connection);
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);
    const explaining = session.explain();
    session.loadPassage("Go home.");
    pending.resolve(json({ word: "cat", explanation: "Late explanation", source: "model" }));
    await explaining;
    expect(session.getSnapshot()).toMatchObject({ status: "idle", passageText: "Go home.", coach: null });
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/speak")).toHaveLength(1);
  });
  it("drops late explanations after Continue and finishes", async () => {
    const connection = await start();
    await offer(connection);
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);
    const explaining = session.explain();
    session.continueReading();
    pending.resolve(json({ word: "cat", explanation: "Late explanation", source: "model" }));
    await explaining;
    expect(session.getSnapshot()).toMatchObject({ status: "finished", coach: null, busy: false });
    expect(connection.close).toHaveBeenCalledOnce();
  });
  it("does not speak an unsuccessful explanation response", async () => {
    const connection = await start();
    await offer(connection);
    fetchMock.mockResolvedValueOnce(json({ error: "Unavailable" }, 502));
    await session.explain();
    expect(session.getSnapshot().coach).toBeNull();
    expect(session.getSnapshot().connectionError).toContain("Could not fetch");
    expect(session.getSnapshot().busy).toBe(false);
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/speak")).toHaveLength(1);
  });
  it("postpones help when the reader begins correcting themselves", async () => {
    const connection = await start();
    connection.say("the dog sat on the mat");
    await vi.advanceTimersByTimeAsync(500);
    connection.emit(RealtimeEvents.PARTIAL_TRANSCRIPT, { text: "cat" });
    await vi.advanceTimersByTimeAsync(2000);
    expect(Playback.instances).toHaveLength(0);
    connection.say("cat");
    expect(session.getSnapshot().status).toBe("finished");
  });
  it("empty partials do not suppress valid pending help", async () => {
    const connection = await start();
    connection.say("the dog sat on the mat");
    connection.emit(RealtimeEvents.PARTIAL_TRANSCRIPT, { text: "" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(session.getSnapshot().pendingCandidate?.expected).toBe("cat");
  });
  it("Retry cancels audio and only records practice after hearing the word", async () => {
    const connection = await start();
    await offer(connection);
    session.retry();
    expect(Playback.instances[0].pause).toHaveBeenCalled();
    expect(connection.isMuted).toBe(false);
    expect(session.getSnapshot().practiced.size).toBe(0);
    connection.say("cat");
    expect(session.getSnapshot().status).toBe("finished");
    expect(session.getSnapshot().practiced.get(1)?.outcome).toBe("retried");
  });
  it("keeps Continue available after an inconclusive retry", async () => {
    const connection = await start();
    await offer(connection);
    session.retry();
    connection.say("dog");
    expect(session.getSnapshot()).toMatchObject({ status: "retrying",
      pendingCandidate: { expected: "cat" } });
    session.continueReading();
    expect(session.getSnapshot().status).toBe("finished");
  });
  it("ignores speech from an old passage after a new one starts", async () => {
    const oldConnection = await start();
    session.loadPassage("Go home.");
    const current = await start();
    oldConnection.say("go home");
    oldConnection.emit(RealtimeEvents.PARTIAL_TRANSCRIPT, { text: "old partial" });
    expect(session.getSnapshot()).toMatchObject({ position: 0, partial: "" });
    current.say("go home");
    expect(session.getSnapshot().status).toBe("finished");
  });
  it("cancels explanations on Stop even if the response still resolves", async () => {
    const connection = await start();
    await offer(connection);
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);
    const explaining = session.explain();
    const signal = fetchMock.mock.calls.at(-1)?.[1]?.signal as AbortSignal;
    session.stop();
    expect(signal.aborted).toBe(true);
    pending.resolve(json({ word: "cat", explanation: "Late explanation", source: "model" }));
    await explaining;
    expect(session.getSnapshot()).toMatchObject({ status: "idle", coach: null, busy: false });
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/speak")).toHaveLength(1);
  });
  it("completes with assistance disabled even when the utterance has a mismatch", async () => {
    session.setAssistance(false);
    const connection = await start();
    connection.say("the dog sat on the mat");
    expect(session.getSnapshot().status).toBe("finished");
    expect(connection.close).toHaveBeenCalledOnce();
  });
  it("disabling assistance cancels pending help", async () => {
    const connection = await start();
    connection.say("the dog sat on the mat");
    session.setAssistance(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(Playback.instances).toHaveLength(0);
    expect(session.getSnapshot().status).toBe("finished");
  });
  it("rejects an empty passage without interrupting an existing session", async () => {
    const connection = await start();
    expect(session.loadPassage(" — ")).toBe(false);
    expect(connection.close).not.toHaveBeenCalled();
    expect(session.getSnapshot().passageText).toBe("The cat sat on the mat.");
  });
  it("closes the microphone and pending help on unmount", async () => {
    const connection = await start();
    connection.say("the dog sat on the mat");
    session.dispose();
    await vi.advanceTimersByTimeAsync(1000);
    expect(connection.close).toHaveBeenCalledOnce();
    expect(Playback.instances).toHaveLength(0);
  });
  it("returns to a restartable state after unexpected disconnect", async () => {
    const connection = await start();
    connection.emit(RealtimeEvents.CLOSE);
    expect(session.getSnapshot()).toMatchObject({ status: "idle", connected: false, busy: false });
    const next = await start();
    expect(next).not.toBe(connection);
  });
  it("times out a connection that never becomes ready", async () => {
    await session.start();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(session.getSnapshot()).toMatchObject({ status: "idle", connected: false, busy: false });
    expect(connections[0].close).toHaveBeenCalledOnce();
  });
});
