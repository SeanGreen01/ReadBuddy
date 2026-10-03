"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { groupBySentence } from "@/lib/normalize";
import { soundOut } from "@/lib/syllabify";
import { ReaderSession } from "@/lib/reader-session";
import type { ReaderStatus, Token } from "@/lib/types";
import { PASSAGES } from "@/lib/passages";

const STATUS_LABEL: Record<ReaderStatus, string> = {
  idle: "Ready",
  starting: "Starting microphone…",
  listening: "Listening",
  checking: "Checking",
  helping: "Offering help",
  retrying: "Listening for your retry",
  paused: "Speaking…",
  finished: "Finished",
};

export default function Reader() {
  const [session] = useState(() => new ReaderSession());
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  useEffect(() => () => session.dispose(), [session]);
  const { passageText, tokens, status, position, readTokenIds, pendingCandidate,
    partial, lastCommitted, practiced, coach, spokenPrompt, connectionError, busy,
    assistanceEnabled, offeredTokenIds, connected } = state;
  const { start, stop, retry, continueReading, hearWord, explain } = session;
  const [draftText, setDraftText] = useState(passageText);
  const [fontSize, setFontSize] = useState(30);
  const [showDebug, setShowDebug] = useState(false);
  const sentences = useMemo(() => groupBySentence(tokens), [tokens]);
  const activeSentenceId = tokens[position]?.sentenceId ?? sentences.length - 1;
  const loadPassage = (text: string) => {
    if (session.loadPassage(text)) setDraftText(text);
  };

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
                session.setAssistance(e.target.checked);
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
            That&rsquo;s okay — the word here is{" "}
            <span className="font-semibold underline decoration-sky-500 decoration-2">
              {pendingCandidate.expected}
            </span>
            . Try saying it again.
          </p>
          {(busy || coach) && (
            <div className="mb-3 text-sm text-slate-700">
              <p className="mt-1">
                <span className="font-medium">
                  {soundOut(pendingCandidate.expected).mode === "syllables"
                    ? "Sound it out: "
                    : "Spell it out: "}
                </span>
                <span className="tracking-wide">
                  {soundOut(pendingCandidate.expected).display}
                </span>
              </p>
              {coach ? (
                <p className="mt-1">
                  <span className="font-medium">Meaning: </span>
                  {coach.explanation}
                  {coach.source === "fallback" && (
                    <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-600">
                      offline definition
                    </span>
                  )}
                </p>
              ) : (
                <p className="mt-1 text-slate-500">Finding a meaning…</p>
              )}
            </div>
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
          <h2 className="mb-1 font-semibold text-emerald-900">
            Nice work — passage finished.
          </h2>
          <p className="text-sm text-emerald-800">
            {practicedList.length === 0
              ? "You read the whole passage with no help needed."
              : `You practised ${practicedList.length} ${
                  practicedList.length === 1 ? "word" : "words"
                } — see the list below.`}
          </p>
        </div>
      )}

      {/* Persistent list of words the reader has struggled with this session */}
      {practicedList.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4">
          <h2 className="mb-2 text-sm font-semibold text-amber-900">
            Words you&rsquo;re practising
          </h2>
          <ul className="flex flex-wrap gap-2">
            {practicedList.map((w) => (
              <li
                key={w.tokenId}
                className="rounded-full border border-amber-300 bg-white px-3 py-1 text-sm text-amber-900"
              >
                {w.word}
              </li>
            ))}
          </ul>
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
          <label htmlFor="passage">Passage text</label>
          <textarea
            id="passage"
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
          <dd>{String(connected)}</dd>
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
          <dd>{Array.from(offeredTokenIds).join(", ") || "—"}</dd>
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
