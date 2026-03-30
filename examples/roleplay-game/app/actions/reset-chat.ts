"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@supabase/supabase-js";

import { CHAT_MESSAGES_BUCKET, CHAT_MESSAGES_PATH } from "@/lib/chat-storage";

export async function resetChatMessagesAction(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return { ok: false, error: "Missing Supabase configuration." };
  }

  const supabase = createClient(url, key);
  const body = JSON.stringify([], null, 2);
  const { error } = await supabase.storage
    .from(CHAT_MESSAGES_BUCKET)
    .upload(CHAT_MESSAGES_PATH, body, { upsert: true });

  if (error) {
    console.error("resetChatMessagesAction:", error);
    return { ok: false, error: error.message };
  }

  revalidatePath("/");
  return { ok: true };
}
