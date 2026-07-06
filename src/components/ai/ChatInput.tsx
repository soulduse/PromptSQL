import { useState, useRef, useCallback, KeyboardEvent, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAIStore } from "../../stores/aiStore";
import MentionDropdown from "./MentionDropdown";
import ModelSelector from "./ModelSelector";
import { SendIcon, WarningIcon, QuestionCircleIcon, StopIcon } from "../common/Icons";

// Render text with highlighted mentions
const renderHighlightedText = (text: string): React.ReactNode[] => {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  const regex = /@(\w+)/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    // Add text before mention (visible)
    if (match.index > lastIndex) {
      parts.push(
        <span key={`text-${lastIndex}`}>
          {text.slice(lastIndex, match.index)}
        </span>
      );
    }

    // Add highlighted mention (no margin/padding to keep sync with textarea)
    const mentionName = match[1];
    const isAll = mentionName.toLowerCase() === "all";
    parts.push(
      <span
        key={`mention-${match.index}`}
        className={`rounded-sm ${
          isAll
            ? "bg-amber-500/30 text-amber-400"
            : "bg-blue-500/30 text-blue-400"
        }`}
      >
        @{mentionName}
      </span>
    );

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text (visible)
  if (lastIndex < text.length) {
    parts.push(
      <span key={`text-${lastIndex}`}>
        {text.slice(lastIndex)}
      </span>
    );
  }

  // Add trailing space to match textarea behavior
  if (text.length === 0 || parts.length === 0) {
    parts.push(<span key="empty">&nbsp;</span>);
  }

  return parts;
};

interface ChatInputProps {
  connectionId?: string | null;
  database?: string | null;
  tables: string[];
}

