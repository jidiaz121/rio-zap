// Tool executors. HARD RULE: these never throw — every failure path returns
// an { error: { code, message } } object so the agent can answer honestly.

import sppoSnapshot from "@/data/sppo-snapshot.json";
import dengueSnapshot from "@/data/dengue-snapshot.json";
import weatherSnapshot from "@/data/weather-snapshot.json";
import aggregates1746 from "@/data/1746-aggregates.json";
import bairroNames from "@/data/bairro-names.json";

export interface ToolError {
  error: { code: string; message: string };
  [key: string]: unknown;
}

type ToolResult = Record<string, unknown>;

function toolError(code: string, message: string, extra?: ToolResult): ToolError {
  return { error: { code, message }, ...extra };
}

// ---------------------------------------------------------------- bus (SPPO)

interface SppoRecord {
  ordem: string;
  linha: string;
  latitude: string | number;
  longitude: string | number;
  datahora: string | number;
  velocidade: string | number;
}

interface BusPosition {
  ordem: string;
  lat: number;
  lon: number;
  speed_kmh: number;
  age_s: number;
}

const SPPO_URL = "https://dados.mobilidade.rio/gps/sppo";
// The feed is degraded on build day (60MB+, slow stream), so: longer TTL on a
// good fetch, a 90s negative cache after a failure (serve snapshot instantly
// instead of burning the timeout on every question), and the page-load warm
// ping is the one caller allowed a long live attempt.
const SPPO_TTL_MS = 120_000;
const SPPO_FAIL_TTL_MS = 90_000;

let sppoCache: { ts: number; records: SppoRecord[] } | null = null;
let sppoFailTs = 0;

function toNum(v: string | number): number {
  if (typeof v === "number") return v;
  return parseFloat(v.replace(",", "."));
}

function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

function extractRecords(raw: unknown): SppoRecord[] {
  if (Array.isArray(raw)) return raw as SppoRecord[];
  if (raw && typeof raw === "object") {
    for (const v of Object.values(raw as Record<string, unknown>)) {
      if (Array.isArray(v)) return v as SppoRecord[];
    }
  }
  return [];
}

function pipeline(records: SppoRecord[], linha: string, nowMs: number, maxAgeS: number | null) {
  const want = digitsOnly(linha);
  const byOrdem = new Map<string, SppoRecord>();
  for (const r of records) {
    if (!r || typeof r.linha !== "string" || digitsOnly(r.linha) !== want) continue;
    const prev = byOrdem.get(r.ordem);
    if (!prev || Number(r.datahora) > Number(prev.datahora)) byOrdem.set(r.ordem, r);
  }
  let positions: BusPosition[] = [];
  for (const r of byOrdem.values()) {
    const age_s = Math.round((nowMs - Number(r.datahora)) / 1000);
    if (maxAgeS !== null && age_s > maxAgeS) continue;
    positions.push({
      ordem: r.ordem,
      lat: toNum(r.latitude),
      lon: toNum(r.longitude),
      speed_kmh: Math.round(toNum(r.velocidade)),
      age_s: Math.max(age_s, 0),
    });
  }
  positions = positions
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon))
    .sort((a, b) => a.age_s - b.age_s)
    .slice(0, 25);
  const avg =
    positions.length > 0
      ? Math.round(positions.reduce((s, p) => s + p.speed_kmh, 0) / positions.length)
      : 0;
  return { count_active: positions.length, avg_speed_kmh: avg, positions };
}

function busFromSnapshot(linha: string): ToolResult {
  const snap = sppoSnapshot as unknown as { recorded_at?: string; records?: SppoRecord[] };
  const records = snap.records ?? extractRecords(sppoSnapshot);
  if (!records.length) {
    return toolError("bus_feed_offline", "Live bus feed unreachable and no snapshot is available.");
  }
  // Ages relative to the snapshot's own freshest record, no max-age drop.
  const maxDatahora = Math.max(...records.map((r) => Number(r.datahora) || 0));
  const result = pipeline(records, linha, maxDatahora, null);
  return {
    source: "snapshot",
    recorded_at: snap.recorded_at ?? "earlier today",
    notice:
      "SNAPSHOT, NOT LIVE: positions recorded earlier today. You MUST tell the user this is from earlier today, not live.",
    linha: digitsOnly(linha),
    ...result,
  };
}

