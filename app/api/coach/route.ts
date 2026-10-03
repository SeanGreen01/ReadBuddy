import { NextResponse } from "next/server";
import type { CoachResponse } from "@/lib/types";

// POST /api/coach  { word, sentence, requestId }  ->  CoachResponse
// Asks an open-weight model (Qwen3 4B/8B via an OpenAI-compatible endpoint)
// for a short, child-friendly explanation of `word` as used in `sentence`.
// On any failure it returns a short reviewed definition labelled as fallback,
// so the voice + alignment loop never depends on the language model.

const TIMEOUT_MS = 8000;
const MAX_WORD = 40;
const MAX_SENTENCE = 300;

// A few reviewed definitions for words likely to appear in the sample
// passages. Used when the model is unavailable. Kept deliberately short.
const REVIEWED: Record<string, string> = {
  house: "A house is a building where people live.",
  hill: "A hill is a raised piece of land, smaller than a mountain.",
  windows: "Windows are the glass openings in a wall that let in light.",
  window: "A window is a glass opening in a wall that lets in light.",
  path: "A path is a narrow track for walking.",
  grass: "Grass is the green plant that covers lawns and fields.",
  narrow: "Narrow means not wide — small from one side to the other.",
  baker: "A baker is a person who makes bread and cakes.",
  bread: "Bread is a food made by baking flour and water.",
  quiet: "Quiet means making little or no noise.",
  empty: "Empty means having nothing inside.",
};

function fallbackFor(word: string): string {
  const key = word.toLowerCase().replace(/[^a-z]/g, "");
  return (
    REVIEWED[key] ??
    `"${word}" is the word written here. Try reading it one sound at a time.`
  );
}

/** Strip any <think>...</think> block some reasoning models may emit. */
function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

export async function POST(req: Request) {
  let body: { word?: unknown; sentence?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const word =
    typeof body.word === "string" ? body.word.trim().slice(0, MAX_WORD) : "";
  const sentence =
    typeof body.sentence === "string"
      ? body.sentence.trim().slice(0, MAX_SENTENCE)
      : "";

  if (!word) {
    return NextResponse.json({ error: "Missing 'word'." }, { status: 400 });
  }

  const apiUrl = process.env.QWEN_API_URL; // e.g. https://host/v1/chat/completions
  const model = process.env.QWEN_MODEL || "qwen3-4b";
  const apiKey = process.env.QWEN_API_KEY; // optional for local runtimes

  // No endpoint configured -> immediate reviewed fallback.
  if (!apiUrl) {
    const res: CoachResponse = {
      word,
      explanation: fallbackFor(word),
      source: "fallback",
    };
    return NextResponse.json(res);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const prompt =
      `Explain the word "${word}" as it is used in this sentence: ` +
      `"${sentence}". Give one short, friendly sentence a young reader ` +
      `could understand. Do not repeat the sentence. Reply with only the ` +
      `explanation. /no_think`;

    const upstream = await fetch(apiUrl, {
      method: "POST",
      signal: AbortSignal.any([req.signal, controller.signal]),
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              "You are a patient reading helper. Keep explanations to one short, plain sentence.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 80,
        // Qwen3 non-thinking mode where the server honours it.
        chat_template_kwargs: { enable_thinking: false },
      }),
    });

    if (!upstream.ok) throw new Error(`Upstream ${upstream.status}`);

    const data = (await upstream.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const raw = data.choices?.[0]?.message?.content ?? "";
    const explanation = stripThinking(raw);

    if (!explanation) throw new Error("Empty model explanation");

    const res: CoachResponse = { word, explanation, source: "model" };
    return NextResponse.json(res);
  } catch {
    const res: CoachResponse = {
      word,
      explanation: fallbackFor(word),
      source: "fallback",
    };
    return NextResponse.json(res);
  } finally {
    clearTimeout(timer);
  }
}
