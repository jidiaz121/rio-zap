import { getWeather } from "@/lib/tools";

export async function GET() {
  return Response.json(await getWeather());
}
