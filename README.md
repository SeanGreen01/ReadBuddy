# Read Along (ReadBuddy)

A patient, browser-based **reading companion**. It follows a reader through a
short passage across sentences, notices well-supported word mismatches after a
pause, and offers gentle, optional spoken help. The reader can retry, hear the
word, ask for a short meaning, or keep going at their own pace.

> **Important limitation.** A transcript mismatch is evidence of a *possible*
> difference, not proof of a reading error. Speech recognition can misunderstand
> accents or unusual speech. This prototype checks recognised words against the
> text; it does **not** measure phoneme accuracy, diagnose dyslexia, or provide a
> validated literacy assessment.

## Stack

- **Next.js 16 + TypeScript** (App Router), Tailwind v4
- **ElevenLabs** Scribe `scribe_v2_realtime` for live listening and
  `eleven_flash_v2_5` for spoken prompts (via `@elevenlabs/client` + REST)
- **Google Gemma 4** (open weight, Apache 2.0) for optional word explanations,
  via the Gemini API's OpenAI-compatible endpoint, with a reviewed offline
  fallback (swappable for any OpenAI-compatible endpoint)

All state (passage, position, pending help, practice list) is kept in memory.
No accounts, no database.

## Setup

```bash
npm install
cp .env.local.example .env.local   # then fill in your keys
npm run dev                         # http://localhost:3000
```

### Environment variables

| Variable              | Required | Purpose                                                        |
| --------------------- | -------- | -------------------------------------------------------------- |
| `ELEVENLABS_API_KEY`  | yes      | Listening + speaking. Stays server-side only.                  |
| `ELEVENLABS_VOICE_ID` | no       | Preselected prompt voice (defaults to "Sarah").               |
| `COACH_API_KEY`       | no       | Gemini API key for Gemma 4 (the Explain feature). Get one at https://aistudio.google.com/apikey. |
| `COACH_MODEL`         | no       | Model id (default `gemma-4-26b-a4b-it`; or `gemma-4-31b-it`).  |
| `COACH_API_URL`       | no       | Override to point Explain at any other OpenAI-compatible endpoint (e.g. a local runtime). |

With neither `COACH_API_KEY` nor `COACH_API_URL` set, **Explain** returns a short
reviewed definition labelled *offline* — the listening/speaking loop works
regardless.

## Server routes

- `POST /api/scribe-token` → `{ token }` — mints a single-use `realtime_scribe`
  token so the permanent key never reaches the browser.
- `POST /api/speak` `{ text, requestId }` → `audio/mpeg` — TTS with a short
  prompt cache; the browser cancels stale playback.
- `POST /api/coach` `{ word, sentence, requestId }` →
  `{ word, explanation, source: "model" | "fallback" }`.

## How it works

1. Pick or paste a short passage. It's tokenised into sentences and words with
   stable ids (`lib/normalize.ts`).
2. **Start** opens the mic via Scribe. Partial text shows live; committed text
   drives decisions.
3. Each committed utterance follows the passage from the current position
   (`lib/align.ts`), including speech spanning sentences. Exact prefixes advance
   immediately. A mismatch needs two following exact words to support a suggestion;
   uncertain or tied matches wait. Repetitions and short self-corrections are tolerated.
   At most **one** help candidate is produced per utterance, and matched words after
   it are retained so Retry/Continue do not require rereading them.
4. Help waits ~1s after the committed transcript. Nonempty partial speech cancels
   pending help to leave room for self-correction. A prompt is both spoken and
   shown as text; the microphone is muted during playback.
5. **Retry / Hear word / Explain / Continue** let the reader choose. An inconclusive
   retry keeps these controls available. Successful retries are recorded only after
   the expected word is recognised.
6. `lib/reader-session.ts` owns connections, timers, requests, and audio. Stop,
   passage changes, completion, and unmount invalidate callbacks and cancel pending
   work. Completion closes the microphone; Read again resets the session.

Alignment deliberately prefers waiting over a doubtful correction. It uses a small
lookahead (up to three words), not a pronunciation assessment. A trailing mismatch
without supporting words may produce no suggestion. Validate speech recognition,
VAD timing, and speaker/microphone behaviour on real devices before a reader pilot.

### Accessibility notes

Large adjustable font, generous line spacing, active-sentence focus, a subtle
word highlight paired with an underline + label (no bare red marks, no flashing,
no timed scoring), keyboard-accessible controls, and `prefers-reduced-motion`
support. These are starting points to validate with real users, not universal
preferences.

## Scripts

```bash
npm run dev     # dev server
npm run build   # production build
npm run start   # serve the production build
npm run lint    # eslint
npm run typecheck # generate Next.js types and check TypeScript
npm test        # alignment, session lifecycle, and reader UI regressions
npm run test:watch # watch tests during development
```

Tests mock ElevenLabs, HTTP requests, and audio playback; they require no API keys
and do not validate provider quality or physical microphone behaviour.
