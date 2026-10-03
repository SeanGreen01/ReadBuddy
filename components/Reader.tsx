"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { groupBySentence } from "@/lib/normalize";
import { soundOut } from "@/lib/syllabify";
import { ReaderSession } from "@/lib/reader-session";
import type { ReaderStatus, Token } from "@/lib/types";
import { PASSAGES } from "@/lib/passages";
import { BookBuddy, ReadingIcon, type IconName } from "./ReadingIcons";

const STATUS_MESSAGE: Record<ReaderStatus, string> = {
  idle: "Take your time. We can read a little at a time.",
  starting: "Getting ready… Your browser may ask to use the microphone.",
  listening: "I’m listening. Read aloud at your own pace.",
  checking: "Take your time. There’s no hurry.",
  helping: "You can try this word, hear it, or keep going.",
  retrying: "I’m listening. Give the word another try.",
  paused: "Listen along. Your microphone is muted while I speak.",
  finished: "You did it! Every little bit of reading counts.",
};
const STORY_STYLE: Record<string, { icon: IconName; topic: string; colour: string }> = {
  "house-on-the-hill": { icon: "house", topic: "A little mystery", colour: "lavender" },
  "morning-walk": { icon: "sun", topic: "Out and about", colour: "peach" },
  "lost-kitten": { icon: "cat", topic: "An animal friend", colour: "peach" },
  "at-the-beach": { icon: "waves", topic: "By the sea", colour: "blue" },
  "the-red-bus": { icon: "bus", topic: "A trip to town", colour: "lavender" },
  "planting-seeds": { icon: "leaf", topic: "Growing things", colour: "green" },
};

