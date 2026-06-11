# Rio Zap

**Fala com a tua cidade. Talk to your city.**

A big mic button. Speak to Rio de Janeiro in Portuguese or English and the city answers by voice, grounded in 5 municipal data sources. Built in 3 hours at Web Summit Rio 2026.

~29% of Brazilian adults are functionally illiterate (INAF 2024) and 95% of them fail basic smartphone tasks. Every dashboard and text form excludes exactly the people public services exist for. Rio's data is already open — bus GPS, dengue alerts, 1746 complaints, weather. The interface is what excludes people. So we built only the interface: voice in, voice out, zero reading required.

## The 5 tools

| Tool | Source | Freshness |
|---|---|---|
| `getBusLive(linha)` | SPPO fleet GPS, dados.mobilidade.rio (~60MB live feed, parsed serverless) | live, 30s–2min cache, labeled snapshot fallback |
| `getDengue()` | InfoDengue (Fiocruz) | live, 1h cache, labeled snapshot fallback |
| `get1746Stats(bairro)` | Official 1746 publications (Prefeitura Rio, Câmara Municipal data) | static aggregate in repo, window labeled |
| `getWeather()` | Open-Meteo | live, labeled snapshot fallback |
| `getCityActivities(atividade?, bairro?)` | City sports venues & free programs (Prefeitura Rio open data) | official dataset in repo, as-of labeled |

## How Zap is steered (the honest part)

The system prompt and all 4 tool contracts live in [`lib/steering.ts`](lib/steering.ts) — a single module imported by **both** the `/api/agent` route and the in-app "How Zap is steered" panel. What you read in the UI is provably what runs; it cannot drift from production.

Steering decisions that matter:

- **Persona budget:** a warm carioca tia, max 2 spoken sentences, no lists or markdown (the reply is read aloud by TTS).
- **Language mirroring:** the agent always replies in the language of the user's last message — PT/EN code-switch with no toggle.
- **Data honesty (non-negotiable):** every number spoken must come verbatim from a tool result in the conversation. Tool executors never throw — failures return labeled error JSON so the agent admits outages plainly, and snapshot data is always disclosed as "from earlier today, not live."
- **Steered failure paths:** zero buses running and feed-offline are few-shot examples in the prompt, not afterthoughts.

## Architecture

```
mic (MediaRecorder) -> POST /api/stt  (ElevenLabs Scribe)   [auto-fallback: Web Speech API]
text + chips -------> POST /api/agent (AI SDK streamText, claude-haiku-4-5)
                        |- 5 in-process tools, SSE tool events -> animated cards
reply text ---------> POST /api/tts  (ElevenLabs Flash v2.5) [auto-fallback: speechSynthesis]
bus positions ------> MapLibre minimap (Carto dark -> OSM raster -> text-only floor)
```

Every external dependency has a rehearsed fallback; each end of the voice chain flips independently. LLM chain: `claude-haiku-4-5` -> `claude-sonnet-4-6` (env) -> Gemini (`ZAP_LLM=google`, preinstalled).

## Run it

```bash
npm install
cp .env.example .env.local   # fill in keys (app degrades gracefully without ElevenLabs)
npm run dev
```

Data snapshots in `data/` were captured from the live feeds on build day and are served only when a live fetch fails, always labeled `"source": "snapshot"`.
