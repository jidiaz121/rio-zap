import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  tool,
  type UIMessage,
} from "ai";
import { z } from "zod";
import { SYSTEM_PROMPT, TOOL_CONTRACTS, runtimeContext } from "@/lib/steering";
import { get1746Stats, getBusLive, getDengue, getWeather } from "@/lib/tools";

export const maxDuration = 60;

// LLM fallback chain (tech spec §7): primary claude-haiku-4-5, quality
// claude-sonnet-4-6 via ZAP_MODEL, Gemini floor via ZAP_LLM=google.
function pickModel() {
  if (process.env.ZAP_LLM === "google") {
    return google(process.env.ZAP_GOOGLE_MODEL ?? "gemini-2.5-flash");
  }
  return anthropic(process.env.ZAP_MODEL ?? "claude-haiku-4-5");
}

const contract = (name: string) => {
  const c = TOOL_CONTRACTS.find((t) => t.name === name);
  if (!c) throw new Error(`missing contract: ${name}`);
  return c;
};

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const result = streamText({
    model: pickModel(),
    system: SYSTEM_PROMPT + runtimeContext(),
    messages: await convertToModelMessages(messages),
    stopWhen: stepCountIs(4), // max 2 tool calls + final answer
    tools: {
      getBusLive: tool({
        description: contract("getBusLive").description,
        inputSchema: z.object({
          linha: z.string().describe(contract("getBusLive").params[0].description),
        }),
        execute: async ({ linha }) => getBusLive(linha),
      }),
      getDengue: tool({
        description: contract("getDengue").description,
        inputSchema: z.object({}),
        execute: async () => getDengue(),
      }),
      get1746Stats: tool({
        description: contract("get1746Stats").description,
        inputSchema: z.object({
          bairro: z.string().describe(contract("get1746Stats").params[0].description),
        }),
        execute: async ({ bairro }) => get1746Stats(bairro),
      }),
      getWeather: tool({
        description: contract("getWeather").description,
        inputSchema: z.object({}),
        execute: async () => getWeather(),
      }),
    },
  });

  return result.toUIMessageStreamResponse();
}
