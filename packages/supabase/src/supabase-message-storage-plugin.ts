import type { UIMessage } from "ai";
import type { FsAgentPlugin } from "fs-agent";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface SupabaseChatStorageOptions {
  supabase: SupabaseClient;
  bucketName: string;
  /** Full storage key for the messages JSON file (e.g. "playbooks/ws-123/chat/messages.json"). */
  path: string;
}

export type CreateSupabaseMessagePersistencePluginOptions =
  SupabaseChatStorageOptions;

/**
 * Loads UI conversation messages from Supabase Storage — the same data the
 * {@link createSupabaseMessagePersistencePlugin} plugin reads in its `loadMessages`
 * hook and writes in `onFinish`. Use this from server code (e.g. Next.js) to hydrate
 * the UI; it is not a separate harness plugin.
 */
export async function loadSupabaseChatMessages(
  options: SupabaseChatStorageOptions,
): Promise<UIMessage[]> {
  const { data, error } = await options.supabase.storage
    .from(options.bucketName)
    .download(options.path);
  if (error || !data) {
    return [];
  }

  try {
    const parsed = JSON.parse(await data.text()) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed as UIMessage[];
  } catch {
    return [];
  }
}

/**
 * Plugin that loads and persists UI conversation messages in Supabase Storage.
 *
 * - `loadMessages` delegates to {@link loadSupabaseChatMessages}.
 * - `onFinish` saves the merged conversation from the harness.
 */
export function createSupabaseMessagePersistencePlugin(
  options: SupabaseChatStorageOptions,
): FsAgentPlugin {
  return {
    name: "supabase-message-storage",

    loadMessages: () => loadSupabaseChatMessages(options),

    async onFinish({ messages }: { messages: UIMessage[] }) {
      const supabase = options.supabase;
      const body = JSON.stringify(messages, null, 2);
      const { error } = await supabase.storage
        .from(options.bucketName)
        .upload(options.path, body, { upsert: true });

      if (error) {
        throw error;
      }
    },
  };
}
