"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useMemo, useState } from "react";

import { resetChatMessagesAction } from "@/app/actions/reset-chat";
import { MarkdownText } from "@/components/markdown-text";
import type { DemoMessage } from "@/lib/types";

export function Chat({ initialMessages }: { initialMessages: DemoMessage[] }) {
  const [text, setText] = useState("");
  const [resetting, setResetting] = useState(false);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        prepareSendMessagesRequest: ({ messages, body }) => ({
          body: {
            ...body,
            newMessage: messages.at(-1),
          },
        }),
      }),
    [],
  );

  const {
    messages: chatMessages,
    sendMessage,
    status,
    stop,
  } = useChat({
    transport,
    messages: initialMessages,
  } as never);

  const messages = chatMessages as DemoMessage[];

  const busy = status === "streaming" || status === "submitted";
  const resetBusy = resetting;

  useEffect(() => {
    if (initialMessages.length === 0) {
      // Send an empty message so the agent starts the chat
      void sendMessage({
        text: "",
        metadata: { hiddenFromUI: true },
      });
    }
  }, [initialMessages.length, sendMessage]);

  return (
    <div>
      <p className="chat-toolbar">
        <button
          type="button"
          className="btn-reset"
          disabled={resetBusy}
          onClick={() => {
            void (async () => {
              setResetting(true);
              try {
                await stop();
                const result = await resetChatMessagesAction();
                if (!result.ok) {
                  window.alert(result.error);
                  return;
                }
                window.location.reload();
              } finally {
                setResetting(false);
              }
            })();
          }}
        >
          {resetBusy ? "Resetting…" : "Reset chat"}
        </button>
      </p>
      <ul className="messages">
        {messages.filter((m) => !m.metadata?.hiddenFromUI).map((m) => (
          <li
            key={m.id}
            className={`msg msg-${m.role === "user" ? "user" : "assistant"}`}
          >
            {m.parts.map((part, i) => {
              if (part.type === "text") {
                return <MarkdownText key={i}>{part.text}</MarkdownText>;
              }
              if (part.type === "data-suggestion") {
                return (
                  <div key={i} className="suggestions">
                    {part.data.items.map((item) => (
                      <button
                        key={item}
                        type="button"
                        disabled={busy}
                        onClick={() => void sendMessage({ text: item })}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                );
              }
              return null;
            })}
          </li>
        ))}
      </ul>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const t = text.trim();
          if (!t || busy) return;
          void sendMessage({ text: t });
          setText("");
        }}
      >
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Write a message…"
          disabled={busy}
          autoComplete="off"
        />
        <button type="submit" disabled={busy}>
          Send
        </button>
      </form>
    </div>
  );
}
