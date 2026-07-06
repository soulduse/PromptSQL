import { useState, useRef, useEffect, useMemo, memo } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown, { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChatMessage } from "../../stores/aiStore";
import CodeBlock from "./CodeBlock";
import MentionText from "./MentionText";
import AutoQueryResult, { AutoQueryResultData } from "./AutoQueryResult";
import { RobotIcon, EditIcon, CopyIcon, CheckIcon, RetryIcon, TrashIcon } from "../common/Icons";

// Parse AUTO mode query results from message content
interface ParsedContent {
  type: "text" | "auto_query_result";
  content: string;
  queryData?: AutoQueryResultData;
  index?: number;
}

function parseAutoQueryResults(content: string): ParsedContent[] {
  const results: ParsedContent[] = [];
  const regex = /<auto_query_result\s+index="(\d+)">\s*([\s\S]*?)\s*<\/auto_query_result>/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(content)) !== null) {
    // Add text before this match
    if (match.index > lastIndex) {
      const textBefore = content.slice(lastIndex, match.index).trim();
      if (textBefore) {
        results.push({ type: "text", content: textBefore });
      }
    }

    // Parse the query result JSON
    try {
      const jsonStr = match[2].trim();
      const queryData = JSON.parse(jsonStr) as AutoQueryResultData;
      results.push({
        type: "auto_query_result",
        content: "",
        queryData,
        index: parseInt(match[1], 10),
      });
    } catch {
      // If parsing fails, treat as text
      results.push({ type: "text", content: match[0] });
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < content.length) {
    const remainingText = content.slice(lastIndex).trim();
    if (remainingText) {
      results.push({ type: "text", content: remainingText });
    }
  }

  // If no AUTO query results found, return original content as single text item
  if (results.length === 0) {
    return [{ type: "text", content }];
  }

  return results;
}

interface ChatMessageItemProps {
  message: ChatMessage;
  onEdit?: (messageId: string, newContent: string) => void;
  onRetry?: (messageId: string) => void;
  onDelete?: (messageId: string) => void;
  onMentionClick?: (tableName: string) => void;
}

// Helper to process children and apply mention highlighting
const processChildren = (
  children: React.ReactNode,
  onMentionClick?: (tableName: string) => void
): React.ReactNode => {
  if (typeof children === "string") {
    return <MentionText text={children} onMentionClick={onMentionClick} />;
  }
  if (Array.isArray(children)) {
    return children.map((child, index) =>
      typeof child === "string" ? (
        <MentionText key={index} text={child} onMentionClick={onMentionClick} />
      ) : (
        child
      )
    );
  }
  return children;
};

// Create markdown components with mention click handler
const createMarkdownComponents = (
  onMentionClick?: (tableName: string) => void
): Components => ({
  code({ className, children }) {
    const match = /language-(\w+)/.exec(className || "");
    const isInline = !className;

    if (isInline) {
      return (
        <code className="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 text-blue-600 dark:text-blue-300 rounded text-xs font-mono">
          {children}
        </code>
      );
    }

    return (
      <CodeBlock
        code={String(children).replace(/\n$/, "")}
        language={match ? match[1] : "sql"}
      />
    );
  },
  p({ children }) {
    return <p className="mb-2 last:mb-0">{processChildren(children, onMentionClick)}</p>;
  },
  strong({ children }) {
    return <strong className="font-semibold text-gray-100">{processChildren(children, onMentionClick)}</strong>;
  },
  em({ children }) {
    return <em className="italic text-gray-200">{processChildren(children, onMentionClick)}</em>;
  },
  ul({ children }) {
    return <ul className="list-disc list-inside mb-2 space-y-1">{children}</ul>;
  },
  ol({ children }) {
    return <ol className="list-decimal list-inside mb-2 space-y-1">{children}</ol>;
  },
  li({ children }) {
    return <li className="text-gray-300">{processChildren(children, onMentionClick)}</li>;
  },
  h1({ children }) {
    return <h1 className="text-lg font-bold text-gray-100 mb-2">{processChildren(children, onMentionClick)}</h1>;
  },
  h2({ children }) {
    return <h2 className="text-base font-bold text-gray-100 mb-2">{processChildren(children, onMentionClick)}</h2>;
  },
  h3({ children }) {
    return <h3 className="text-sm font-bold text-gray-100 mb-1">{processChildren(children, onMentionClick)}</h3>;
  },
  blockquote({ children }) {
    return (
      <blockquote className="border-l-2 border-gray-500 pl-3 my-2 text-gray-400 italic">
        {children}
      </blockquote>
    );
  },
  a({ href, children }) {
    return (
      <a
        href={href}
        className="text-blue-400 hover:text-blue-300 underline"
        target="_blank"
        rel="noopener noreferrer"
      >
        {children}
      </a>
    );
  },
  hr() {
    return <hr className="my-3 border-gray-600" />;
  },
  table({ children }) {
    return (
      <div className="my-3 overflow-x-auto rounded-lg border border-gray-600">
        <table className="w-full text-sm">
          {children}
        </table>
      </div>
    );
  },
  thead({ children }) {
    return (
      <thead className="bg-gray-700/50 text-gray-200">
        {children}
      </thead>
    );
  },
  tbody({ children }) {
    return <tbody className="divide-y divide-gray-600">{children}</tbody>;
  },
  tr({ children }) {
    return <tr className="hover:bg-gray-700/30 transition-colors">{children}</tr>;
  },
  th({ children }) {
    return (
      <th className="px-3 py-2 text-left font-semibold text-gray-200 border-b border-gray-600">
        {processChildren(children, onMentionClick)}
      </th>
    );
  },
  td({ children }) {
    return (
      <td className="px-3 py-2 text-gray-300">
        {processChildren(children, onMentionClick)}
      </td>
    );
  },
});

