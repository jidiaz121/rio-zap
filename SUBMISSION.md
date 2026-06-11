# Devpost submission draft — Rio Zap

**Live URL: https://rio-zap.vercel.app** · Repo: https://github.com/jidiaz121/rio-zap

> Paste-ready answers. Numbers verified against INAF 2024 and live tool responses on build day.

## Inspiration

Roughly 29% of Brazilian adults are functionally illiterate (INAF 2024), and 95% of them fail basic smartphone tasks. Every "modernized" city service — forms, dashboards, chatbots — rebuilds the same wall in a new medium. Meanwhile Brazilians send more WhatsApp voice notes than anywhere else on Earth: the mic is already the national interface. And Rio already publishes its data live: full bus-fleet GPS, dengue alerts, 1746 complaints, weather. The data is open; the interface is what excludes people. So we built only the interface.

## What it does

One button. Speak to Rio in Portuguese or English — "Cadê o 483?" or "where do I enroll my kids in football?" — and the city answers out loud in your language, grounded in 5 municipal data sources (SPPO bus GPS, InfoDengue/Fiocruz, 1746 complaints, Open-Meteo, and the city's free sports programs). Tool-call cards animate while it thinks, showing which feed answered and how fresh the data is. Bus answers drop a live minimap. Switch language mid-conversation and Zap switches with you, no toggle. A "How Zap is steered" panel renders the actual live system prompt and tool contracts running in production.

## How we built it

Next.js App Router on Vercel serverless. Vercel AI SDK `streamText` with `claude-haiku-4-5` running a 4-tool loop (max 2 tool calls per turn); tool-invocation SSE events drive the animated cards. Voice: ElevenLabs Scribe (STT) and Flash v2.5 (TTS, one multilingual PT-BR voice for both languages), with rehearsed auto-fallbacks to the Web Speech API and `speechSynthesis` — each end of the chain flips independently on first failure. The 60MB+ SPPO feed is fetched and parsed in a serverless function with module-scope caching, a page-load warm ping, and a same-day labeled snapshot fallback. MapLibre + Carto dark raster tiles (OSM raster fallback) for the minimap.

## How we steered the prompts (the part we're proudest of)

The entire steering surface is one module, `lib/steering.ts`, imported by both the agent route and the in-app steering panel — so the prompt we show judges is provably the prompt that runs. The steering itself: a persona with a hard spoken-format budget (warm carioca tia, max 2 sentences, no lists — the reply is read aloud); a language-mirroring rule (always answer in the language of the user's last message); plain-language tool-selection rules; and a non-negotiable data-honesty rule — every number spoken must come verbatim from tool JSON in the conversation. Tool executors never throw: failures return labeled error objects so the model admits outages plainly, and snapshot-sourced data must be disclosed as "from earlier today, not live." The failure paths are themselves steered with few-shot examples (zero buses running, feed offline). When our BigQuery access for per-bairro 1746 counts fell through, we shipped the tool with only the officially publishable facts and told the model to say exactly that — honesty as a feature, enforced in the prompt.

## Challenges we ran into

The SPPO feed tripled in size on build day (60MB+, streaming slowly) and made live fetches miss our latency budget, so we shipped the rehearsed fallback: negative-cache + same-day labeled snapshots, with the agent disclosing freshness honestly. BigQuery access for 1746 per-bairro aggregates was unavailable, so the complaints tool was redesigned mid-build to serve only verifiable official numbers rather than estimates.

## Accomplishments

A bilingual voice civic agent grounded in 5 real municipal data sources, with transparent tool-calling and a provably-honest steering panel, working on a phone, deployed, in 3 hours. Voice survives every quota failure (browser floor), data survives every feed failure (labeled snapshots), and no number is ever invented.

## What's next

WhatsApp voice-note distribution — zero install, zero-rated, the channel this population already uses. The hackathon build is the browser proof; the name was the roadmap all along.
