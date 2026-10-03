# Read Along (ReadBuddy)

A patient, browser-based **reading companion**. It follows a reader through a
short passage one sentence at a time, notices likely word mismatches after a
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
  `eleven_flash_v2_5` for spoken prompts (via `@elevenlabs/react` + REST)
- **Qwen3 4B/8B** (open weight, Apache 2.0) for optional word explanations,
  with a reviewed offline fallback

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
| `ELEVENLABS_VOICE_ID` | no       | Preselected prompt voice (defaults to "Rachel").               |
| `QWEN_API_URL`        | no       | OpenAI-compatible chat-completions URL for the Explain feature.|
| `QWEN_MODEL`          | no       | Model name (default `qwen3-4b`).                               |
| `QWEN_API_KEY`        | no       | Bearer token for the Qwen endpoint, if it needs one.           |

Without `QWEN_API_URL`, **Explain** returns a short reviewed definition labelled
*offline* — the listening/speaking loop works regardless.

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
3. Each committed utterance is aligned against the active sentence from the
   current position (`lib/align.ts`, Needleman–Wunsch). Clean matches advance the
   position; at most **one** help candidate is produced per utterance.
4. Help waits ~1s (tunable) so the reader can self-correct. A prompt is both
   spoken and shown as text. Input is ignored while the companion speaks.
5. **Retry / Hear word / Explain / Continue** let the reader choose. The same
   suggestion is never repeated. Finish shows the list of words practised.

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
```
