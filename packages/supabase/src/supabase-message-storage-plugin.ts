import type { UIMessage } from "ai";
import type { FsAgentPlugin } from "fs-agent";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface CreateSupabaseMessagePersistencePluginOptions {
  supabase: SupabaseClient;
  bucketName: string;
  /** Full storage key for the messages JSON file (e.g. "playbooks/ws-123/chat/messages.json"). */
  path: string;
}

/**
 * Plugin that loads and persists UI conversation messages in Supabase Storage.
 *
 * - `loadMessages` returns the stored conversation for `newMessage` mode.
 * - `onFinish` receives the full merged conversation from the harness and
 *   saves it directly (no re-download needed).
 */
export function createSupabaseMessagePersistencePlugin(
  options: CreateSupabaseMessagePersistencePluginOptions,
): FsAgentPlugin {
  return {
    name: "supabase-message-persistence",

    async loadMessages() {
      const { data, error } = await options.supabase.storage
        .from(options.bucketName)
        .download(options.path);
      if (error) {
        throw error;
      }
      return JSON.parse(await data.text());
    },

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
