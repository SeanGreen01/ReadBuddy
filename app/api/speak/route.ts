import { NextResponse } from "next/server";

// POST /api/speak  { text, requestId }  ->  audio/mpeg
// Speaks a short prompt or explanation using ElevenLabs eleven_flash_v2_5.
// Text length is capped and common prompts are cached in memory so repeated
// prompts ("Would you like to try it again?") don't re-synthesise.

const MODEL_ID = "eleven_flash_v2_5";
const DEFAULT_VOICE_ID = "EXAVITQu4vr4xnSDxMaL"; // "Sarah" – a premade voice usable on free plans
const MAX_CHARS = 400;

// Simple process-lifetime cache: text -> mp3 bytes.
const audioCache = new Map<string, Buffer>();

export async function POST(req: Request) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ELEVENLABS_API_KEY is not set on the server." },
      { status: 500 }
    );
  }

  let body: { text?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const rawText = typeof body.text === "string" ? body.text.trim() : "";
  if (!rawText) {
    return NextResponse.json({ error: "Missing 'text'." }, { status: 400 });
  }
  const text = rawText.slice(0, MAX_CHARS);

  const voiceId = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;
  const cacheKey = `${voiceId}:${text}`;

  const cached = audioCache.get(cacheKey);
  if (cached) {
    return new NextResponse(new Uint8Array(cached), {
      status: 200,
      headers: { "Content-Type": "audio/mpeg", "X-Cache": "hit" },
    });
  }

  try {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
      {
        method: "POST",
        signal: AbortSignal.any([req.signal, AbortSignal.timeout(15_000)]),
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: MODEL_ID,
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
      }
    );

    if (!res.ok) {
      const detail = await res.text();
      return NextResponse.json(
        { error: "Text-to-speech failed.", detail },
        { status: 502 }
      );
    }

    const buf = Buffer.from(await res.arrayBuffer());
    // Only cache short, reusable prompts to bound memory.
    if (text.length <= 120 && audioCache.size < 100) {
      audioCache.set(cacheKey, buf);
    }

    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: { "Content-Type": "audio/mpeg", "X-Cache": "miss" },
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Network error during text-to-speech.", detail: String(err) },
      { status: 502 }
    );
  }
}
