import { NextResponse } from "next/server";

// POST /api/scribe-token
// Mints a single-use realtime_scribe token so the browser can open a Scribe
// WebSocket without ever seeing the permanent ElevenLabs API key.
// The token expires after ~15 minutes (enforced by ElevenLabs).

export async function POST() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ELEVENLABS_API_KEY is not set on the server." },
      { status: 500 }
    );
  }

  try {
    const res = await fetch(
      "https://api.elevenlabs.io/v1/single-use-token/realtime_scribe",
      {
        method: "POST",
        headers: { "xi-api-key": apiKey },
      }
    );

    if (!res.ok) {
      const detail = await res.text();
      return NextResponse.json(
        { error: "Failed to mint Scribe token.", detail },
        { status: 502 }
      );
    }

    const data = (await res.json()) as { token?: string };
    if (!data.token) {
      return NextResponse.json(
        { error: "Scribe token response had no token." },
        { status: 502 }
      );
    }

    return NextResponse.json({ token: data.token });
  } catch (err) {
    return NextResponse.json(
      { error: "Network error minting Scribe token.", detail: String(err) },
      { status: 502 }
    );
  }
}
