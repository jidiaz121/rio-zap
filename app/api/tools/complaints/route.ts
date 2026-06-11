import { get1746Stats } from "@/lib/tools";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const bairro = url.searchParams.get("bairro") ?? "Copacabana";
  return Response.json(await get1746Stats(bairro));
}
