// ElevenLabs Scribe STT. On any failure the client flips its session flag to
// the Web Speech API — so this route just returns clean errors fast.

export const maxDuration = 30;

export async function POST(req: Request) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: { code: "stt_not_configured", message: "ELEVENLABS_API_KEY missing" } },
      { status: 503 },
    );
  }
  try {
    const form = await req.formData();
    const audio = form.get("audio");
    if (!(audio instanceof Blob)) {
      return Response.json(
        { error: { code: "bad_request", message: "field 'audio' must be a file" } },
        { status: 400 },
      );
    }
    const upstream = new FormData();
    upstream.append("file", audio, "clip.webm");
    upstream.append("model_id", "scribe_v1");
    upstream.append("tag_audio_events", "false");

    const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: { "xi-api-key": apiKey },
      body: upstream,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return Response.json(
        { error: { code: "stt_upstream", message: `Scribe ${res.status}: ${detail.slice(0, 200)}` } },
        { status: 502 },
      );
    }
    const data = (await res.json()) as { text?: string; language_code?: string };
    return Response.json({
      text: data.text ?? "",
      language: (data.language_code ?? "pt").slice(0, 2),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown";
    return Response.json(
      { error: { code: "stt_failed", message } },
      { status: 502 },
    );
  }
}