// memo: 스트리밍 중 스토어가 매 청크마다 messages 배열을 갱신하지만
// 변경된 메시지 객체만 새 참조라, 나머지 메시지는 리렌더를 건너뛴다
const ChatMessageItem = memo(function ChatMessageItem({ message, onEdit, onRetry, onDelete, onMentionClick }: ChatMessageItemProps) {
  const { t } = useTranslation();
  const isUser = message.role === "user";

  // Replace backend markers with translated text
  const processedContent = useMemo(() => {
    let content = message.content;
    // Replace timeout warning marker
    content = content.replace(
      /\[TIMEOUT_WARNING\]/g,
      `⚠️ *${t("ai.timeoutWarning", "The request timed out and the response was interrupted.")}*`
    );
    // Replace timeout error marker
    content = content.replace(
      /\[TIMEOUT_ERROR\]/g,
      t("ai.timeoutError", "Request timed out. Please try again.")
    );
    return content;
  }, [message.content, t]);

  // Memoize markdown components to prevent unnecessary re-renders
  const markdownComponents = useMemo(
    () => createMarkdownComponents(onMentionClick),
    [onMentionClick]
  );

  // AUTO 쿼리 결과 파싱은 콘텐츠가 바뀔 때만 — 토큰당 재파싱 방지
  const parsedParts = useMemo(
    () => (isUser ? [] : parseAutoQueryResults(processedContent)),
    [isUser, processedContent]
  );

  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Focus textarea when entering edit mode
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(editContent.length, editContent.length);
    }
  }, [isEditing, editContent.length]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [editContent]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const handleEditClick = () => {
    setEditContent(message.content);
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditContent("");
  };

  const handleUpdate = () => {
    if (editContent.trim() && onEdit) {
      onEdit(message.id, editContent.trim());
      setIsEditing(false);
      setEditContent("");
    }
  };

  const handleRetry = () => {
    if (onRetry) {
      onRetry(message.id);
    }
  };

  const handleDelete = () => {
    if (onDelete) {
      onDelete(message.id);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") {
      handleCancelEdit();
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleUpdate();
    }
  };

  // Edit mode UI for user messages
  if (isEditing && isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] w-full">
          <div className="bg-gray-800 border border-gray-600 rounded-lg overflow-hidden">
            <textarea
              ref={textareaRef}
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              onKeyDown={handleKeyDown}
              className="w-full bg-transparent px-4 py-3 text-sm text-gray-200 resize-none focus:outline-none"
              rows={1}
            />
            <div className="flex items-center justify-end gap-2 px-4 py-2 border-t border-gray-700 bg-gray-850">
              <button
                onClick={handleCancelEdit}
                className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-700 rounded transition-colors"
              >
                {t("common.cancel", "취소")}
              </button>
              <button
                onClick={handleUpdate}
                disabled={!editContent.trim()}
                className={`px-3 py-1.5 text-xs rounded transition-colors ${
                  editContent.trim()
                    ? "bg-blue-600 text-white hover:bg-blue-500"
                    : "bg-gray-700 text-gray-500 cursor-not-allowed"
                }`}
              >
                {t("ai.updateMessage", "업데이트")}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`group flex items-center gap-1 ${isUser ? "justify-end" : "justify-start"}`}>
      {/* Delete button - appears on hover, left side */}
      {!message.isStreaming && (
        <button
          onClick={handleDelete}
          className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-gray-700 rounded opacity-0 group-hover:opacity-100 transition-all"
          title={t("ai.deleteMessage", "메시지 삭제")}
        >
          <TrashIcon className="w-4 h-4" />
        </button>
      )}
      <div
        className={`relative max-w-[85%] rounded-lg px-4 py-3 ${
          isUser
            ? "bg-blue-600/20 text-gray-200"
            : "bg-gray-800 text-gray-300"
        }`}
      >
        {/* Role indicator for assistant */}
        {!isUser && (
          <div className="flex items-center gap-2 mb-2 text-xs text-gray-500 select-none">
            <RobotIcon className="w-4 h-4 text-blue-400" />
            AI
          </div>
        )}

        {/* Message content with Markdown rendering */}
        <div className="text-sm prose-invert">
          {isUser ? (
            // User messages: simple markdown
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={markdownComponents}
            >
              {processedContent}
            </ReactMarkdown>
          ) : (
            // Assistant messages: parse AUTO query results
            parsedParts.map((part, partIndex) => {
              if (part.type === "auto_query_result" && part.queryData) {
                return (
                  <AutoQueryResult
                    key={`query-${partIndex}`}
                    data={part.queryData}
                    index={part.index}
                  />
                );
              }
              return (
                <ReactMarkdown
                  key={`text-${partIndex}`}
                  remarkPlugins={[remarkGfm]}
                  components={markdownComponents}
                >
                  {part.content}
                </ReactMarkdown>
              );
            })
          )}
        </div>

        {/* Streaming indicator */}
        {message.isStreaming && (
          <span className="inline-block w-2 h-4 ml-1 bg-blue-400 animate-pulse" />
        )}

        {/* Action buttons - inside message bubble at bottom */}
        {!message.isStreaming && (
          <div
            className={`flex items-center gap-1 mt-2 pt-2 border-t border-gray-600/50 select-none ${
              isUser ? "justify-end" : "justify-start"
            }`}
          >
            {/* User message actions: Edit, Copy, Retry */}
            {isUser && (
              <>
                {/* Edit button */}
                <button
                  onClick={handleEditClick}
                  className="p-1.5 text-gray-400 hover:text-gray-200 hover:bg-gray-700 rounded transition-colors"
                  title={t("ai.editMessage", "메시지 수정")}
                >
                  <EditIcon className="w-4 h-4" />
                </button>

                {/* Copy button */}
                <button
                  onClick={handleCopy}
                  className="p-1.5 text-gray-400 hover:text-gray-200 hover:bg-gray-700 rounded transition-colors"
                  title={t("ai.copyMessage", "메시지 복사")}
                >
                  {copied ? (
                    <CheckIcon className="w-4 h-4 text-green-400" />
                  ) : (
                    <CopyIcon className="w-4 h-4" />
                  )}
                </button>

                {/* Retry button */}
                <button
                  onClick={handleRetry}
                  className="p-1.5 text-gray-400 hover:text-gray-200 hover:bg-gray-700 rounded transition-colors"
                  title={t("ai.retryMessage", "재시도")}
                >
                  <RetryIcon className="w-4 h-4" />
                </button>
              </>
            )}

            {/* AI message actions: Copy only */}
            {!isUser && (
              <button
                onClick={handleCopy}
                className="p-1.5 text-gray-400 hover:text-gray-200 hover:bg-gray-700 rounded transition-colors"
                title={t("ai.copyMessage", "메시지 복사")}
              >
                {copied ? (
                  <CheckIcon className="w-4 h-4 text-green-400" />
                ) : (
                  <CopyIcon className="w-4 h-4" />
                )}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

export default ChatMessageItem;
