import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAIStore } from "../../stores/aiStore";
import { useTabStore } from "../../stores/tabStore";
import ChatMessageList from "./ChatMessageList";
import ChatInput from "./ChatInput";
import AITabBar from "./AITabBar";
import { AIHistoryModal } from "./AIHistoryModal";
import { AIChatMenu } from "./AIChatMenu";
import { GeminiRequiredModal } from "./GeminiRequiredModal";
import { RAGCompletedModal } from "./RAGCompletedModal";
import { QueryConfirmDialog } from "./QueryConfirmDialog";
import { RobotDetailedIcon, MoreHorizontalIcon, CloseIcon, WarningIcon, SparklesIcon } from "../common/Icons";

interface AIChatPanelProps {
  onOpenSettings?: (tab?: string) => void;
  isSettingsOpen?: boolean;
}

export default function AIChatPanel({ onOpenSettings, isSettingsOpen }: AIChatPanelProps) {
  const { t } = useTranslation();
  const {
    isPanelOpen,
    panelWidth,
    setPanelWidth,
    closePanel,
    currentConversation,
    loadConversations,
    openTabs,
    addTab,
    isStreaming,
    streamStatus,
    ragIndexingStatus,
    ragSuggestion,
    startRagIndexing,
    dismissRagSuggestion,
    ragOutdated,
    reindexRag,
    dismissRagOutdated,
    ragCompletedInfo,
    showRagCompletedModal,
    dismissRagCompletedModal,
    loadAvailableModels,
    provider,
    hasApiKey,
    editAndResend,
    retryMessage,
    deleteMessage,
    loadOrCreateConversationForConnection,
    showGeminiRequiredModal,
    closeGeminiRequiredModal,
    pendingApproval,
    respondAutoQuery,
  } = useAIStore();

  const [apiKeyConfigured, setApiKeyConfigured] = useState<boolean | null>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const activeTab = useTabStore((state) => {
    const tab = state.tabs.find((t) => t.id === state.activeTabId);
    return tab;
  });

  const { selectTable, setTableViewMode } = useTabStore();

  const [isResizing, setIsResizing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const previousConnectionIdRef = useRef<string | null | undefined>(undefined);

  // Load conversations and models on mount
  useEffect(() => {
    if (isPanelOpen) {
      loadConversations();
      loadAvailableModels();
    }
  }, [isPanelOpen, loadConversations, loadAvailableModels]);

  // Track previous settings open state
  const prevSettingsOpenRef = useRef<boolean | undefined>(undefined);

  // Check if API key is configured
  useEffect(() => {
    const checkApiKey = async () => {
      if (isPanelOpen) {
        // Ollama doesn't require an API key
        if (provider === "ollama") {
          setApiKeyConfigured(true);
        } else {
          const hasKey = await hasApiKey(provider);
          setApiKeyConfigured(hasKey);
        }
      }
    };
    checkApiKey();
  }, [isPanelOpen, provider, hasApiKey]);

  // Re-check API key when settings modal closes
  useEffect(() => {
    const wasOpen = prevSettingsOpenRef.current;
    prevSettingsOpenRef.current = isSettingsOpen;

    // When settings modal closes (was open, now closed), re-check API key
    if (wasOpen === true && isSettingsOpen === false && isPanelOpen) {
      const recheckApiKey = async () => {
        if (provider === "ollama") {
          setApiKeyConfigured(true);
        } else {
          const hasKey = await hasApiKey(provider);
          setApiKeyConfigured(hasKey);
        }
      };
      recheckApiKey();
    }
  }, [isSettingsOpen, isPanelOpen, provider, hasApiKey]);

  const handleGoToSettings = () => {
    if (onOpenSettings) {
      onOpenSettings("ai");
    }
  };

  // Handle edit and resend message
  const handleEdit = useCallback(
    (messageId: string, newContent: string) => {
      editAndResend(
        messageId,
        newContent,
        activeTab?.connectionId,
        activeTab?.selectedDatabase
      );
    },
    [editAndResend, activeTab?.connectionId, activeTab?.selectedDatabase]
  );

  // Handle retry message
  const handleRetry = useCallback(
    (messageId: string) => {
      retryMessage(
        messageId,
        activeTab?.connectionId,
        activeTab?.selectedDatabase
      );
    },
    [retryMessage, activeTab?.connectionId, activeTab?.selectedDatabase]
  );

  // Handle delete message
  const handleDelete = useCallback(
    (messageId: string) => {
      deleteMessage(messageId);
    },
    [deleteMessage]
  );

  // Handle mention click - select table and go to structure tab
  const handleMentionClick = useCallback(
    (tableName: string) => {
      if (!activeTab?.id) return;

      // Select the table
      selectTable(activeTab.id, tableName);

      // Switch to structure tab
      setTableViewMode(activeTab.id, "structure");
    },
    [activeTab?.id, selectTable, setTableViewMode]
  );

  // Create new tab if none exists when panel opens
  useEffect(() => {
    if (isPanelOpen && openTabs.length === 0) {
      addTab(null);
    }
  }, [isPanelOpen, openTabs.length, addTab]);

  // Detect connection change and load appropriate conversation
  useEffect(() => {
    const currentConnectionId = activeTab?.connectionId;

    // Skip if connectionId hasn't actually changed
    if (previousConnectionIdRef.current === currentConnectionId) {
      return;
    }

    // Update ref (including initial mount)
    previousConnectionIdRef.current = currentConnectionId;

    // When connection changes (or on initial mount), load the appropriate conversation
    if (currentConnectionId && isPanelOpen) {
      loadOrCreateConversationForConnection(currentConnectionId, activeTab?.selectedDatabase);
    }
  }, [activeTab?.connectionId, activeTab?.selectedDatabase, isPanelOpen, loadOrCreateConversationForConnection]);

  // Handle resize
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const newWidth = window.innerWidth - e.clientX;
      setPanelWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing, setPanelWidth]);

  if (!isPanelOpen) return null;

  return (
    <div
      ref={panelRef}
      data-ai-panel
      className="relative flex flex-col bg-gray-900 border-l border-gray-700 h-full"
      style={{ width: panelWidth }}
    >
      {/* Resize handle */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 transition-colors z-10"
        onMouseDown={handleMouseDown}
      />

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <RobotDetailedIcon className="w-6 h-6 text-blue-400" />
          <h2 className="text-sm font-medium text-gray-200">
            {t("ai.title", "AI 어시스턴트")}
          </h2>
          {isStreaming && (
            <span className="flex items-center gap-1 text-xs text-blue-400">
              <span className="w-2 h-2 bg-blue-400 rounded-full animate-pulse" />
              {streamStatus === "analyzing_tables"
                ? t("ai.analyzingTables", "Analyzing tables...")
                : streamStatus === "reusing_context"
                ? t("ai.reusingContext", "Using previous context...")
                : streamStatus === "searching_via_rag"
                ? t("ai.searchingViaRag", "Searching with learned schema...")
                : streamStatus === "waiting_approval"
                ? t("ai.waitingApproval", "Waiting for approval...")
                : t("ai.thinking", "Thinking...")}
            </span>
          )}
          {ragIndexingStatus === "in_progress" && !isStreaming && (
            <span className="flex items-center gap-1.5 text-xs">
              <span className="w-2 h-2 rounded-full animate-rainbow-dot" />
              <span className="animate-rainbow-text font-medium">
                {t("ai.ragIndexing", "Learning schema...")}
              </span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {/* Menu button */}
          <div className="relative">
            <button
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="p-1.5 text-gray-400 hover:text-gray-200 hover:bg-gray-700 rounded transition-colors"
              title={t("ai.menu.title", "메뉴")}
            >
              <MoreHorizontalIcon className="w-4 h-4" />
            </button>
            {isMenuOpen && (
              <AIChatMenu onClose={() => setIsMenuOpen(false)} />
            )}
          </div>

          {/* Close button */}
          <button
            onClick={closePanel}
            className="p-1.5 text-gray-400 hover:text-gray-200 hover:bg-gray-700 rounded transition-colors"
            title={t("common.close", "닫기")}
          >
            <CloseIcon className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Tab Bar */}
      <AITabBar onHistoryClick={() => setIsHistoryOpen(true)} />

      {/* RAG Suggestion Banner - only show for current connection/database */}
      {ragSuggestion &&
        ragSuggestion.connectionId === activeTab?.connectionId &&
        ragSuggestion.database === activeTab?.selectedDatabase && (
        <div className="bg-blue-50 dark:bg-blue-900/50 border-b border-blue-200 dark:border-blue-800 px-4 py-3">
          <div className="flex items-start gap-3">
            <SparklesIcon className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gray-800 dark:text-gray-200 font-medium">
                {t("ai.ragSuggestionTitle", "AI Schema Learning Recommended")}
              </p>
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                {t(
                  "ai.ragSuggestionDesc",
                  "This database has {{count}} tables. AI can learn the schema to find relevant tables more accurately and reduce token usage.",
                  { count: ragSuggestion.tableCount }
                )}
              </p>
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() =>
                    startRagIndexing(
                      ragSuggestion.connectionId,
                      ragSuggestion.database
                    )
                  }
                  className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded transition-colors"
                >
                  {t("ai.enableRag", "Start Learning")}
                </button>
                <button
                  onClick={dismissRagSuggestion}
                  className="px-3 py-1 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-xs transition-colors"
                >
                  {t("common.dismiss", "Later")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* RAG Outdated Banner - only show for current connection/database */}
      {ragOutdated &&
        ragOutdated.connectionId === activeTab?.connectionId &&
        ragOutdated.database === activeTab?.selectedDatabase && (
        <div className="bg-amber-50 dark:bg-amber-900/50 border-b border-amber-200 dark:border-amber-800 px-4 py-3">
          <div className="flex items-start gap-3">
            <WarningIcon className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gray-800 dark:text-gray-200 font-medium">
                {t("ai.ragOutdatedTitle", "Schema has changed")}
              </p>
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                {t(
                  "ai.ragOutdatedDesc",
                  "Tables have been added or removed since the last learning. Re-learn to keep AI accurate.",
                  {
                    added: ragOutdated.addedTables.length,
                    removed: ragOutdated.removedTables.length,
                    modified: ragOutdated.modifiedTables.length,
                  }
                )}
              </p>
              <div className="flex gap-2 mt-2">
                <button
                  onClick={reindexRag}
                  className="px-3 py-1 bg-amber-600 hover:bg-amber-500 text-white text-xs rounded transition-colors"
                >
                  {t("ai.relearn", "Re-learn")}
                </button>
                <button
                  onClick={dismissRagOutdated}
                  className="px-3 py-1 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-xs transition-colors"
                >
                  {t("common.dismiss", "Later")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* API Key Not Configured Notice */}
      {apiKeyConfigured === false && (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-center max-w-xs">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-yellow-500/10 flex items-center justify-center">
              <WarningIcon className="w-8 h-8 text-yellow-500" />
            </div>
            <h3 className="text-lg font-medium text-gray-200 mb-2">
              {t("ai.apiKeyNotConfigured")}
            </h3>
            <p className="text-sm text-gray-400 mb-4">
              {t("ai.apiKeyNotConfiguredDesc")}
            </p>
            <button
              onClick={handleGoToSettings}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {t("ai.goToSettings")}
            </button>
          </div>
        </div>
      )}

      {/* Chat messages */}
      {apiKeyConfigured !== false && currentConversation && (
        <ChatMessageList
          messages={currentConversation.messages}
          onEdit={handleEdit}
          onRetry={handleRetry}
          onDelete={handleDelete}
          onMentionClick={handleMentionClick}
        />
      )}

      {/* Empty state when no conversation */}
      {apiKeyConfigured !== false && !currentConversation && (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-center text-gray-500 text-sm">
            {t("ai.startNewConversation", "Start a new conversation")}
          </div>
        </div>
      )}

      {/* Input - disabled when API key not configured */}
      {apiKeyConfigured !== false ? (
        <ChatInput
          connectionId={activeTab?.connectionId}
          database={activeTab?.selectedDatabase}
          tables={activeTab?.tables || []}
        />
      ) : (
        <div className="border-t border-gray-700 p-4">
          <div className="bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-sm text-gray-500 text-center">
            {t("ai.apiKeyNotConfigured")}
          </div>
        </div>
      )}

      {/* History Modal */}
      <AIHistoryModal
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        connectionId={activeTab?.connectionId}
      />

      {/* Gemini API Required Modal */}
      {showGeminiRequiredModal && (
        <GeminiRequiredModal
          onClose={closeGeminiRequiredModal}
          onGoToSettings={() => {
            closeGeminiRequiredModal();
            onOpenSettings?.("ai");
          }}
        />
      )}

      {/* RAG Completed Modal */}
      {showRagCompletedModal && ragCompletedInfo && (
        <RAGCompletedModal
          tableCount={ragCompletedInfo.tableCount}
          onClose={dismissRagCompletedModal}
        />
      )}

      {/* AUTO 모드 쿼리 실행 승인 다이얼로그 — 백엔드가 응답을 120초 대기 */}
      <QueryConfirmDialog
        isOpen={!!pendingApproval}
        query={pendingApproval?.query ?? ""}
        dangerLevel="warning"
        queryType={null}
        title={t("ai.autoApprovalTitle", "쿼리 실행 승인")}
        description={
          pendingApproval?.reason ||
          t("ai.autoApprovalDesc", "AI가 다음 쿼리 실행을 요청했습니다")
        }
        warningMessage={t(
          "ai.autoApprovalWarning",
          "읽기 전용 검증을 통과한 쿼리입니다. 실행을 승인하시겠습니까?"
        )}
        onConfirm={() => respondAutoQuery(true)}
        onCancel={() => respondAutoQuery(false)}
      />
    </div>
  );
}
