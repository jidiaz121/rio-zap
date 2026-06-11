"use client";

export interface ToolPartView {
  toolCallId: string;
  name: string;
  state: string; // input-streaming | input-available | output-available | output-error
  input?: unknown;
  output?: Record<string, unknown>;
  errorText?: string;
}

const TOOL_META: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  getBusLive: {
    label: "getBusLive",
    color: "text-amber-300",
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
        <path d="M4 16V6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v10a2 2 0 0 1-1 1.73V19a1 1 0 0 1-2 0v-1H7v1a1 1 0 0 1-2 0v-1.27A2 2 0 0 1 4 16Zm2-9h12V6a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1v1Zm0 2v4h12V9H6Zm1.5 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm9 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" />
      </svg>
    ),
  },
  getDengue: {
    label: "getDengue",
    color: "text-rose-300",
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
        <path d="M12 3a4 4 0 0 1 4 4v3a4 4 0 0 1-8 0V7a4 4 0 0 1 4-4Zm-7 8a1 1 0 0 1 1-1h1a1 1 0 0 1 0 2H6a1 1 0 0 1-1-1Zm12-1h1a1 1 0 0 1 0 2h-1a1 1 0 0 1 0-2ZM8.5 15.6a1 1 0 0 1 .3 1.4l-1.6 2.4a1 1 0 0 1-1.7-1.1l1.6-2.4a1 1 0 0 1 1.4-.3Zm7 0a1 1 0 0 1 1.4.3l1.6 2.4a1 1 0 1 1-1.7 1.1l-1.6-2.4a1 1 0 0 1 .3-1.4ZM12 16a1 1 0 0 1 1 1v3a1 1 0 0 1-2 0v-3a1 1 0 0 1 1-1Z" />
      </svg>
    ),
  },
  get1746Stats: {
    label: "get1746Stats",
    color: "text-sky-300",
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
        <path d="M3 10v4a1 1 0 0 0 1 1h2l4 4a1 1 0 0 0 1.7-.7V5.7A1 1 0 0 0 10 5L6 9H4a1 1 0 0 0-1 1Zm12.5-2.6a1 1 0 0 1 1.4.2 7 7 0 0 1 0 8.8 1 1 0 1 1-1.6-1.2 5 5 0 0 0 0-6.4 1 1 0 0 1 .2-1.4Z" />
      </svg>
    ),
  },
  getWeather: {
    label: "getWeather",
    color: "text-cyan-300",
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
        <path d="M7 18a5 5 0 0 1-.9-9.92 6 6 0 0 1 11.62 1.1A4.5 4.5 0 0 1 17.5 18H7Z" />
      </svg>
    ),
  },
  getCityActivities: {
    label: "getCityActivities",
    color: "text-emerald-300",
    icon: (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
        <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 2c.9 0 1.77.15 2.58.43L12 6.5 9.42 4.43A8 8 0 0 1 12 4Zm-5.9 2.7L8.5 9l-1.6 3.1-2.83-.6a8 8 0 0 1 2.03-4.8Zm1.4 9.8 2.1-.4 1.4 2.6-1.1 2.4a8.04 8.04 0 0 1-4.1-3.5l1.7-1.1Zm6.9 4.9-1.2-2.6 1.4-2.7 2.2.4 1.6 1.2a8.04 8.04 0 0 1-4 3.7Zm3.5-7.3L16.3 9l2.4-2.3a8 8 0 0 1 2 4.9l-2.8.5ZM10.3 13l1.7-3.3 1.8 3.4-1.8 3.3-1.7-3.4Z" />
      </svg>
    ),
  },
};

function summarize(name: string, output: Record<string, unknown> | undefined): string {
  if (!output) return "";
  const err = output.error as { code?: string; message?: string } | undefined;
  if (err) {
    const sug = output.suggestions as string[] | undefined;
    return `error: ${err.code ?? "unknown"}${sug ? ` · try ${sug.join(", ")}` : ""}`;
  }
  const src = output.source === "snapshot" ? " · snapshot (not live)" : "";
  switch (name) {
    case "getBusLive": {
      const n = output.count_active as number;
      if (n === 0) return `0 buses reporting${src}`;
      const freshest = (output.positions as { age_s: number }[] | undefined)?.[0]?.age_s;
      return `${n} active · avg ${output.avg_speed_kmh} km/h${freshest != null ? ` · freshest ${freshest}s ago` : ""}${src}`;
    }
    case "getDengue":
      return `level ${output.nivel} (${output.nivel_label}) · Rt ${output.rt ?? "?"} · ${output.cases_notified_ytd ?? "?"} cases YTD${src}`;
    case "get1746Stats": {
      const rankings = output.bairro_rankings;
      if (Array.isArray(rankings) && rankings.length > 0) {
        const cats = (rankings as { categoria: string }[]).map((r) => r.categoria.split(" (")[0]);
        return `${output.bairro} · in official top-5 for: ${cats.join(", ")}`;
      }
      return `${output.bairro} · not in verified top-5 rankings · citywide data attached`;
    }
    case "getWeather":
      return `${output.temp_c}°C · ${output.condition} · rain next 3h ${output.rain_prob_next_3h_pct ?? "?"}%${src}`;
    case "getCityActivities": {
      const matches = output.matches as { nome: string }[] | undefined;
      const n = output.count_total_matches as number | undefined;
      if (!matches?.length) return "no matching city programs";
      return `${n ?? matches.length} venue(s) · ${matches
        .slice(0, 2)
        .map((m) => m.nome)
        .join(", ")}${matches.length > 2 ? "…" : ""}`;
    }
    default:
      return JSON.stringify(output).slice(0, 120);
  }
}

export default function ToolCard({ part }: { part: ToolPartView }) {
  const meta = TOOL_META[part.name] ?? {
    label: part.name,
    color: "text-zinc-300",
    icon: null,
  };
  const running = part.state === "input-streaming" || part.state === "input-available";
  const failed = part.state === "output-error";
  const args =
    part.input && Object.keys(part.input as Record<string, unknown>).length > 0
      ? JSON.stringify(part.input)
      : "";
  const elapsed =
    part.output && typeof part.output.elapsed_ms === "number" ? `${part.output.elapsed_ms}ms` : null;

  return (
    <div className="card-in flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 backdrop-blur-sm">
      <span className={`mt-0.5 shrink-0 ${meta.color}`}>{meta.icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className={`font-mono text-xs font-semibold ${meta.color}`}>{meta.label}</span>
          {args && <span className="truncate font-mono text-[11px] text-zinc-500">{args}</span>}
          {elapsed && (
            <span className="ml-auto shrink-0 font-mono text-[10px] text-zinc-500">{elapsed}</span>
          )}
        </div>
        <div className="mt-0.5 text-[13px] leading-snug text-zinc-300">
          {running ? (
            <span className="inline-flex items-center gap-1.5 text-zinc-400">
              <span className="h-1.5 w-1.5 animate-ping rounded-full bg-amber-300/80" />
              consulting the city...
            </span>
          ) : failed ? (
            <span className="text-rose-300">tool failed: {part.errorText ?? "unknown"}</span>
          ) : (
            summarize(part.name, part.output)
          )}
        </div>
      </div>
    </div>
  );
}