export default function ChatInput({
  connectionId,
  database,
  tables,
}: ChatInputProps) {
  const { t } = useTranslation();
  const { sendMessage, isStreaming, setInputFocusCallback, isAutoMode, toggleAutoMode, autoApproveTrusted, toggleAutoApproveTrusted, closeCurrentTab, cancelRequest } = useAIStore();

  const [inputValue, setInputValue] = useState("");
  const [showMention, setShowMention] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0);
  const [pendingCursorPosition, setPendingCursorPosition] = useState<number | null>(null);
  const [scrollTop, setScrollTop] = useState(0);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Filter tables based on mention query (includes @all option)
  const filteredTables = useMemo(() => {
    const query = mentionQuery.toLowerCase();
    const filtered = tables.filter((table) =>
      table.toLowerCase().includes(query)
    );
    // Check if "all" matches the query
    const allMatches = "all".includes(query);
    // Return count including @all option if it matches
    return allMatches ? filtered : filtered;
  }, [tables, mentionQuery]);

  // Total options count (including @all if it matches query)
  const totalOptionsCount = useMemo(() => {
    const query = mentionQuery.toLowerCase();
    const allMatches = "all".includes(query);
    return (allMatches ? 1 : 0) + filteredTables.length;
  }, [filteredTables.length, mentionQuery]);

  // Get option name at index (considering @all at index 0)
  const getOptionAtIndex = useCallback((index: number): string => {
    const query = mentionQuery.toLowerCase();
    const allMatches = "all".includes(query);
    if (allMatches) {
      return index === 0 ? "all" : filteredTables[index - 1];
    }
    return filteredTables[index];
  }, [filteredTables, mentionQuery]);

  // Check if @all is mentioned in the input
  const hasAllMention = useMemo(() => {
    return /@all\b/i.test(inputValue);
  }, [inputValue]);

  // Find all mention positions in text for backspace handling
  // Includes trailing space as part of mention for easier deletion
  const findMentionAtCursor = useCallback((text: string, cursorPos: number): { start: number; end: number } | null => {
    const mentionWithSpaceRegex = /@(\w+)(\s)?/g;
    const matches = [...text.matchAll(mentionWithSpaceRegex)];
    for (const match of matches) {
      const start = match.index!;
      const end = start + match[0].length;
      // Check if cursor is within the mention range (including trailing space)
      if (cursorPos > start && cursorPos <= end) {
        return { start, end };
      }
    }
    return null;
  }, []);

  // Register focus callback for tab system
  useEffect(() => {
    const focusInput = () => {
      textareaRef.current?.focus();
    };
    setInputFocusCallback(focusInput);

    return () => {
      setInputFocusCallback(null);
    };
  }, [setInputFocusCallback]);

  // Handle pending cursor position after state update
  useEffect(() => {
    if (pendingCursorPosition !== null && textareaRef.current) {
      textareaRef.current.setSelectionRange(pendingCursorPosition, pendingCursorPosition);
      textareaRef.current.focus();
      setPendingCursorPosition(null);
    }
  }, [inputValue, pendingCursorPosition]);

  // Handle input change
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setInputValue(value);

    // Check for @ mention
    const cursorPos = e.target.selectionStart;
    const textBeforeCursor = value.slice(0, cursorPos);
    const mentionMatch = textBeforeCursor.match(/@(\w*)$/);

    if (mentionMatch) {
      setMentionQuery(mentionMatch[1]);
      setShowMention(true);
      setSelectedMentionIndex(0);
    } else {
      setShowMention(false);
      setMentionQuery("");
    }
  };

  // Handle mention selection
  const handleMentionSelect = useCallback(
    (tableName: string) => {
      const cursorPos = textareaRef.current?.selectionStart || 0;
      const textBeforeCursor = inputValue.slice(0, cursorPos);
      const textAfterCursor = inputValue.slice(cursorPos);

      // Find the @ position
      const atIndex = textBeforeCursor.lastIndexOf("@");
      if (atIndex !== -1) {
        const newValue =
          textBeforeCursor.slice(0, atIndex) +
          `@${tableName} ` +
          textAfterCursor;
        const newCursorPos = atIndex + tableName.length + 2; // @ + tableName + space

        // Set cursor position to be applied after state update
        setPendingCursorPosition(newCursorPos);
        setInputValue(newValue);
      }

      setShowMention(false);
      setMentionQuery("");
    },
    [inputValue]
  );

  // Handle keyboard events
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Handle Cmd+W to close current AI conversation tab
    if ((e.metaKey || e.ctrlKey) && e.key === "w") {
      e.preventDefault();
      e.stopPropagation();
      closeCurrentTab();
      return;
    }

    // Handle backspace for mention deletion
    if (e.key === "Backspace" && !showMention) {
      const cursorPos = textareaRef.current?.selectionStart || 0;
      const selectionEnd = textareaRef.current?.selectionEnd || 0;

      // Only handle when there's no selection (just cursor)
      if (cursorPos === selectionEnd && cursorPos > 0) {
        const mention = findMentionAtCursor(inputValue, cursorPos);
        if (mention) {
          e.preventDefault();
          const newValue = inputValue.slice(0, mention.start) + inputValue.slice(mention.end);

          // Set cursor position to be applied after state update
          setPendingCursorPosition(mention.start);
          setInputValue(newValue);
          return;
        }
      }
    }

    if (showMention && totalOptionsCount > 0) {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedMentionIndex((prev) =>
            prev < totalOptionsCount - 1 ? prev + 1 : prev
          );
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedMentionIndex((prev) => (prev > 0 ? prev - 1 : prev));
          break;
        case "Enter":
          e.preventDefault();
          handleMentionSelect(getOptionAtIndex(selectedMentionIndex));
          break;
        case "Escape":
          e.preventDefault();
          setShowMention(false);
          break;
      }
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    } else if (e.key === "Tab" && !showMention) {
      // Toggle AUTO mode with Tab key
      e.preventDefault();
      toggleAutoMode();
    }
  };

  // Handle send
  const handleSend = () => {
    if (!inputValue.trim() || isStreaming) return;

    sendMessage(inputValue.trim(), connectionId, database);
    setInputValue("");
  };

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      const textarea = textareaRef.current;
      const maxHeight = 300;

      // Set height to 0 to get accurate scrollHeight measurement
      textarea.style.height = "0px";
      const scrollHeight = textarea.scrollHeight;
      const newHeight = Math.min(scrollHeight, maxHeight);

      textarea.style.height = `${newHeight}px`;
      textarea.style.overflowY = scrollHeight > maxHeight ? "auto" : "hidden";
    }
  }, [inputValue]);

  // Sync scroll position between textarea and overlay
  const handleScroll = () => {
    if (textareaRef.current) {
      setScrollTop(textareaRef.current.scrollTop);
    }
  };

  return (
    <div className="relative border-t border-gray-700 p-4">
      {/* Mention dropdown */}
      {showMention && totalOptionsCount > 0 && (
        <MentionDropdown
          tables={filteredTables}
          selectedIndex={selectedMentionIndex}
          mentionQuery={mentionQuery}
          onSelect={handleMentionSelect}
        />
      )}

      {/* Input area */}
      <div className="flex items-center gap-2">
        {/* AUTO mode badge with help icon */}
        {isAutoMode && (
          <div className="flex items-center gap-1 flex-shrink-0">
            {/* Help icon with tooltip */}
            <div className="relative group/help">
              <QuestionCircleIcon className="w-4 h-4 text-gray-400 hover:text-gray-300 cursor-help" />
              {/* Tooltip */}
              <div className="absolute left-0 bottom-full mb-2 w-64 p-3 bg-gray-800 border border-gray-600 rounded-lg shadow-xl opacity-0 invisible group-hover/help:opacity-100 group-hover/help:visible transition-all duration-200 z-50">
                <div className="text-xs text-gray-200 space-y-2">
                  <p className="font-medium text-emerald-400">{t("ai.autoModeTitle", "AUTO Mode")}</p>
                  <p>{t("ai.autoModeDescription", "AI can automatically execute SELECT queries and use the results to answer your questions.")}</p>
                  <ul className="list-disc list-inside text-gray-400 space-y-1">
                    <li>{t("ai.autoModeFeature1", "SELECT queries only (safe)")}</li>
                    <li>{t("ai.autoModeFeature2", "Max 100 rows per query")}</li>
                    <li>{t("ai.autoModeFeature3", "Up to 5 queries per request")}</li>
                  </ul>
                </div>
                {/* Tooltip arrow */}
                <div className="absolute left-3 bottom-0 translate-y-full border-8 border-transparent border-t-gray-600"></div>
                <div className="absolute left-3 bottom-0 translate-y-[calc(100%-1px)] border-8 border-transparent border-t-gray-800"></div>
              </div>
            </div>
            {/* AUTO badge button */}
            <button
              onClick={toggleAutoMode}
              className="px-2 py-1 bg-gradient-to-r from-emerald-600 to-cyan-600 rounded text-white text-xs font-medium hover:from-emerald-500 hover:to-cyan-500 transition-all"
              title={t("ai.clickToDisable", "Click to disable AUTO mode")}
            >
              AUTO
            </button>
            {/* 신뢰 토글: 검증 통과한 읽기 쿼리를 승인 없이 자동 실행 */}
            <button
              onClick={toggleAutoApproveTrusted}
              className={`px-2 py-1 rounded text-xs font-medium transition-all border ${
                autoApproveTrusted
                  ? "bg-emerald-600/20 border-emerald-500/50 text-emerald-400 hover:bg-emerald-600/30"
                  : "bg-gray-700/40 border-gray-600 text-gray-400 hover:text-gray-300 hover:border-gray-500"
              }`}
              title={t(
                "ai.trustedTooltip",
                "Automatically run read-only queries that pass safety checks without asking"
              )}
            >
              {t("ai.trustedAutoRun", "Auto-run")}
            </button>
          </div>
        )}

        <div className="flex-1 relative">
          {/* Actual textarea */}
          <textarea
            ref={textareaRef}
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onScroll={handleScroll}
            placeholder={t(
              "ai.placeholder",
              "메시지를 입력하세요... (@로 테이블 멘션)"
            )}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-sm text-gray-200 placeholder-gray-500 resize-none focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 caret-gray-200"
            style={{ color: "transparent", WebkitTextFillColor: "transparent" }}
            rows={1}
            disabled={isStreaming}
          />

          {/* Highlight overlay (on top of textarea) */}
          <div
            className="absolute inset-0 px-4 py-3 text-sm text-gray-200 whitespace-pre-wrap break-words pointer-events-none overflow-hidden border border-transparent rounded-lg"
            aria-hidden="true"
          >
            <div
              style={{
                transform: `translateY(-${scrollTop}px)`,
              }}
            >
              {renderHighlightedText(inputValue)}
            </div>
          </div>
        </div>

        {/* Send button */}
        {isStreaming ? (
          <button
            onClick={cancelRequest}
            className="p-2.5 rounded-lg transition-colors bg-red-600 text-white hover:bg-red-500"
            title={t("ai.cancelRequest", "요청 취소")}
          >
            <StopIcon className="w-5 h-5" />
          </button>
        ) : (
          <button
            onClick={handleSend}
            disabled={!inputValue.trim()}
            className={`p-2.5 rounded-lg transition-colors ${
              inputValue.trim()
                ? "bg-blue-600 text-white hover:bg-blue-500"
                : "bg-gray-700 text-gray-500 cursor-not-allowed"
            }`}
            title={t("ai.send", "전송")}
          >
            <SendIcon className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* @all warning message */}
      {hasAllMention && (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-amber-500">
          <WarningIcon className="w-3.5 h-3.5 flex-shrink-0" />
          <span>{t("ai.allMentionWarning", "Warning: Using @all may consume many tokens if there are many tables.")}</span>
        </div>
      )}

      {/* Bottom bar with model selector and keyboard hints */}
      <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
        {/* Model selector */}
        <ModelSelector />

        {/* Keyboard hint */}
        <div className="flex items-center gap-1">
          <kbd className="px-1.5 py-0.5 bg-gray-700/50 rounded text-gray-400 text-[10px]">Tab</kbd>
          <span className={isAutoMode ? "text-emerald-400" : ""}>{t("ai.autoMode", "Auto")}</span>
          <span className="mx-1">·</span>
          <kbd className="px-1.5 py-0.5 bg-gray-700/50 rounded text-gray-400 text-[10px]">Enter</kbd>
          <span>{t("ai.toSend", "전송")}</span>
          <span className="mx-1">·</span>
          <kbd className="px-1.5 py-0.5 bg-gray-700/50 rounded text-gray-400 text-[10px]">Shift+Enter</kbd>
          <span>{t("ai.newLine", "줄바꿈")}</span>
        </div>
      </div>
    </div>
  );
}
