import { createClient } from "@supabase/supabase-js";
import { createUIMessageStreamResponse, generateId } from "ai";
import { createSupabaseMessagePersistencePlugin } from "@plugin-agent/supabase";
import {
  createFilesystemAgentHarness,
  extractXmlPlugin,
} from "plugin-agent";

import { CHAT_MESSAGES_BUCKET, CHAT_MESSAGES_PATH } from "@/lib/chat-storage";
import type { DemoMessage } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}
const supabase = createClient(
  requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
  requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
);

const persistence = createSupabaseMessagePersistencePlugin({
  supabase,
  bucketName: CHAT_MESSAGES_BUCKET,
  path: CHAT_MESSAGES_PATH,
});

const suggestions = extractXmlPlugin({
  tagName: "suggestion",
  system:
    "When quick replies would help, end your reply with a single line: <suggestion>option one, option two, option three</suggestion>. Use comma-separated short labels only (no nested tags). Put your normal answer before that line.",
  onTagFinish: ({ content, controller }) => {
    const items = content
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (items.length === 0) return;
    controller.enqueue({
      type: "data-suggestion",
      id: generateId(),
      data: { items },
    });
  },
});

const runChat = createFilesystemAgentHarness({
  system:
    `You are a dungeon master for a roleplaying game. Answer clearly. Offer suggestion chips when they would help the user respond.
    
The story begins in a tavern in a small village. A war is brewing, and everyone is preparing for it. The player is an eagar young teenager travelling for the first time.`,
  maxSteps: 8,
  plugins: [
    /*
     * This plugin looks for <suggestion> tags in the output stream and transforms them into data parts which the UI renders as clickable suggestions.
     */
    suggestions,

    /*
     * This plugin handles saving/loading the chat messages in Supabase Storage.
     */
    persistence,
  ],
});

export async function POST(req: Request) {
  let body: { newMessage?: DemoMessage };
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const newMessage = body.newMessage;
  if (!newMessage) {
    return new Response("Missing newMessage", { status: 400 });
  }

  if (newMessage.role !== "user") {
    return new Response("newMessage must be from the user", { status: 400 });
  }

  try {
    const { stream } = await runChat({
      newMessage,
    });
    return createUIMessageStreamResponse({ stream });
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : "Server error";
    return new Response(message, { status: 500 });
  }
}