export async function getBusLive(
  linha: string,
  opts?: { warm?: boolean },
): Promise<ToolResult> {
  const started = Date.now();
  try {
    if (!sppoCache || Date.now() - sppoCache.ts > SPPO_TTL_MS) {
      if (!opts?.warm && Date.now() - sppoFailTs < SPPO_FAIL_TTL_MS) {
        throw new Error("SPPO fetch failed recently, serving snapshot");
      }
      const timeoutMs = opts?.warm ? 45_000 : 8_000;
      const res = await fetch(SPPO_URL, {
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`SPPO HTTP ${res.status}`);
      const raw = await res.json();
      const records = extractRecords(raw);
      if (!records.length) throw new Error("SPPO feed returned no records");
      sppoCache = { ts: Date.now(), records };
      sppoFailTs = 0;
    }
    const result = pipeline(sppoCache.records, linha, Date.now(), 600);
    return {
      source: "live",
      fetched_at: new Date(sppoCache.ts).toISOString(),
      linha: digitsOnly(linha),
      ...result,
      elapsed_ms: Date.now() - started,
    };
  } catch {
    sppoFailTs = Date.now();
    return { ...busFromSnapshot(linha), elapsed_ms: Date.now() - started };
  }
}

// ------------------------------------------------------------------- dengue

const DENGUE_TTL_MS = 60 * 60 * 1000;
let dengueCache: { ts: number; result: ToolResult } | null = null;

interface DengueWeek {
  SE?: number;
  nivel?: number;
  Rt?: number;
  casos?: number;
  casos_est?: number;
  [key: string]: unknown;
}

const NIVEL_LABELS: Record<number, string> = {
  1: "green",
  2: "yellow",
  3: "orange",
  4: "red",
};

function shapeDengue(weeks: DengueWeek[], source: string): ToolResult {
  if (!Array.isArray(weeks) || weeks.length === 0) {
    return toolError("dengue_empty", "InfoDengue returned no data.");
  }
  const sorted = [...weeks].sort((a, b) => Number(a.SE ?? 0) - Number(b.SE ?? 0));
  const latest = sorted[sorted.length - 1];
  const ytd = sorted.reduce((s, w) => s + (Number(w.casos) || 0), 0);
  const se = Number(latest.SE ?? 0); // format YYYYWW
  const nivel = Number(latest.nivel ?? 0);
  return {
    source,
    nivel,
    nivel_label: NIVEL_LABELS[nivel] ?? String(nivel),
    rt: latest.Rt !== undefined ? Math.round(Number(latest.Rt) * 100) / 100 : null,
    cases_est_week: latest.casos_est !== undefined ? Math.round(Number(latest.casos_est)) : null,
    cases_notified_ytd: ytd,
    week: se ? `${Math.floor(se / 100)}-W${String(se % 100).padStart(2, "0")}` : null,
  };
}

export async function getDengue(): Promise<ToolResult> {
  const started = Date.now();
  if (dengueCache && Date.now() - dengueCache.ts < DENGUE_TTL_MS) {
    return { ...dengueCache.result, elapsed_ms: Date.now() - started };
  }
  const year = new Date().getFullYear();
  const url = `https://info.dengue.mat.br/api/alertcity?geocode=3304557&disease=dengue&format=json&ew_start=1&ew_end=53&ey_start=${year}&ey_end=${year}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000), cache: "no-store" });
    if (!res.ok) throw new Error(`InfoDengue HTTP ${res.status}`);
    const weeks = (await res.json()) as DengueWeek[];
    const result = shapeDengue(weeks, "live");
    if (!("error" in result)) dengueCache = { ts: Date.now(), result };
    return { ...result, elapsed_ms: Date.now() - started };
  } catch {
    const snap = shapeDengue(dengueSnapshot as unknown as DengueWeek[], "snapshot");
    return {
      ...snap,
      notice:
        "SNAPSHOT, NOT LIVE: recorded earlier today. You MUST tell the user this is from earlier today, not live.",
      elapsed_ms: Date.now() - started,
    };
  }
}

// ------------------------------------------------------------------ weather

const WMO_CONDITIONS: Record<number, string> = {
  0: "clear sky",
  1: "mostly clear",
  2: "partly cloudy",
  3: "overcast",
  45: "fog",
  48: "fog",
  51: "light drizzle",
  53: "drizzle",
  55: "heavy drizzle",
  61: "light rain",
  63: "rain",
  65: "heavy rain",
  80: "rain showers",
  81: "rain showers",
  82: "violent rain showers",
  95: "thunderstorm",
  96: "thunderstorm with hail",
  99: "thunderstorm with hail",
};

interface OpenMeteoResponse {
  current?: {
    time?: string;
    temperature_2m?: number;
    apparent_temperature?: number;
    precipitation?: number;
    weather_code?: number;
  };
  hourly?: { time?: string[]; precipitation_probability?: number[] };
}

function shapeWeather(data: OpenMeteoResponse, source: string): ToolResult {
  const cur = data.current;
  if (!cur) return toolError("weather_empty", "Open-Meteo returned no current data.");
  let rainProb: number | null = null;
  const times = data.hourly?.time ?? [];
  const probs = data.hourly?.precipitation_probability ?? [];
  if (times.length && probs.length && cur.time) {
    const idx = times.findIndex((t) => t >= (cur.time as string));
    const next3 = probs.slice(Math.max(idx, 0), Math.max(idx, 0) + 3).filter((p) => p != null);
    if (next3.length) rainProb = Math.max(...next3);
  }
  return {
    source,
    temp_c: cur.temperature_2m ?? null,
    feels_like_c: cur.apparent_temperature ?? null,
    rain_prob_next_3h_pct: rainProb,
    condition: WMO_CONDITIONS[cur.weather_code ?? -1] ?? "unknown",
  };
}

export async function getWeather(): Promise<ToolResult> {
  const started = Date.now();
  const url =
    "https://api.open-meteo.com/v1/forecast?latitude=-22.91&longitude=-43.20&current=temperature_2m,apparent_temperature,precipitation,weather_code&hourly=precipitation_probability&timezone=America%2FSao_Paulo";
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000), cache: "no-store" });
    if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
    const result = shapeWeather((await res.json()) as OpenMeteoResponse, "live");
    return { ...result, elapsed_ms: Date.now() - started };
  } catch {
    const snap = shapeWeather(weatherSnapshot as unknown as OpenMeteoResponse, "snapshot");
    return {
      ...snap,
      notice:
        "SNAPSHOT, NOT LIVE: recorded earlier today. You MUST tell the user this is from earlier today, not live.",
      elapsed_ms: Date.now() - started,
    };
  }
}

// ----------------------------------------------------------- 1746 complaints
// BigQuery access was unavailable on build day, so this tool serves only
// facts verifiable from official publications: citywide category totals plus
// which official top-5 rankings a bairro appears in. No per-bairro counts are
// estimated — data honesty over completeness.

interface BairroRankings {
  nome: string;
  rankings: { categoria: string; fact: string }[];
}

interface Aggregates1746 {
  generated_at?: string;
  window?: string;
  method?: string;
  sources?: string[];
  citywide?: Record<string, unknown>;
  bairros: Record<string, BairroRankings>;
}

export function slugify(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-");
}

export async function get1746Stats(bairro: string): Promise<ToolResult> {
  const started = Date.now();
  const data = aggregates1746 as unknown as Aggregates1746;
  const names = bairroNames as unknown as string[];
  const bairros = data.bairros ?? {};
  const want = slugify(bairro);
  const keys = Object.keys(bairros);
  if (keys.length === 0) {
    return {
      ...toolError("dataset_unavailable", "The 1746 aggregate dataset is not loaded."),
      elapsed_ms: Date.now() - started,
    };
  }
  let key = keys.find((k) => k === want);
  if (!key) key = keys.find((k) => k.includes(want) || want.includes(k));
  const b = key ? bairros[key] : null;
  return {
    bairro: b ? b.nome : bairro,
    window: data.window ?? "recent",
    coverage:
      "Official citywide totals plus top-5 neighborhood rankings. Full per-bairro counts are not public without BigQuery, so they are not included.",
    bairro_rankings: b
      ? b.rankings
      : `${bairro} does not appear in the official top-5 rankings we could verify; citywide numbers below are still real.`,
    citywide: data.citywide ?? null,
    bairros_with_rankings: names,
    elapsed_ms: Date.now() - started,
  };
}