export default function Reader() {
  const [session] = useState(() => new ReaderSession());
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  useEffect(() => () => session.dispose(), [session]);
  const { passageText, tokens, status, position, pendingCandidate,
    partial, lastCommitted, practiced, coach, spokenPrompt, connectionError, busy,
    assistanceEnabled, connected } = state;
  const { start, stop, retry, continueReading, hearWord, explain } = session;
  const [draftText, setDraftText] = useState(passageText);
  const [fontSize, setFontSize] = useState(28);
  const [lineHeight, setLineHeight] = useState(1.9);
  const [paper, setPaper] = useState("cream");
  const [highlight, setHighlight] = useState(true);
  const [showTranscript, setShowTranscript] = useState(false);
  const [panel, setPanel] = useState<"stories" | "settings" | null>(null);
  const storyButton = useRef<HTMLButtonElement>(null);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const sentences = useMemo(() => groupBySentence(tokens), [tokens]);
  const activeSentenceId = tokens[position]?.sentenceId ?? sentences.length - 1;
  const selectedStory = PASSAGES.find((p) => p.text === passageText);
  const storyStyle = selectedStory ? STORY_STYLE[selectedStory.id] : null;
  const isActive = status !== "idle" && status !== "finished";
  const practicedList = Array.from(practiced.values());
  const breakdown = pendingCandidate ? soundOut(pendingCandidate.expected) : null;
  const micLabel = status === "starting" ? "Starting microphone…"
    : connected && status === "paused" ? "Microphone muted"
    : connected ? "Microphone on" : "Microphone off";

  const closePanel = () => {
    (panel === "stories" ? storyButton : settingsButton).current?.focus();
    setPanel(null);
  };
  const loadPassage = (text: string) => {
    if (session.loadPassage(text)) {
      setDraftText(text);
      closePanel();
    }
  };
  const chooseAnother = () => {
    setPanel("stories");
    storyButton.current?.focus();
    storyButton.current?.scrollIntoView({ block: "nearest" });
  };

  return (
    <div className="reader" onKeyDown={(event) => {
      if (event.key === "Escape" && panel) { event.stopPropagation(); closePanel(); }
    }}>
      <div className="reader-toolbar">
        <span className="small-note"><span className="decorative-spark" aria-hidden="true">✦</span> A little adventure awaits</span>
        <div className="toolbar-actions">
          <button ref={storyButton} className="button button-quiet" type="button"
            aria-expanded={panel === "stories"} aria-controls="story-picker"
            onClick={() => setPanel(panel === "stories" ? null : "stories")}>
            <ReadingIcon name="book" /> Choose a story
          </button>
          <button ref={settingsButton} className="button button-quiet" type="button"
            aria-expanded={panel === "settings"} aria-controls="reading-settings"
            onClick={() => setPanel(panel === "settings" ? null : "settings")}>
            <ReadingIcon name="settings" /> Reading settings
          </button>
        </div>
      </div>

      {panel === "stories" && (
        <section id="story-picker" className="drawer" aria-labelledby="story-picker-title">
          <div className="section-heading">
            <div><h2 id="story-picker-title">What shall we read?</h2><p>Pick something that makes you curious.</p></div>
            <button className="icon-button" type="button" onClick={closePanel} aria-label="Close story chooser"><ReadingIcon name="close" /></button>
          </div>
          {isActive && <p className="picker-note">Choosing another story will stop this reading session.</p>}
          <div className="story-grid">
            {PASSAGES.map((p) => {
              const style = STORY_STYLE[p.id];
              const selected = p.id === selectedStory?.id;
              return (
                <button key={p.id} type="button" className={`story-choice${selected ? " selected" : ""}`}
                  aria-pressed={selected} onClick={() => loadPassage(p.text)}>
                  <span className={`story-art ${style?.colour ?? "green"}`}><ReadingIcon name={style?.icon ?? "book"} /></span>
                  <span className="story-choice-copy"><span className="story-choice-title">{p.title}</span><span>{style?.topic ?? "A short story"}</span></span>
                  {selected && <ReadingIcon name="check" className="selected-check" />}
                </button>
              );
            })}
          </div>
          <details className="custom-passage">
            <summary>Add your own text</summary>
            <label htmlFor="passage">Passage text</label>
            <textarea id="passage" value={draftText} onChange={(e) => setDraftText(e.target.value)}
              placeholder="Paste a short English passage…" />
            <Btn onClick={() => loadPassage(draftText.trim())}>Use this passage <ReadingIcon name="arrow" /></Btn>
          </details>
        </section>
      )}

      {panel === "settings" && (
        <section id="reading-settings" className="drawer" aria-labelledby="reading-settings-title">
          <div className="section-heading">
            <div><h2 id="reading-settings-title">Make it comfy</h2><p>Choose what feels good to read.</p></div>
            <button className="icon-button" type="button" onClick={closePanel} aria-label="Close reading settings"><ReadingIcon name="close" /></button>
          </div>
          <div className="settings-grid">
            <div className="setting">
              <label htmlFor="font">Text size <output htmlFor="font">{fontSize}</output></label>
              <input id="font" type="range" min={20} max={48} step={2} value={fontSize}
                onChange={(e) => setFontSize(Number(e.target.value))} />
            </div>
            <div className="setting">
              <label htmlFor="spacing">Space between lines <output htmlFor="spacing">{lineHeight.toFixed(1)}</output></label>
              <input id="spacing" type="range" min={1.5} max={2.5} step={0.1} value={lineHeight}
                onChange={(e) => setLineHeight(Number(e.target.value))} />
            </div>
            <fieldset className="setting paper-settings">
              <legend>Page colour</legend>
              <div className="paper-options">
                {[['cream', 'Cream'], ['white', 'White'], ['mint', 'Mint']].map(([value, label]) => (
                  <button key={value} type="button" className={`paper-option paper-${value}`} aria-pressed={paper === value} onClick={() => setPaper(value)}>
                    {paper === value && <ReadingIcon name="check" />}{label}
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="setting checkbox-settings">
              <label><input type="checkbox" checked={highlight} onChange={(e) => setHighlight(e.target.checked)} />Highlight my place</label>
              <label><input type="checkbox" checked={assistanceEnabled} onChange={(e) => session.setAssistance(e.target.checked)} />Help while I read</label>
              <label><input type="checkbox" checked={showTranscript} onChange={(e) => setShowTranscript(e.target.checked)} />Show the words heard</label>
            </div>
          </div>
        </section>
      )}

      {connectionError && <div role="alert" className="reader-error">{connectionError}</div>}

      <section className={`reading-card paper-${paper}`} aria-labelledby="story-title">
        <div className="reading-card-heading">
          <div className="story-title-row">
            <span className={`story-art ${storyStyle?.colour ?? "green"}`}><ReadingIcon name={storyStyle?.icon ?? "book"} /></span>
            <div>
              <p className="eyebrow">{storyStyle?.topic ?? "Something of your own"}</p>
              <h2 id="story-title">{selectedStory?.title ?? "Your story"}</h2>
            </div>
          </div>
          <div className="reading-controls">
            {!isActive ? (
              <Btn onClick={start} disabled={busy} primary><ReadingIcon name="mic" />{status === "finished" ? "Read again" : "Let’s read"}</Btn>
            ) : (
              <Btn onClick={stop} primary><ReadingIcon name="stop" />Stop reading</Btn>
            )}
            <span className={`microphone-state${connected && status !== "paused" ? " is-on" : ""}`} role="status">
              <span className="status-dot" aria-hidden="true" />{micLabel}
            </span>
          </div>
        </div>
        <article className="passage" aria-label="Story text" style={{ fontSize, lineHeight }}>
          {sentences.map((sentence, sId) => (
            <span key={sId} className={`sentence${highlight && isActive && sId === activeSentenceId ? " active-sentence" : ""}`}>
              {sentence.map((token) => <WordSpan key={token.id} token={token}
                isCurrent={token.id === position && isActive}
                highlighted={highlight} isCandidate={pendingCandidate?.tokenId === token.id} />)}
            </span>
          ))}
        </article>
        <div className="reading-card-foot">
          <span><ReadingIcon name="book" />{status === "finished" ? "Story complete" : isActive ? `Sentence ${activeSentenceId + 1} of ${sentences.length}` : `${sentences.length} short sentences`}</span>
          <span>No rush. Read your way.</span>
        </div>
      </section>

      <div className="buddy-note">
        <BookBuddy />
        <div><p className="buddy-name">Your reading buddy</p>
          <p aria-live="polite" data-testid="prompt-text">{spokenPrompt || STATUS_MESSAGE[status]}</p>
        </div>
      </div>

      {showTranscript && isActive && <p className="transcript"><strong>Words heard: </strong>{partial || lastCommitted || "Waiting for your voice…"}</p>}

      {pendingCandidate && (
        <section className="help-card" aria-labelledby="help-title">
          <p className="eyebrow">A little help, if you like</p>
          <h2 id="help-title">Let’s explore <span>{pendingCandidate.expected}</span></h2>
          <p>You can try it again, listen, or keep going.</p>
          {(busy || coach) && breakdown && (
            <div className="word-explanation">
              <p><strong>{breakdown.mode === "syllables" ? "Sound it out: " : "Spell it out: "}</strong><span className="word-breakdown">{breakdown.display}</span></p>
              <p aria-live="polite">{coach ? coach.explanation : "Finding a meaning…"}</p>
            </div>
          )}
          <div className="help-actions">
            <Btn onClick={hearWord} primary><ReadingIcon name="sound" />Hear this word</Btn>
            <Btn onClick={retry}>Try again</Btn>
            <Btn onClick={continueReading}>Keep going <ReadingIcon name="arrow" /></Btn>
            <Btn onClick={explain} disabled={busy}>What does it mean?</Btn>
          </div>
        </section>
      )}

      {status === "finished" && (
        <section className="finish-card" aria-labelledby="finish-title">
          <span className="finish-star" aria-hidden="true">✦</span>
          <div><h2 id="finish-title">You finished the story!</h2><p>Well done for taking time to read. Ready for another adventure?</p></div>
          <Btn onClick={chooseAnother}>Choose another story <ReadingIcon name="arrow" /></Btn>
        </section>
      )}
      {practicedList.length > 0 && (
        <details className="practice-list" open={status === "finished"}>
          <summary>Words we explored <span>{practicedList.length}</span></summary>
          <ul>{practicedList.map((w) => <li key={w.tokenId}>{w.word}</li>)}</ul>
        </details>
      )}
    </div>
  );
}

function WordSpan({ token, isCurrent, isCandidate, highlighted }: {
  token: Token; isCurrent: boolean; isCandidate: boolean; highlighted: boolean;
}) {
  return <span className={`word${isCandidate ? " candidate-word" : isCurrent && highlighted ? " current-word" : ""}`}
    aria-current={isCurrent ? "true" : undefined}>
    {isCandidate && <span className="sr-only">Word to explore: </span>}{token.display}{" "}
  </span>;
}

function Btn({ children, onClick, primary, disabled }: {
  children: React.ReactNode; onClick: () => void; primary?: boolean; disabled?: boolean;
}) {
  return <button type="button" onClick={onClick} disabled={disabled}
    className={`button ${primary ? "button-primary" : "button-secondary"}`}>{children}</button>;
}
