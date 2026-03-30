import "server-only";

import { loadSupabaseChatMessages } from "@fs-agent/supabase";
import { createClient } from "@supabase/supabase-js";

import { CHAT_MESSAGES_BUCKET, CHAT_MESSAGES_PATH } from "./chat-storage";
import type { DemoMessage } from "./types";

export async function loadPersistedMessages(): Promise<DemoMessage[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return [];
  }

  const supabase = createClient(url, key);
  const messages = await loadSupabaseChatMessages({
    supabase,
    bucketName: CHAT_MESSAGES_BUCKET,
    path: CHAT_MESSAGES_PATH,
  });
  return messages as DemoMessage[];
}
