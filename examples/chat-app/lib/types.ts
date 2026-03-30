import type { UIMessage } from "ai";

export type DemoMessageMetadata = {
  /** When true, the message is kept for the model/history but not shown in the UI. */
  hiddenFromUI?: boolean;
};

/** UI messages with a persistent `data-suggestion` part (from `extractXmlPlugin`). */
export type DemoMessage = UIMessage<
  DemoMessageMetadata,
  { suggestion: { items: string[] } }
>;
