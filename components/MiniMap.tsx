"use client";

import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";

export interface BusPosition {
  ordem: string;
  lat: number;
  lon: number;
  speed_kmh: number;
  age_s: number;
}

// Tile chain (tech spec §7): Carto dark raster -> OSM raster -> component
// returns null and the text summary in the tool card is the floor.
const CARTO_TILES = [
  "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
  "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
  "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
];
const OSM_TILES = ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"];

function rasterStyle(tiles: string[]) {
  return {
    version: 8 as const,
    sources: {
      base: {
        type: "raster" as const,
        tiles,
        tileSize: 256,
        attribution: "© CARTO © OpenStreetMap contributors",
      },
    },
    layers: [{ id: "base", type: "raster" as const, source: "base" }],
  };
}

export default function MiniMap({ positions }: { positions: BusPosition[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let map: import("maplibre-gl").Map | undefined;
    (async () => {
      try {
        const maplibregl = (await import("maplibre-gl")).default;
        if (cancelled || !containerRef.current) return;
        map = new maplibregl.Map({
          container: containerRef.current,
          style: rasterStyle(CARTO_TILES),
          attributionControl: false,
          cooperativeGestures: true,
        });
        let tileErrors = 0;
        let swapped = false;
        map.on("error", () => {
          tileErrors += 1;
          if (!swapped && tileErrors >= 3) {
            swapped = true;
            map?.setStyle(rasterStyle(OSM_TILES));
          }
        });
        const bounds = new maplibregl.LngLatBounds();
        for (const p of positions) {
          const el = document.createElement("div");
          el.className = "bus-marker";
          new maplibregl.Marker({ element: el }).setLngLat([p.lon, p.lat]).addTo(map);
          bounds.extend([p.lon, p.lat]);
        }
        if (!bounds.isEmpty()) {
          map.fitBounds(bounds, { padding: 48, maxZoom: 14, animate: false });
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [positions]);

  if (failed || positions.length === 0) return null;

  return (
    <div className="card-in mt-2 overflow-hidden rounded-xl border border-white/10">
      <div ref={containerRef} className="h-44 w-full bg-[#10151c] sm:h-56" />
      <div className="flex items-center justify-between bg-white/[0.03] px-3 py-1.5 text-[11px] text-zinc-500">
        <span>{positions.length} live positions · SPPO fleet GPS</span>
        <span>© CARTO © OSM</span>
      </div>
    </div>
  );
}
