import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAIStore, ConversationSummary } from "../../stores/aiStore";
import { CloseIcon, SearchIcon, TrashIcon } from "../common/Icons";

interface AIHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  connectionId?: string | null;
}

const PAGE_SIZE = 15;

export function AIHistoryModal({ isOpen, onClose, connectionId }: AIHistoryModalProps) {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { conversations, loadConversations, addTab, deleteConversation } =
    useAIStore();

  // Filter conversations by connection and search query
  const filteredConversations = useMemo(() => {
    let filtered = conversations;

    // Filter by connection if provided
    if (connectionId) {
      filtered = filtered.filter((conv) => conv.connection_id === connectionId);
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((conv) =>
        conv.title.toLowerCase().includes(query)
      );
    }

    return filtered;
  }, [conversations, connectionId, searchQuery]);

  // Display items with pagination
  const displayItems = filteredConversations.slice(0, displayCount);
  const hasMore = displayCount < filteredConversations.length;

  // Load conversations when modal opens
  useEffect(() => {
    if (isOpen) {
      loadConversations();
      setSearchQuery("");
      setSelectedIndex(0);
      setDisplayCount(PAGE_SIZE);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen, loadConversations]);

  // Reset display count when search changes
  useEffect(() => {
    setDisplayCount(PAGE_SIZE);
    setSelectedIndex(0);
  }, [searchQuery]);

  // Handle selecting a conversation
  const handleSelect = useCallback(
    (conv: ConversationSummary) => {
      addTab(conv.id);
      onClose();
    },
    [addTab, onClose]
  );

  // Handle delete conversation
  const handleDelete = useCallback(
    async (e: React.MouseEvent, convId: string) => {
      e.stopPropagation();
      if (confirm(t("ai.confirmDelete", "Delete this conversation?"))) {
        await deleteConversation(convId);
      }
    },
    [deleteConversation, t]
  );

  // Show more items
  const handleShowMore = () => {
    setDisplayCount((prev) => prev + PAGE_SIZE);
  };

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, displayItems.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter" && displayItems.length > 0) {
        e.preventDefault();
        handleSelect(displayItems[selectedIndex]);
      } else if (e.key === "Escape") {
        onClose();
      }
    },
    [displayItems, selectedIndex, handleSelect, onClose]
  );

  // Scroll selected item into view
  useEffect(() => {
    const listElement = listRef.current;
    if (listElement) {
      const selectedElement = listElement.children[selectedIndex] as HTMLElement;
      if (selectedElement) {
        selectedElement.scrollIntoView({ block: "nearest" });
      }
    }
  }, [selectedIndex]);

  // Format timestamp
  const formatDate = (timestamp: number): string => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } else if (days === 1) {
      return t("ai.yesterday", "Yesterday");
    } else if (days < 7) {
      return t("ai.daysAgo", "{{count}} days ago", { count: days });
    } else {
      return date.toLocaleDateString();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 pt-[15vh]"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="bg-gray-800 rounded-lg shadow-xl w-full max-w-xl mx-4 overflow-hidden"
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
          <h2 className="text-base font-medium text-white">
            {t("ai.history", "Chat History")}
          </h2>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition"
          >
            <CloseIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Search Input */}
        <div className="p-3 border-b border-gray-700">
          <div className="relative">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              ref={inputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("ai.searchConversations", "Search conversations...")}
              className="w-full pl-10 pr-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-sm text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
            />
          </div>
        </div>

        {/* Conversation List */}
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto">
          {displayItems.length === 0 ? (
            <div className="p-8 text-center text-gray-400">
              {searchQuery.trim()
                ? t("ai.noConversationsFound", "No conversations found")
                : t("ai.noConversations", "No conversations yet")}
            </div>
          ) : (
            displayItems.map((conv, index) => (
              <div
                key={conv.id}
                onClick={() => handleSelect(conv)}
                className={`group px-4 py-3 cursor-pointer border-b border-gray-700/50 transition-colors ${
                  index === selectedIndex
                    ? "bg-blue-600/20"
                    : "hover:bg-gray-700/50"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    {/* Title */}
                    <div className="text-sm text-gray-200 truncate">
                      {conv.title || t("ai.untitled", "Untitled")}
                    </div>
                    {/* Meta info */}
                    <div className="flex items-center gap-2 mt-1 text-xs text-gray-400">
                      <span>
                        {conv.message_count}{" "}
                        {t("ai.messages", "messages")}
                      </span>
                      <span>·</span>
                      <span>{formatDate(conv.updated_at)}</span>
                    </div>
                  </div>

                  {/* Delete button */}
                  <button
                    onClick={(e) => handleDelete(e, conv.id)}
                    className="opacity-0 group-hover:opacity-100 p-1.5 text-gray-400 hover:text-red-400 hover:bg-gray-600 rounded transition"
                    title={t("common.delete", "Delete")}
                  >
                    <TrashIcon className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Show More Button */}
        {hasMore && (
          <div className="px-4 py-3 border-t border-gray-700">
            <button
              onClick={handleShowMore}
              className="w-full py-2 text-sm text-blue-400 hover:text-blue-300 hover:bg-gray-700/50 rounded transition"
            >
              {t("ai.showMore", "Show {{count}} More", { count: PAGE_SIZE })}
            </button>
          </div>
        )}

        {/* Footer */}
        <div className="px-4 py-2 border-t border-gray-700 bg-gray-850">
          <div className="flex items-center justify-center gap-4 text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-gray-400">
                ↑↓
              </kbd>
              {t("ai.navigate", "Navigate")}
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-gray-400">
                Enter
              </kbd>
              {t("ai.open", "Open")}
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-gray-400">
                Esc
              </kbd>
              {t("common.close", "Close")}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
