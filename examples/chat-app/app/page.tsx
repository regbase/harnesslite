import { Chat } from "@/components/chat";
import { loadPersistedMessages } from "@/lib/load-messages";

export default async function Page() {
  const initialMessages = await loadPersistedMessages();

  return (
    <main>
      <h1>Chat</h1>
      <Chat
        initialMessages={initialMessages}
      />
    </main>
  );
}
