import { useEffect, useRef, useCallback } from "react";
import { ChatMessage, useAIStore } from "../../stores/aiStore";
import ChatMessageItem from "./ChatMessage";
import { ChatIcon } from "../common/Icons";

interface ChatMessageListProps {
  messages: ChatMessage[];
  onEdit?: (messageId: string, newContent: string) => void;
  onRetry?: (messageId: string) => void;
  onDelete?: (messageId: string) => void;
  onMentionClick?: (tableName: string) => void;
}

export default function ChatMessageList({ messages, onEdit, onRetry, onDelete, onMentionClick }: ChatMessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const isUserScrollingRef = useRef(false);
  const lastMessageCountRef = useRef(messages.length);
  const isStreaming = useAIStore((state) => state.isStreaming);

  // Check if user is near bottom (within 100px)
  const isNearBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return true;
    const threshold = 100;
    return container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
  }, []);

  // Handle scroll event to detect user scrolling
  const handleScroll = useCallback(() => {
    if (!isStreaming) {
      isUserScrollingRef.current = false;
      return;
    }
    // If user scrolls up during streaming, mark as user scrolling
    if (!isNearBottom()) {
      isUserScrollingRef.current = true;
    } else {
      isUserScrollingRef.current = false;
    }
  }, [isStreaming, isNearBottom]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    // If new message added (not just content update), scroll to bottom
    if (messages.length > lastMessageCountRef.current) {
      isUserScrollingRef.current = false;
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    // During streaming, only scroll if user hasn't scrolled up
    else if (isStreaming && !isUserScrollingRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    // Not streaming and user is near bottom, scroll
    else if (!isStreaming && isNearBottom()) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }

    lastMessageCountRef.current = messages.length;
  }, [messages, isStreaming, isNearBottom]);

  // Reset user scrolling when streaming ends
  useEffect(() => {
    if (!isStreaming) {
      isUserScrollingRef.current = false;
    }
  }, [isStreaming]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="text-center text-gray-500">
          <ChatIcon className="w-12 h-12 mx-auto mb-3 text-gray-600" strokeWidth={1.5} />
          <p className="text-sm">AI에게 질문해보세요</p>
          <p className="text-xs mt-1 text-gray-600">
            @로 테이블을 멘션할 수 있습니다
          </p>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto p-4 space-y-4" onScroll={handleScroll}>
      {messages.map((message) => (
        <ChatMessageItem
          key={message.id}
          message={message}
          onEdit={onEdit}
          onRetry={onRetry}
          onDelete={onDelete}
          onMentionClick={onMentionClick}
        />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
