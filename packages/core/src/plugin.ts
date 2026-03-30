import type { CustomCommand, IFileSystem } from "just-bash";
import type {
  ModelMessage,
  StepResult,
  ToolSet,
  UIMessage,
  UIMessageChunk,
} from "ai";

/**
 * Plugin interface for extending the plugin-agent harness.
 *
 * The harness uses just-bash / bash-tool by default; plugins hook into
 * the agent lifecycle to add commands, wrap the filesystem, transform
 * input, and react to step / finish events.
 */
export interface PluginAgentPlugin {
  name: string;

  /**
   * Text to include in the system prompt
   */
  systemPrompt?(): string | Promise<string>;

  /**
   * Tools to merge into the harness (after bash tools, before `options.tools`
   * and per-run `tools`). Later plugins override earlier keys on collision.
   */
  tools?(): ToolSet | Promise<ToolSet>;

  /**
   * Register custom bash commands for the agent's shell.
   * Commands from all plugins are merged together.
   */
  commands?(): CustomCommand[] | Promise<CustomCommand[]>;

  /**
   * Create or wrap the virtual filesystem before the bash environment starts.
   * Returns the mount point (e.g. "/workspace") and the filesystem to use.
   * Multiple plugins can contribute mounts; all are combined via MountableFs.
   * Return undefined to skip adding a mount.
   */
  createFilesystem?():
    | { mountPoint: string; filesystem: IFileSystem }
    | Promise<{ mountPoint: string; filesystem: IFileSystem }>
    | undefined;

  /**
   * Transform the input prompt or messages before the agent run begins.
   * Plugins are called in order; each receives the previous plugin's output.
   */
  prepareInputMessage?(input: {
    prompt?: string;
    messages?: ModelMessage[];
  }):
    | { prompt?: string; messages?: ModelMessage[] }
    | Promise<{ prompt?: string; messages?: ModelMessage[] }>;

  /**
   * Called before each LLM inference step (0-indexed).
   * Useful for dynamic context injection or rate-limiting.
   */
  prepareStep?(context: { stepNumber: number }): void | Promise<void>;

  uiMessageStreamTransform?():
    | TransformStream<UIMessageChunk, UIMessageChunk>
    | Promise<TransformStream<UIMessageChunk, UIMessageChunk>>;

  /**
   * Called after each LLM step completes.
   */
  onStepFinish?(step: StepResult<ToolSet>): void | Promise<void>;

  /**
   * Load existing conversation messages from storage.
   * Only one plugin should implement this hook (last wins).
   * Called by the harness when `newMessage` mode is used to hydrate history.
   */
  loadMessages?(): UIMessage[] | Promise<UIMessage[]>;

  /**
   * Called when the agent run is fully complete and UI messages are available.
   * Receives the full merged conversation (input messages + stream output).
   * Useful for persisting conversation history or post-processing.
   */
  onFinish?(params: {
    messages: UIMessage[];
    fileSystem?: IFileSystem;
  }): void | Promise<void>;
}
