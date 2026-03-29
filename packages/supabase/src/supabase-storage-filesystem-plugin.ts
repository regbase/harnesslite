import type { FsAgentPlugin } from "fs-agent";
import type { FilePart, ModelMessage, UserModelMessage } from "ai";
import { SupabaseStorageFs } from "./supabase-storage-fs";
import { SupabaseClient } from "@supabase/supabase-js";

export const STORAGE_URL_PREFIX = "storage:";

/**
 * Plugin that mirrors a virtual filesystem to a Supabase Storage bucket.
 *
 * On mount the FS discovers existing files under `prefix` and registers them
 * as lazy placeholders (visible in listings, content fetched on first read).
 * Writes are uploaded back to Supabase on every mutation.
 *
 * Optional initialFiles: if provided, these files are written into the
 * filesystem after creation (e.g. to seed the workspace for a new chat).
 */
export function createSupabaseStorageFilesystemPlugin(options: {
  supabase: SupabaseClient;
  bucketName: string;
  /** Storage path prefix inside the bucket (e.g. "my-agent/workspace-123"). */
  prefix: string;
}): FsAgentPlugin {
  const downloadCache = new Map<string, Uint8Array>();

  return {
    name: "supabase-storage-filesystem",

    async createFilesystem() {
      const filesystem = await SupabaseStorageFs.create({
        supabase: options.supabase,
        bucketName: options.bucketName,
        prefix: options.prefix,
        onStorageKeyWritten(storageKey) {
          downloadCache.delete(storageKey);
        },
      });
      return { mountPoint: "/workspace", filesystem };
    },

    async prepareInputMessage(input: { messages?: ModelMessage[] }) {
      if (!input.messages) return input;

      const messages: ModelMessage[] = await Promise.all(
        input.messages.map(async (msg: ModelMessage) => {
          if (msg.role !== "user") return msg;

          const userMsg = msg as UserModelMessage;
          if (typeof userMsg.content === "string") return msg;

          const content = await Promise.all(
            userMsg.content.map(async (part) => {
              if (part.type !== "file") return part;

              const filePart = part as FilePart;
              if (typeof filePart.data !== "string") return part;
              if (!filePart.data.startsWith(STORAGE_URL_PREFIX)) return part;

              const storageKey = filePart.data.slice(
                STORAGE_URL_PREFIX.length,
              );

              const cached = downloadCache.get(storageKey);
              if (cached) {
                return { ...filePart, data: cached } satisfies FilePart;
              }

              const { data: blob, error } = await options.supabase.storage
                .from(options.bucketName)
                .download(storageKey);

              if (error || !blob) {
                throw new Error(
                  `Failed to download attachment ${storageKey}: ${error?.message ?? "unknown error"}`,
                );
              }

              const bytes = new Uint8Array(await blob.arrayBuffer());
              downloadCache.set(storageKey, bytes);

              return { ...filePart, data: bytes } satisfies FilePart;
            }),
          );

          return { ...userMsg, content } satisfies UserModelMessage;
        }),
      );

      return { ...input, messages };
    },
  };
}
