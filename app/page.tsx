"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useCallback, useEffect, useRef, useState } from "react";
import MiniMap, { type BusPosition } from "@/components/MiniMap";
import SteeringPanel from "@/components/SteeringPanel";
import ToolCard, { type ToolPartView } from "@/components/ToolCard";

const DEMO_LINHA = "483";

const CHIPS: readonly { label: string; lang: "pt" | "en" }[] = [
  { label: "Cadê o 483?", lang: "pt" },
  { label: "Como tá a dengue no Rio?", lang: "pt" },
  { label: "Do que Copacabana mais reclama?", lang: "pt" },
  { label: "Where is bus 483 right now?", lang: "en" },
  { label: "Will it rain in Rio today?", lang: "en" },
  { label: "What does Centro complain about most?", lang: "en" },
];

const SILENT_WAV =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

function detectLang(text: string): "pt" | "en" {
  return /[ãõçáàâêéíóôú]|\b(cadê|tá|tem|onde|vai|hoje|como|chover|ônibus|reclama|aqui|agora)\b/i.test(
    text,
  )
    ? "pt"
    : "en";
}

interface RawToolPart {
  type: string;
  toolCallId: string;
  state: string;
  input?: unknown;
  output?: Record<string, unknown>;
  errorText?: string;
}

function toolParts(m: UIMessage): ToolPartView[] {
  return m.parts
    .filter((p) => p.type.startsWith("tool-"))
    .map((p) => {
      const t = p as unknown as RawToolPart;
      return {
        toolCallId: t.toolCallId,
        name: t.type.slice(5),
        state: t.state,
        input: t.input,
        output: t.output,
        errorText: t.errorText,
      };
    });
}

function textOf(m: UIMessage): string {
  return m.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join(" ")
    .trim();
}

function busPositions(m: UIMessage): BusPosition[] {
  const parts = toolParts(m).filter(
    (t) => t.name === "getBusLive" && t.state === "output-available",
  );
  const last = parts[parts.length - 1];
  const positions = last?.output?.positions;
  return Array.isArray(positions) ? (positions as BusPosition[]) : [];
}

// Minimal Web Speech typings (STT fallback, tech spec §7).
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

type MicState = "idle" | "recording" | "transcribing";

