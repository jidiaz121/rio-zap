// ElevenLabs Flash v2.5 TTS (premium PT-BR voice, multilingual: one voice
// speaks both PT and EN). On any failure the client falls back to
// speechSynthesis — clean fast errors here.

export const maxDuration = 30;

export async function POST(req: Request) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  if (!apiKey || !voiceId) {
    return Response.json(
      { error: { code: "tts_not_configured", message: "ELEVENLABS_API_KEY or ELEVENLABS_VOICE_ID missing" } },
      { status: 503 },
    );
  }
  try {
    const { text } = (await req.json()) as { text?: string };
    if (!text || !text.trim()) {
      return Response.json(
        { error: { code: "bad_request", message: "text required" } },
        { status: 400 },
      );
    }
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?output_format=mp3_44100_64`,
      {
        method: "POST",
        headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          text: text.slice(0, 600),
          model_id: "eleven_flash_v2_5",
          voice_settings: { stability: 0.45, similarity_boost: 0.75 },
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      return Response.json(
        { error: { code: "tts_upstream", message: `Flash ${res.status}: ${detail.slice(0, 200)}` } },
        { status: 502 },
      );
    }
    return new Response(res.body, {
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown";
    return Response.json(
      { error: { code: "tts_failed", message } },
      { status: 502 },
    );
  }
}
