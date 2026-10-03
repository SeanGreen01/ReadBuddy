"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useScribe, CommitStrategy } from "@elevenlabs/react";
import {
  groupBySentence,
  normaliseTranscript,
  tokenisePassage,
} from "@/lib/normalize";
import { alignUtterance } from "@/lib/align";
import type {
  Candidate,
  CoachResponse,
  PracticedWord,
  ReaderStatus,
  Token,
} from "@/lib/types";
import { PASSAGES } from "@/lib/passages";

// Roughly one second pause before help is offered, per the spec. Tune during
// rehearsal. A newer utterance that resolves the word cancels pending help,
// which is what gives the reader room to self-correct.
const HELP_DELAY_MS = 1000;

const STATUS_LABEL: Record<ReaderStatus, string> = {
  idle: "Ready",
  listening: "Listening",
  checking: "Checking",
  helping: "Offering help",
  retrying: "Listening for your retry",
  paused: "Speaking…",
  finished: "Finished",
};

export default function Reader() {
  // ---- Passage selection / input -----------------------------------------
  const [passageText, setPassageText] = useState(PASSAGES[0].text);
  const [draftText, setDraftText] = useState(PASSAGES[0].text);

  const tokens = useMemo<Token[]>(
    () => tokenisePassage(passageText),
    [passageText]
  );
  const sentences = useMemo(() => groupBySentence(tokens), [tokens]);
  // Matchable tokens (non-punctuation) grouped by sentence id.
  const matchableBySentence = useMemo(() => {
    const map = new Map<number, Token[]>();
    for (const t of tokens) {
      if (t.normalised.length === 0) continue;
      const list = map.get(t.sentenceId);
      if (list) list.push(t);
      else map.set(t.sentenceId, [t]);
    }
    return map;
  }, [tokens]);

  // ---- Rendered reader state ----------------------------------------------
  const [status, setStatusState] = useState<ReaderStatus>("idle");
  const [position, setPositionState] = useState(0);
  const [readTokenIds, setReadTokenIds] = useState<Set<number>>(new Set());
  const [pendingCandidate, setPendingCandidateState] =
    useState<Candidate | null>(null);
  const [partial, setPartial] = useState("");
  const [lastCommitted, setLastCommitted] = useState("");
  const [practiced, setPracticed] = useState<Map<number, PracticedWord>>(
    new Map()
  );
  const [coach, setCoach] = useState<CoachResponse | null>(null);
  const [spokenPrompt, setSpokenPrompt] = useState("");
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // ---- Settings -----------------------------------------------------------
  const [fontSize, setFontSize] = useState(30);
  const [assistanceEnabled, setAssistanceEnabled] = useState(true);
  const [showDebug, setShowDebug] = useState(false);

  // ---- Refs: the realtime source of truth for Scribe callbacks ------------
  const positionRef = useRef(0);
  const statusRef = useRef<ReaderStatus>("idle");
  const pendingCandidateRef = useRef<Candidate | null>(null);
  const alreadyOfferedRef = useRef<Set<number>>(new Set());
  const isSpeakingRef = useRef(false);
  const sessionIdRef = useRef(0);
  const helpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const speakSeqRef = useRef(0);
  const assistanceRef = useRef(true);

  // ---- Synced setters (update ref + React state together) -----------------
  const setStatus = useCallback((s: ReaderStatus) => {
    statusRef.current = s;
    setStatusState(s);
  }, []);
  const setPosition = useCallback((p: number) => {
    positionRef.current = p;
    setPositionState(p);
  }, []);
  const setPendingCandidate = useCallback((c: Candidate | null) => {
    pendingCandidateRef.current = c;
    setPendingCandidateState(c);
  }, []);

  const activeSentenceId = tokens[position]?.sentenceId ?? sentences.length - 1;

  // ---- Speech playback ----------------------------------------------------
  const resumeAfterSpeak = useCallback(() => {
    if (statusRef.current === "finished" || statusRef.current === "idle") return;
    setStatus(pendingCandidateRef.current ? "helping" : "listening");
  }, [setStatus]);

  const speak = useCallback(
    async (text: string, { thenResume = true }: { thenResume?: boolean } = {}) => {
      const seq = ++speakSeqRef.current;
      setSpokenPrompt(text);
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      isSpeakingRef.current = true;
      setStatus("paused");
      try {
        const res = await fetch("/api/speak", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, requestId: seq }),
        });
        if (seq !== speakSeqRef.current) return; // superseded
        if (!res.ok) throw new Error(`speak ${res.status}`);
        const blob = await res.blob();
        if (seq !== speakSeqRef.current) return;
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => {
          URL.revokeObjectURL(url);
          if (seq !== speakSeqRef.current) return;
          isSpeakingRef.current = false;
          if (thenResume) resumeAfterSpeak();
        };
        await audio.play();
      } catch {
        if (seq === speakSeqRef.current) {
          isSpeakingRef.current = false;
          setConnectionError("Could not play spoken audio (check ElevenLabs key).");
          if (thenResume) resumeAfterSpeak();
        }
      }
    },
    [resumeAfterSpeak, setStatus]
  );

  // ---- Offer help for a candidate -----------------------------------------
  const offerHelp = useCallback(
    (candidate: Candidate) => {
      if (!assistanceRef.current) {
        // Assistance off: silently advance past the word, keep reading.
        setPosition(candidate.tokenId + 1);
        setStatus("listening");
        return;
      }
      alreadyOfferedRef.current.add(candidate.tokenId);
      setPendingCandidate(candidate);
      setStatus("helping");
      const prompt =
        candidate.kind === "substitution"
          ? `The word here is ${candidate.expected}. Would you like to try it again?`
          : `Let's try this word: ${candidate.expected}.`;
      void speak(prompt);
    },
    [setPendingCandidate, setPosition, setStatus, speak]
  );

  // ---- Core: handle a committed utterance ---------------------------------
  const handleCommitted = useCallback(
    (sessionAtEvent: number, text: string) => {
      // Ignore stale sessions and anything spoken during companion playback.
      if (sessionAtEvent !== sessionIdRef.current) return;
      if (isSpeakingRef.current) return;
      if (
        statusRef.current === "idle" ||
        statusRef.current === "finished" ||
        statusRef.current === "paused"
      )
        return;

      setLastCommitted(text);

      // A fresh utterance cancels any pending help (room to self-correct).
      if (helpTimerRef.current) {
        clearTimeout(helpTimerRef.current);
        helpTimerRef.current = null;
      }

      const pos = positionRef.current;
      const activeId = tokens[pos]?.sentenceId;
      if (activeId === undefined) return;
      const sentenceTokens = matchableBySentence.get(activeId) ?? [];

      const result = alignUtterance({
        sentenceTokens,
        position: pos,
        heardWords: normaliseTranscript(text),
        alreadyOffered: alreadyOfferedRef.current,
      });

      if (result.matchedTokenIds.length > 0) {
        setReadTokenIds((prev) => {
          const next = new Set(prev);
          for (const id of result.matchedTokenIds) next.add(id);
          return next;
        });
      }

      setPosition(result.newPosition);

      // Reached the end of the passage?
      if (result.newPosition >= tokens.length) {
        setPendingCandidate(null);
        setStatus("finished");
        return;
      }

      if (result.candidate) {
        setStatus("checking");
        const candidate = result.candidate;
        helpTimerRef.current = setTimeout(() => {
          helpTimerRef.current = null;
          offerHelp(candidate);
        }, HELP_DELAY_MS);
      } else {
        setPendingCandidate(null);
        setStatus("listening");
      }
    },
    [matchableBySentence, offerHelp, setPendingCandidate, setPosition, setStatus, tokens]
  );

  // ---- Scribe hook --------------------------------------------------------
  const scribe = useScribe({
    modelId: "scribe_v2_realtime",
    commitStrategy: CommitStrategy.VAD,
    languageCode: "en",
    onSessionStarted: () => setConnectionError(null),
    onPartialTranscript: (data: { text: string }) => {
      if (isSpeakingRef.current) return;
      setPartial(data.text);
    },
    onCommittedTranscript: (data: { text: string }) => {
      setPartial("");
      handleCommitted(sessionIdRef.current, data.text);
    },
    onError: (err: Error | Event) =>
      setConnectionError(
        err instanceof Error
          ? err.message
          : "Connection error with ElevenLabs Scribe."
      ),
    onDisconnect: () => {
      if (statusRef.current !== "idle" && statusRef.current !== "finished") {
        setConnectionError("Microphone disconnected.");
      }
    },
  });

  // ---- Controls -----------------------------------------------------------
  const start = useCallback(async () => {
    setBusy(true);
    setConnectionError(null);
    try {
      const res = await fetch("/api/scribe-token", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `token ${res.status}`);
      }
      const { token } = await res.json();
      sessionIdRef.current += 1;
      await scribe.connect({
        token,
        microphone: { echoCancellation: true, noiseSuppression: true },
      });
      setStatus("listening");
    } catch (err) {
      setConnectionError(
        err instanceof Error ? err.message : "Could not start listening."
      );
      setStatus("idle");
    } finally {
      setBusy(false);
    }
  }, [scribe, setStatus]);

  const stop = useCallback(() => {
    if (helpTimerRef.current) clearTimeout(helpTimerRef.current);
    helpTimerRef.current = null;
    sessionIdRef.current += 1; // invalidate in-flight transcripts
    if (scribe.isConnected) scribe.disconnect();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    isSpeakingRef.current = false;
    setStatus(positionRef.current >= tokens.length ? "finished" : "idle");
  }, [scribe, setStatus, tokens.length]);

  const recordPractice = useCallback(
    (candidate: Candidate, outcome: PracticedWord["outcome"]) => {
      setPracticed((prev) => {
        const next = new Map(prev);
        next.set(candidate.tokenId, {
          tokenId: candidate.tokenId,
          word: candidate.expected,
          outcome,
        });
        return next;
      });
    },
    []
  );

  const retry = useCallback(() => {
    const candidate = pendingCandidateRef.current;
    if (!candidate) return;
    recordPractice(candidate, "retried");
    setPendingCandidate(null);
    setStatus("retrying");
  }, [recordPractice, setPendingCandidate, setStatus]);

  const continueReading = useCallback(() => {
    const candidate = pendingCandidateRef.current;
    if (candidate) {
      recordPractice(candidate, "dismissed");
      setPosition(candidate.tokenId + 1);
    }
    setPendingCandidate(null);
    setCoach(null);
    if (positionRef.current >= tokens.length) setStatus("finished");
    else setStatus("listening");
  }, [recordPractice, setPendingCandidate, setPosition, setStatus, tokens.length]);

  const hearWord = useCallback(() => {
    const candidate = pendingCandidateRef.current;
    if (candidate) void speak(candidate.expected);
  }, [speak]);

  const explain = useCallback(async () => {
    const candidate = pendingCandidateRef.current;
    if (!candidate) return;
    recordPractice(candidate, "explained");
    setBusy(true);
    try {
      const sentence = (sentences[activeSentenceId] ?? [])
        .map((t) => t.display)
        .join(" ");
      const res = await fetch("/api/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          word: candidate.expected,
          sentence,
          requestId: Date.now(),
        }),
      });
      const data: CoachResponse = await res.json();
      setCoach(data);
      void speak(data.explanation);
    } catch {
      setConnectionError("Could not fetch an explanation.");
    } finally {
      setBusy(false);
    }
  }, [activeSentenceId, recordPractice, sentences, speak]);

  const loadPassage = useCallback(
    (text: string) => {
      stop();
      setPassageText(text);
      setDraftText(text);
      setPosition(0);
      setReadTokenIds(new Set());
      setPendingCandidate(null);
      alreadyOfferedRef.current = new Set();
      setPracticed(new Map());
      setCoach(null);
      setSpokenPrompt("");
      setLastCommitted("");
      setPartial("");
      setStatus("idle");
    },
    [setPendingCandidate, setPosition, setStatus, stop]
  );

  // ---- Derived flags for rendering ----------------------------------------
  const isActive = status !== "idle" && status !== "finished";
  const practicedList = Array.from(practiced.values());

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      {/* Status + spoken-prompt text equivalent (aria-live) */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <StatusBadge status={status} />
        <div className="flex items-center gap-2 text-sm">
          <label htmlFor="font" className="text-slate-600">
            Text size
          </label>
          <input
            id="font"
            type="range"
            min={20}
            max={48}
            step={2}
            value={fontSize}
            onChange={(e) => setFontSize(Number(e.target.value))}
          />
          <label className="ml-3 flex items-center gap-1 text-slate-600">
            <input
              type="checkbox"
              checked={assistanceEnabled}
              onChange={(e) => {
                setAssistanceEnabled(e.target.checked);
                assistanceRef.current = e.target.checked;
              }}
            />
            Assistance
          </label>
        </div>
      </div>

      <p
        aria-live="polite"
        className="min-h-6 text-sm text-slate-500"
        data-testid="prompt-text"
      >
        {spokenPrompt ? `🔊 ${spokenPrompt}` : ""}
      </p>

      {connectionError && (
        <div
          role="alert"
          className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900"
        >
          {connectionError}
        </div>
      )}

      {/* Passage */}
      <article
        className="rounded-xl border border-slate-200 bg-white p-6 leading-relaxed shadow-sm"
        style={{ fontSize, lineHeight: 1.9 }}
      >
        {sentences.map((sentence, sId) => {
          const isActiveSentence = sId === activeSentenceId && isActive;
          return (
            <span
              key={sId}
              className={
                isActiveSentence
                  ? "text-slate-900"
                  : isActive
                    ? "text-slate-300"
                    : "text-slate-800"
              }
            >
              {sentence.map((token) => (
                <WordSpan
                  key={token.id}
                  token={token}
                  isCurrent={token.id === position && isActive}
                  isRead={readTokenIds.has(token.id)}
                  isCandidate={pendingCandidate?.tokenId === token.id}
                />
              ))}
            </span>
          );
        })}
      </article>

      {/* Live transcript line */}
      {isActive && (
        <p className="text-sm text-slate-400">
          <span className="font-medium text-slate-500">Heard: </span>
          {partial || lastCommitted || "…"}
        </p>
      )}

      {/* Help panel */}
      {pendingCandidate && (
        <div className="rounded-xl border border-sky-300 bg-sky-50 p-4">
          <p className="mb-3 text-slate-800">
            The word here is{" "}
            <span className="font-semibold underline decoration-sky-500 decoration-2">
              {pendingCandidate.expected}
            </span>
            . Would you like to try it again?
          </p>
          {coach && (
            <p className="mb-3 text-sm text-slate-700">
              <span className="font-medium">Meaning: </span>
              {coach.explanation}
              {coach.source === "fallback" && (
                <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-600">
                  offline definition
                </span>
              )}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Btn onClick={retry} primary>
              Retry
            </Btn>
            <Btn onClick={hearWord}>Hear word</Btn>
            <Btn onClick={explain} disabled={busy}>
              Explain
            </Btn>
            <Btn onClick={continueReading}>Continue</Btn>
          </div>
        </div>
      )}

      {/* Primary controls */}
      <div className="flex flex-wrap gap-3">
        {!isActive ? (
          <Btn onClick={start} disabled={busy} primary>
            {busy ? "Starting…" : status === "finished" ? "Read again" : "Start"}
          </Btn>
        ) : (
          <Btn onClick={stop}>Stop</Btn>
        )}
        {status === "finished" && (
          <Btn onClick={() => loadPassage(passageText)}>Reset</Btn>
        )}
      </div>

      {/* Finished summary */}
      {status === "finished" && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4">
          <h2 className="mb-2 font-semibold text-emerald-900">
            Nice work — passage finished.
          </h2>
          {practicedList.length === 0 ? (
            <p className="text-sm text-emerald-800">
              You read the whole passage with no help needed.
            </p>
          ) : (
            <>
              <p className="mb-2 text-sm text-emerald-800">
                Words you practised:
              </p>
              <ul className="flex flex-wrap gap-2">
                {practicedList.map((w) => (
                  <li
                    key={w.tokenId}
                    className="rounded-full border border-emerald-300 bg-white px-3 py-1 text-sm text-emerald-900"
                  >
                    {w.word}{" "}
                    <span className="text-emerald-600">({w.outcome})</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {/* Passage picker + paste */}
      <details className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
        <summary className="cursor-pointer font-medium text-slate-700">
          Choose or paste a passage
        </summary>
        <div className="mt-3 flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {PASSAGES.map((p) => (
              <Btn key={p.id} onClick={() => loadPassage(p.text)}>
                {p.title}
              </Btn>
            ))}
          </div>
          <textarea
            className="min-h-24 w-full rounded-md border border-slate-300 p-2"
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            placeholder="Paste a short English passage…"
          />
          <div>
            <Btn onClick={() => loadPassage(draftText.trim())} primary>
              Use this passage
            </Btn>
          </div>
        </div>
      </details>

      {/* Debug view */}
      <details
        className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600"
        open={showDebug}
        onToggle={(e) => setShowDebug((e.target as HTMLDetailsElement).open)}
      >
        <summary className="cursor-pointer font-medium">Debug</summary>
        <dl className="mt-2 grid grid-cols-2 gap-1">
          <dt>Status</dt>
          <dd>{status}</dd>
          <dt>Connected</dt>
          <dd>{String(scribe.isConnected)}</dd>
          <dt>Position</dt>
          <dd>
            {position} / {tokens.length}
          </dd>
          <dt>Active sentence</dt>
          <dd>{activeSentenceId}</dd>
          <dt>Last committed</dt>
          <dd className="truncate">{lastCommitted || "—"}</dd>
          <dt>Pending candidate</dt>
          <dd>
            {pendingCandidate
              ? `${pendingCandidate.expected} ⇐ "${pendingCandidate.heard}" (${pendingCandidate.kind})`
              : "—"}
          </dd>
          <dt>Coach source</dt>
          <dd>{coach?.source ?? "—"}</dd>
          <dt>Already offered</dt>
          <dd>{Array.from(alreadyOfferedRef.current).join(", ") || "—"}</dd>
        </dl>
      </details>
    </div>
  );
}

// ---- Small presentational pieces ------------------------------------------

function WordSpan({
  token,
  isCurrent,
  isRead,
  isCandidate,
}: {
  token: Token;
  isCurrent: boolean;
  isRead: boolean;
  isCandidate: boolean;
}) {
  let cls = "rounded px-0.5 ";
  if (isCandidate) {
    // Pair colour with an underline + label, never a bare red mark.
    cls +=
      "bg-sky-100 underline decoration-sky-500 decoration-2 underline-offset-4";
  } else if (isCurrent) {
    cls += "bg-yellow-100 underline decoration-yellow-500 decoration-2";
  } else if (isRead) {
    cls += "text-slate-400";
  }
  return (
    <span className={cls} aria-current={isCurrent ? "true" : undefined}>
      {isCandidate && (
        <span className="sr-only">(word to look at) </span>
      )}
      {token.display}{" "}
    </span>
  );
}

function StatusBadge({ status }: { status: ReaderStatus }) {
  const color =
    status === "helping" || status === "checking"
      ? "bg-sky-100 text-sky-800"
      : status === "listening" || status === "retrying"
        ? "bg-emerald-100 text-emerald-800"
        : status === "paused"
          ? "bg-violet-100 text-violet-800"
          : status === "finished"
            ? "bg-slate-200 text-slate-800"
            : "bg-slate-100 text-slate-600";
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium ${color}`}
      aria-live="polite"
    >
      <span className="h-2 w-2 rounded-full bg-current opacity-70" />
      {STATUS_LABEL[status]}
    </span>
  );
}

function Btn({
  children,
  onClick,
  primary,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg px-4 py-2 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
        primary
          ? "bg-sky-600 text-white hover:bg-sky-700"
          : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
      }`}
    >
      {children}
    </button>
  );
}