export default function Home() {
  const [input, setInput] = useState("");
  const [micState, setMicState] = useState<MicState>("idle");
  const [micNote, setMicNote] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [steeringOpen, setSteeringOpen] = useState(false);
  const [steeringSeen, setSteeringSeen] = useState(false);
  const [firstLang, setFirstLang] = useState<"pt" | "en" | null>(null);
  const [suggestionUsed, setSuggestionUsed] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ttsDown = useRef(false);
  const sttDown = useRef(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const webSpeechRef = useRef<SpeechRecognitionLike | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const speak = useCallback(async (text: string) => {
    if (!text) return;
    setSpeaking(true);
    try {
      if (ttsDown.current) throw new Error("tts down");
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok || !res.headers.get("Content-Type")?.includes("audio")) {
        if (res.status === 503) ttsDown.current = true;
        throw new Error("tts unavailable");
      }
      const url = URL.createObjectURL(await res.blob());
      const audio = audioRef.current ?? new Audio();
      audioRef.current = audio;
      audio.onended = () => {
        setSpeaking(false);
        URL.revokeObjectURL(url);
      };
      audio.src = url;
      await audio.play();
    } catch {
      // browser TTS floor — never cut voice out
      try {
        const u = new SpeechSynthesisUtterance(text);
        u.lang = detectLang(text) === "pt" ? "pt-BR" : "en-US";
        u.onend = () => setSpeaking(false);
        window.speechSynthesis.speak(u);
      } catch {
        setSpeaking(false);
      }
    }
  }, []);

  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: "/api/agent" }),
    onFinish: ({ message }) => {
      const text = textOf(message);
      if (text) void speak(text);
    },
  });

  const busy = status === "submitted" || status === "streaming";
  const hasAnswered = messages.some((m) => m.role === "assistant");

  const unlockAudio = useCallback(() => {
    if (audioRef.current) return;
    const a = new Audio(SILENT_WAV);
    a.play().catch(() => {});
    audioRef.current = a;
  }, []);

  const handleSend = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busy) return;
      unlockAudio();
      window.speechSynthesis?.cancel();
      if (audioRef.current) audioRef.current.pause();
      setSpeaking(false);
      setFirstLang((prev) => prev ?? detectLang(trimmed));
      void sendMessage({ text: trimmed });
      setInput("");
    },
    [busy, sendMessage, unlockAudio],
  );

  // --- voice in: MediaRecorder -> /api/stt (Scribe); auto-flip to Web Speech.
  const startWebSpeech = useCallback(() => {
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) {
      setMicNote("This browser has no speech recognition. Type below or tap a chip.");
      setMicState("idle");
      return;
    }
    const rec = new Ctor();
    webSpeechRef.current = rec;
    rec.lang = "pt-BR";
    rec.continuous = false;
    rec.interimResults = false;
    rec.onresult = (e) => {
      const transcript = Array.from(
        { length: e.results.length },
        (_, i) => e.results[i][0].transcript,
      ).join(" ");
      setMicState("idle");
      handleSend(transcript);
    };
    rec.onerror = () => {
      setMicState("idle");
      setMicNote("Could not hear you. Type below or tap a chip.");
    };
    rec.onend = () => setMicState((s) => (s === "recording" ? "idle" : s));
    setMicState("recording");
    rec.start();
  }, [handleSend]);

  const stopRecording = useCallback(() => {
    if (recTimerRef.current) clearTimeout(recTimerRef.current);
    recorderRef.current?.stop();
    webSpeechRef.current?.stop();
  }, []);

  const sendToStt = useCallback(
    async (blob: Blob) => {
      setMicState("transcribing");
      try {
        const form = new FormData();
        form.append("audio", blob, "clip.webm");
        const res = await fetch("/api/stt", {
          method: "POST",
          body: form,
          signal: AbortSignal.timeout(6000),
        });
        if (!res.ok) throw new Error(`stt ${res.status}`);
        const data = (await res.json()) as { text?: string };
        setMicState("idle");
        if (data.text?.trim()) {
          handleSend(data.text);
        } else {
          setMicNote("Did not catch that — try again, type, or tap a chip.");
        }
      } catch {
        sttDown.current = true;
        setMicState("idle");
        setMicNote("Switched to on-device speech recognition. Tap the mic again.");
      }
    },
    [handleSend],
  );

  const startRecording = useCallback(async () => {
    setMicNote(null);
    unlockAudio();
    if (sttDown.current) {
      startWebSpeech();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"
          : "";
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      recorderRef.current = rec;
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        void sendToStt(new Blob(chunks, { type: mime || "audio/webm" }));
      };
      rec.start();
      setMicState("recording");
      recTimerRef.current = setTimeout(stopRecording, 15_000);
    } catch {
      setMicNote("Mic blocked — chips and the text box work exactly the same.");
      setMicState("idle");
    }
  }, [sendToStt, startWebSpeech, stopRecording, unlockAudio]);

  const toggleMic = useCallback(() => {
    if (micState === "recording") stopRecording();
    else if (micState === "idle" && !busy) void startRecording();
  }, [micState, busy, startRecording, stopRecording]);

  // Warm ping (tech spec §4): the judge's first bus query hits a hot cache.
  useEffect(() => {
    fetch(`/api/tools/bus?linha=${DEMO_LINHA}&warm=1`).catch(() => {});
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const suggestion =
    hasAnswered && !suggestionUsed && firstLang
      ? firstLang === "en"
        ? { label: "Como tá a dengue no Rio?", hint: "try it in Portuguese" }
        : { label: "How's the dengue alert in Rio right now?", hint: "try it in English" }
      : null;

  return (
    <main className="relative mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-4">
      {speaking && (
        <div className="card-in fixed right-4 top-4 z-40 flex items-center gap-2 rounded-full border border-amber-300/30 bg-amber-300/10 px-3.5 py-1.5 text-xs font-medium text-amber-200 backdrop-blur">
          <span className="relative flex h-2 w-2">
            <span className="absolute h-2 w-2 animate-ping rounded-full bg-amber-300 opacity-75" />
            <span className="h-2 w-2 rounded-full bg-amber-300" />
          </span>
          Sound on — Zap is speaking
        </div>
      )}

      <header className="pt-4 sm:pt-5">
        <div className="flex items-center justify-between pb-2">
          <div>
            <h1 className="text-lg font-bold tracking-tight text-zinc-100">
              Zap <span className="text-[#fedd00]">da Cidade</span>
            </h1>
            <p className="text-[12px] text-zinc-500">Fala com a tua cidade. Talk to your city.</p>
          </div>
          <button
            onClick={() => {
              setSteeringOpen(true);
              setSteeringSeen(true);
            }}
            className={`shrink-0 rounded-full border border-white/10 px-3 py-1.5 text-[12px] text-zinc-400 transition hover:border-amber-300/40 hover:text-amber-200 ${
              hasAnswered && !steeringSeen ? "pulse-once" : ""
            }`}
          >
            How Zap is steered
          </button>
        </div>
        <div className="flag-stripe" aria-hidden />
      </header>

      <section className="flex-1 overflow-y-auto py-4">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 pb-10 pt-16 text-center">
            <div className="hero-glow" aria-hidden />
            <h2 className="max-w-md text-2xl font-bold leading-tight tracking-tight text-zinc-100 sm:text-3xl">
              Ask Rio anything, <span className="text-[#fedd00]">out loud</span>.
            </h2>
            <p className="max-w-sm text-[14px] leading-relaxed text-zinc-400">
              Buses, dengue, complaints, weather — live city data, answered by voice in Portuguese
              or English. No forms, no reading required.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((m) => (
              <div key={m.id}>
                {m.role === "user" ? (
                  <div className="flex justify-end">
                    <div className="card-in max-w-[85%] rounded-2xl rounded-br-md bg-amber-300/90 px-4 py-2.5 text-[14.5px] font-medium leading-snug text-zinc-900">
                      {textOf(m)}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {toolParts(m).map((t) => (
                      <ToolCard key={t.toolCallId} part={t} />
                    ))}
                    {textOf(m) && (
                      <div className="card-in max-w-[85%] rounded-2xl rounded-bl-md border border-white/10 bg-white/[0.05] px-4 py-2.5 text-[14.5px] leading-relaxed text-zinc-100">
                        {textOf(m)}
                      </div>
                    )}
                    {busPositions(m).length > 0 && <MiniMap positions={busPositions(m)} />}
                  </div>
                )}
              </div>
            ))}
            {busy && !messages.some((m) => m.role === "assistant" && textOf(m)) && (
              <div className="flex items-center gap-2 pl-1 text-[13px] text-zinc-500">
                <span className="h-1.5 w-1.5 animate-ping rounded-full bg-amber-300/70" />
                Zap is thinking...
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </section>

      <footer className="sticky bottom-0 bg-gradient-to-t from-[#0a0e14] via-[#0a0e14] to-transparent pb-5 pt-2">
        {suggestion && (
          <div className="mb-2.5 flex justify-center">
            <button
              onClick={() => {
                setSuggestionUsed(true);
                handleSend(suggestion.label);
              }}
              className="card-in flex items-center gap-2 rounded-full border border-emerald-400/40 bg-emerald-400/10 px-4 py-2 text-[13px] font-medium text-emerald-200 transition hover:bg-emerald-400/20"
            >
              <span className="text-[10px] uppercase tracking-wider text-emerald-300/70">
                {suggestion.hint}
              </span>
              {suggestion.label}
            </button>
          </div>
        )}

        <div className="chip-rail -mx-4 mb-3 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:justify-center sm:overflow-visible sm:px-0">
          {CHIPS.map((c) => (
            <button
              key={c.label}
              onClick={() => handleSend(c.label)}
              disabled={busy}
              className="shrink-0 whitespace-nowrap rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[12.5px] text-zinc-300 transition hover:border-white/25 hover:bg-white/[0.08] disabled:opacity-40"
            >
              {c.label}
            </button>
          ))}
        </div>

        <div className="mb-3 flex justify-center">
          <button
            onClick={toggleMic}
            disabled={busy || micState === "transcribing"}
            aria-label={micState === "recording" ? "Stop recording" : "Start talking"}
            className={`relative flex h-16 w-16 items-center justify-center rounded-full transition-transform active:scale-95 sm:h-20 sm:w-20 ${
              micState === "recording"
                ? "mic-recording bg-rose-500"
                : "mic-idle bg-gradient-to-b from-[#fedd00] to-amber-400"
            } ${busy || micState === "transcribing" ? "opacity-60" : ""}`}
          >
            {micState === "transcribing" ? (
              <span className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-900/30 border-t-zinc-900" />
            ) : (
              <svg
                viewBox="0 0 24 24"
                className="h-7 w-7 text-zinc-900 sm:h-8 sm:w-8"
                fill="currentColor"
                aria-hidden
              >
                <path d="M12 15a3.5 3.5 0 0 0 3.5-3.5v-5a3.5 3.5 0 1 0-7 0v5A3.5 3.5 0 0 0 12 15Zm6-3.5a1 1 0 1 1 2 0 8 8 0 0 1-7 7.94V21h2a1 1 0 1 1 0 2h-6a1 1 0 1 1 0-2h2v-1.56a8 8 0 0 1-7-7.94 1 1 0 1 1 2 0 6 6 0 0 0 12 0Z" />
              </svg>
            )}
          </button>
        </div>
        <p className="mb-3 text-center text-[11.5px] text-zinc-500">
          {micState === "recording"
            ? "Listening... tap to stop (15s max)"
            : micState === "transcribing"
              ? "Transcribing..."
              : (micNote ?? "Tap and talk — português or English")}
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend(input);
          }}
          className="flex gap-2"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="or type, Zap reads both"
            className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-[14px] text-zinc-100 placeholder-zinc-600 outline-none transition focus:border-amber-300/40"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="rounded-xl bg-amber-300 px-4 py-2.5 text-[14px] font-semibold text-zinc-900 transition hover:bg-amber-200 disabled:opacity-40"
          >
            Send
          </button>
        </form>
      </footer>

      {steeringOpen && <SteeringPanel onClose={() => setSteeringOpen(false)} />}
    </main>
  );
}
