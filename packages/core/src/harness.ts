import {
  convertToModelMessages,
  gateway,
  generateId,
  type LanguageModel,
  type ModelMessage,
  stepCountIs,
  streamText,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import { createBashTool } from "bash-tool";
import {
  Bash,
  type CustomCommand,
  type IFileSystem,
  InMemoryFs,
  MountableFs,
} from "just-bash";
import type { FsAgentPlugin } from "./plugin";

export type VirtualFileSystem = Record<string, string>;

export interface RunFilesystemAgentParams {
  model?: LanguageModel;
  system?: string;
  maxSteps?: number;
  tools?: Record<string, unknown>;
  /** Single-turn prompt. Mutually exclusive with `newMessage` / `allMessages`. */
  prompt?: string;
  /**
   * A single new message to append to the conversation.
   * Existing history is loaded via the plugin `loadMessages` hook.
   * Mutually exclusive with `prompt` / `allMessages`.
   */
  newMessage?: UIMessage;
  /**
   * Complete conversation provided by the caller (nothing loaded from storage).
   * Mutually exclusive with `prompt` / `newMessage`.
   */
  allMessages?: UIMessage[];
}

export interface RunFilesystemAgentStreamResult {
  /** Raw UI message stream to pipe to the response. Do not consume elsewhere. */
  stream: ReadableStream<UIMessageChunk>;
  /** Resolves when the run is complete (stream is fully consumed). */
  completion: Promise<{
    text: string;
    response: unknown;
    messages: unknown[];
    usage: unknown;
    providerMetadata: unknown;
  }>;
}

export interface FilesystemAgentHarnessOptions {
  model?: LanguageModel;
  system?: string;
  maxSteps?: number;
  tools?: Record<string, unknown>;
  plugins?: FsAgentPlugin[];
}

const DEFAULT_MODEL = "openai/gpt-5.2";
const DEFAULT_MAX_STEPS = 20;

export function createFilesystemAgentHarness(
  options: FilesystemAgentHarnessOptions = {},
) {
  return async function runFilesystemAgent({
    prompt,
    newMessage,
    allMessages,
    model,
    system,
    maxSteps,
    tools,
  }: RunFilesystemAgentParams): Promise<RunFilesystemAgentStreamResult> {
    const plugins = options.plugins ?? [];

    const allCommands: CustomCommand[] = [];
    for (const plugin of plugins) {
      if (plugin.registerCommands) {
        const cmds = await plugin.registerCommands();
        allCommands.push(...cmds);
      }
    }

    const mountResults = await Promise.all(
      plugins.map((p) =>
        p.createFilesystem ? p.createFilesystem() : Promise.resolve(undefined),
      ),
    );
    const mounts = mountResults.filter(
      (
        m,
      ): m is { mountPoint: string; filesystem: IFileSystem } => m !== undefined,
    );

    const fileSystem = new MountableFs({
      base: new InMemoryFs(),
      mounts,
    });

    const workspaceCwd = "/workspace";

    const bash = new Bash({
      cwd: workspaceCwd,
      fs: fileSystem,
      customCommands: allCommands.length > 0 ? allCommands : undefined,
    });

    const bashToolkit = await createBashTool({
      sandbox: bash,
    });

    const pluginToolLayers = await Promise.all(
      plugins.map((p) => p.registerTools?.() ?? Promise.resolve({})),
    );
    const pluginTools = Object.assign({}, ...pluginToolLayers);

    // Resolve input UIMessages and convert to ModelMessages
    let inputUIMessages: UIMessage[] | undefined;
    let modelMessages: ModelMessage[] | undefined;

    if (newMessage) {
      const loader = [...plugins].reverse().find((p) => p.loadMessages);
      const existing = loader?.loadMessages ? await loader.loadMessages() : [];
      inputUIMessages = [...existing, newMessage];
      modelMessages = await convertToModelMessages(inputUIMessages);
    } else if (allMessages?.length) {
      inputUIMessages = allMessages;
      modelMessages = await convertToModelMessages(inputUIMessages);
    }

    let transformedInput: { prompt?: string; messages?: ModelMessage[] } = {
      prompt,
      messages: modelMessages,
    };
    for (const plugin of plugins) {
      if (plugin.prepareInputMessage) {
        transformedInput = await plugin.prepareInputMessage(transformedInput);
      }
    }

    let stepNumber = 0;
    for (const plugin of plugins) {
      if (plugin.prepareStep) await plugin.prepareStep({ stepNumber });
    }

    const pluginPrompts = await Promise.all(
      plugins.map((p) => p.systemPrompt?.() ?? Promise.resolve("")),
    );
    const systemPrompt = `${system ?? options.system}\n${pluginPrompts.join("\n")}`;

    const resolvedModel = model ?? options.model ?? DEFAULT_MODEL;
    const common = {
      model:
        typeof resolvedModel === "string"
          ? gateway(resolvedModel)
          : resolvedModel,
      system: systemPrompt,
      stopWhen: [
        stepCountIs(maxSteps ?? options.maxSteps ?? DEFAULT_MAX_STEPS),
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- plugin interface provides proper StepResult<ToolSet> typing
      onStepFinish: async (step: any) => {
        for (const plugin of plugins) {
          if (plugin.onStepFinish) await plugin.onStepFinish(step);
        }
        stepNumber++;
        for (const plugin of plugins) {
          if (plugin.prepareStep) await plugin.prepareStep({ stepNumber });
        }
      },
      tools: {
        ...bashToolkit.tools,
        ...pluginTools,
        ...(options.tools ?? {}),
        ...(tools ?? {}),
      },
    };

    const streamedResult = transformedInput.messages?.length
      ? streamText({ ...common, messages: transformedInput.messages })
      : streamText({ ...common, prompt: transformedInput.prompt ?? "" });

    const hasPluginFinish = plugins.some((p) => p.onFinish);

    const uiStream = streamedResult.toUIMessageStream({
      ...(hasPluginFinish
        ? {
            generateMessageId: generateId,
            onFinish: async ({ messages: streamMessages }) => {
              // Merge input UIMessages with stream output for the full conversation
              let merged: UIMessage[];
              if (inputUIMessages?.length) {
                merged = [...inputUIMessages];
                for (const msg of streamMessages) {
                  const idx = merged.findIndex((m) => m.id === msg.id);
                  if (idx >= 0) merged[idx] = msg;
                  else merged.push(msg);
                }
              } else {
                merged = streamMessages;
              }

              for (const plugin of plugins) {
                if (plugin.onFinish) {
                  try {
                    await plugin.onFinish({ messages: merged, fileSystem });
                  } catch (err) {
                    console.warn(
                      `[fs-agent] Plugin ${plugin.name} onFinish error:`,
                      err,
                    );
                  }
                }
              }
            },
          }
        : {}),
    });

    let transformedUiMessages = uiStream;
    for (const plugin of plugins) {
      if (plugin.uiMessageTransform) {
        transformedUiMessages = transformedUiMessages.pipeThrough(
          await plugin.uiMessageTransform(),
        );
      }
    }

    const completion = (async () => {
      const [text, response, usage, providerMetadata] = await Promise.all([
        streamedResult.text,
        streamedResult.response,
        streamedResult.usage,
        streamedResult.providerMetadata,
      ]);
      return {
        text,
        response,
        messages: response.messages,
        usage,
        providerMetadata,
      };
    })();

    return {
      stream: transformedUiMessages,
      completion,
    };
  };
}

export const runFilesystemAgent = createFilesystemAgentHarness();

