import { getBusLive } from "@/lib/tools";

export const maxDuration = 60;

// Also fired by the client on page load with ?warm=1 for the demo linha,
// so the judge's first bus query hits a hot module cache.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const linha = url.searchParams.get("linha") ?? "483";
  const result = await getBusLive(linha, { warm: url.searchParams.has("warm") });
  return Response.json(result);
}
