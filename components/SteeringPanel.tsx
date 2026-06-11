"use client";

// Renders the LIVE steering constants — the exact same module /api/agent
// imports. What you read here is what runs. (No separate API route: shared
// module = provably honest, one less thing to break.)
import { DATA_SOURCES, SYSTEM_PROMPT, TOOL_CONTRACTS } from "@/lib/steering";

export default function SteeringPanel({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-label="How Zap is steered"
    >
      <div
        className="h-full w-full max-w-xl overflow-y-auto border-l border-white/10 bg-[#0c1117] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-zinc-100">How Zap is steered</h2>
          <button
            onClick={onClose}
            className="rounded-lg border border-white/10 px-2.5 py-1 text-sm text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
          >
            close
          </button>
        </div>
        <p className="mb-6 text-[13px] leading-relaxed text-zinc-500">
          This panel imports the <span className="font-mono text-zinc-400">lib/steering.ts</span>{" "}
          module — the exact same constants the agent runs on. Nothing here is a copy; it cannot
          drift from production.
        </p>

        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-amber-300/90">
          System prompt (live)
        </h3>
        <pre className="mb-6 whitespace-pre-wrap rounded-xl border border-white/10 bg-black/40 p-4 font-mono text-[11.5px] leading-relaxed text-zinc-300">
          {SYSTEM_PROMPT}
        </pre>

        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-amber-300/90">
          Tool contracts (4, exactly)
        </h3>
        <div className="mb-6 space-y-2">
          {TOOL_CONTRACTS.map((t) => (
            <div key={t.name} className="rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
              <div className="font-mono text-[13px] font-semibold text-zinc-200">{t.name}</div>
              <div className="mt-1 text-[12.5px] leading-snug text-zinc-400">{t.description}</div>
              {t.params.length > 0 && (
                <div className="mt-2 space-y-1">
                  {t.params.map((p) => (
                    <div key={p.name} className="font-mono text-[11.5px] text-zinc-500">
                      {p.name}: {p.type} — {p.description}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-amber-300/90">
          Data sources
        </h3>
        <div className="space-y-2 pb-8">
          {DATA_SOURCES.map((s) => (
            <div key={s.tool} className="rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
              <div className="text-[13px] font-medium text-zinc-200">{s.name}</div>
              <div className="mt-0.5 font-mono text-[11.5px] text-zinc-500">{s.url}</div>
              <div className="mt-0.5 text-[12px] text-zinc-400">{s.freshness}</div>
            </div>
          ))}
          <p className="pt-2 text-[12px] leading-relaxed text-zinc-500">
            Data honesty rule: every number Zap speaks comes verbatim from a tool result. Tools
            never throw — failures come back as labeled error JSON, and snapshot data is always
            disclosed as not live.
          </p>
        </div>
      </div>
    </div>
  );
}
