import { ChatContainer } from "@/components/chat/ChatContainer";

export function MainPanel() {
  return (
    <div className="flex-1 flex flex-col min-w-0 bg-sidebar">
      <ChatContainer />
    </div>
  );
}
