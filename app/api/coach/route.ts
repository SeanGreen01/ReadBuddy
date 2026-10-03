import { NextResponse } from "next/server";
import type { CoachResponse } from "@/lib/types";

// POST /api/coach  { word, sentence, requestId }  ->  CoachResponse
// Asks an open-weight model for a short, child-friendly explanation of `word`
// as used in `sentence`. Defaults to Google Gemma 4 via the Gemini API's
// OpenAI-compatible endpoint, but works with any OpenAI-compatible chat
// completions endpoint (e.g. a local runtime). On any failure it returns a
// short reviewed definition labelled as fallback, so the voice + alignment
// loop never depends on the language model.

// Gemma 4 is a reasoning model and always "thinks" before answering (thinking
// cannot be disabled on gemma-4-26b-a4b-it), so a call takes several seconds.
// Keep this under the client's 15s request abort.
const TIMEOUT_MS = 13000;
const MAX_WORD = 40;
const MAX_SENTENCE = 300;

// Google Gemini API, OpenAI-compatible surface. Gemma 4 is served here.
const DEFAULT_COACH_URL =
  "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
// Fast MoE Gemma 4 (≈4B active). Swap to "gemma-4-31b-it" for the dense model.
const DEFAULT_COACH_MODEL = "gemma-4-26b-a4b-it";

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
  kitten: "A kitten is a very young cat.",
  gate: "A gate is a door in a fence or wall.",
  knelt: "Knelt means went down on your knees.",
  milk: "Milk is the white drink that comes from cows.",
  waves: "Waves are the moving lines of water on the sea.",
  sand: "Sand is the tiny bits of rock on a beach.",
  castle: "A castle is a big, strong building — here one made of sand.",
  boat: "A boat is a small craft that travels on water.",
  sea: "The sea is the large body of salty water.",
  corner: "A corner is where two roads or edges meet.",
  board: "To get on board means to climb onto a bus, boat, or train.",
  soil: "Soil is the dark earth that plants grow in.",
  seed: "A seed is the tiny part that a new plant grows from.",
  shoot: "A shoot is a new, young part of a plant.",
  ground: "The ground is the surface of the earth under our feet.",
  bus: "A bus is a large vehicle that carries many people.",
};

function fallbackFor(word: string): string {
  const key = word.toLowerCase().replace(/[^a-z]/g, "");
  return (
    REVIEWED[key] ??
    `"${word}" is the word written here. Try reading it one sound at a time.`
  );
}

/** Strip any reasoning block before the final answer. Gemma emits
 * <thought>...</thought>; other models use <think>...</think>. */
function stripThinking(text: string): string {
  return text
    .replace(/<thought>[\s\S]*?<\/thought>/gi, "")
    .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, "")
    .trim();
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

  const apiKey = process.env.COACH_API_KEY; // Gemini API key for the hosted default
  const customUrl = process.env.COACH_API_URL; // override for a local/other endpoint
  const apiUrl = customUrl || DEFAULT_COACH_URL;
  const model = process.env.COACH_MODEL || DEFAULT_COACH_MODEL;

  // Need a key for the hosted endpoint, or a custom endpoint for local runtimes
  // (which often need no key). With neither, return a reviewed fallback.
  if (!apiKey && !customUrl) {
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
    // Gemma has no separate system role, so fold the instruction into the one
    // user turn. This stays valid for other OpenAI-compatible models too.
    const prompt =
      `You are a patient reading helper. Explain the word "${word}" as it is ` +
      `used in this sentence: "${sentence}". Reply with one short, friendly ` +
      `sentence a young reader could understand. Do not repeat the sentence.`;

    const upstream = await fetch(apiUrl, {
      method: "POST",
      signal: AbortSignal.any([req.signal, controller.signal]),
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        // Gemma 4 spends tokens on an internal <thought> block before the
        // answer, so budget enough for both; we strip the thought after.
        max_tokens: 1024,
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
