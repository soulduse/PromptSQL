import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";

// Constants
const PANEL_WIDTH_KEY = "promptsql-chat-panel-width";
const PANEL_OPEN_KEY = "promptsql-chat-panel-open";
const LAST_SESSION_KEY = "promptsql-chat-last-session";
const LAST_SESSION_BY_CONNECTION_PREFIX = "promptsql-chat-last-session-conn-";
const PROVIDER_KEY = "promptsql-chat-provider";
const MODEL_KEY = "promptsql-chat-model";
const AUTO_MODE_KEY = "promptsql-chat-auto-mode";
// 신뢰 토글: 안전성 검사를 통과한 읽기 쿼리를 승인 없이 자동 실행
const AUTO_APPROVE_KEY = "promptsql-chat-auto-approve-trusted";
// RAG 스키마 외부 업로드(Gemini File Search) 동의 여부
const RAG_CONSENT_KEY = "promptsql-rag-upload-consent";
const DEFAULT_PANEL_WIDTH = 400;
const MIN_PANEL_WIDTH = 300;
// Dynamic max width: 70% of window width
const getMaxPanelWidth = () => Math.floor(window.innerWidth * 0.7);

// Types
export type LLMProvider = "openai" | "anthropic" | "gemini" | "ollama";
export type LLMModel = string;

export interface ModelInfo {
  id: string;
  name: string;
  provider: LLMProvider;
  max_tokens: number;
  supports_streaming: boolean;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  isStreaming?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  connection_id: string | null;
  database: string | null;
  created_at: number;
  updated_at: number;
}

export interface ConversationSummary {
  id: string;
  title: string;
  message_count: number;
  connection_id: string | null;
  database: string | null;
  created_at: number;
  updated_at: number;
}

// Tab system types
export interface AITab {
  id: string;
  conversationId: string | null;
  conversation: Conversation | null;
  isLoading: boolean;
}

interface AIStreamEvent {
  request_id: string;
  content: string;
  done: boolean;
  error: string | null;
}

interface AIStatusEvent {
  request_id: string;
  status: "analyzing_tables" | "generating" | "reusing_context" | "searching_via_rag" | "auto_mode_starting" | "auto_mode_continuing" | "waiting_approval";
}

// AUTO 모드 쿼리 실행 승인 요청 이벤트 (백엔드가 120초 대기)
interface AutoApprovalEvent {
  request_id: string;
  approval_id: string;
  query: string;
  reason: string;
}

export interface PendingAutoApproval {
  approvalId: string;
  requestId: string;
  query: string;
  reason: string;
}

// AUTO mode query execution event
export interface AutoQueryEvent {
  request_id: string;
  query: string;
  reason: string;
  status: "executing" | "completed" | "error" | "rejected";
  result?: {
    query: string;
    original_query?: string;
    columns: string[];
    rows: unknown[][];
    row_count: number;
    execution_time_ms: number;
    was_limited: boolean;
    error?: string;
  };
  error?: string;
}

// RAG indexing status
export type RAGIndexingStatus = "not_started" | "in_progress" | "completed" | "failed";

interface RAGIndexingEvent {
  connection_id: string;
  database: string;
  status: RAGIndexingStatus;
  store_name?: string;
  error?: string;
  table_count?: number;
}

// RAG completed info (for modal)
export interface RAGCompletedInfo {
  tableCount: number;
}

// RAG suggestion (when large DB detected)
export interface RAGSuggestion {
  connectionId: string;
  database: string;
  tableCount: number;
}

interface RAGSuggestEvent {
  connection_id: string;
  database: string;
  table_count: number;
}

// RAG outdated event (when tables changed after indexing)
export interface RAGOutdatedInfo {
  connectionId: string;
  database: string;
  addedTables: string[];
  removedTables: string[];
  modifiedTables: string[];  // Tables with schema changes (columns, indexes, etc.)
}

interface RAGOutdatedEvent {
  connection_id: string;
  database: string;
  added_tables: string[];
  removed_tables: string[];
  modified_tables: string[];
}

interface AIState {
  // Panel state
  isPanelOpen: boolean;
  panelWidth: number;
  isInitialized: boolean;

  // Tab system state
  openTabs: AITab[];
  activeTabId: string | null;

  // Conversation state (legacy - kept for compatibility, use getActiveConversation())
  currentConversation: Conversation | null;
  conversations: ConversationSummary[];

  // Input focus callback
  inputFocusCallback: (() => void) | null;

  // Message state
  isStreaming: boolean;
  streamingMessageId: string | null;
  currentStreamContent: string;
  streamStatus: "analyzing_tables" | "generating" | "reusing_context" | "searching_via_rag" | "auto_mode_starting" | "auto_mode_continuing" | "waiting_approval" | null;

  // AUTO mode state
  isAutoMode: boolean;
  // 신뢰 토글: 검증 통과한 읽기 쿼리 자동 실행 허용
  autoApproveTrusted: boolean;
  // 사용자 승인 대기 중인 AUTO 쿼리
  pendingApproval: PendingAutoApproval | null;

  // LLM settings
  provider: LLMProvider;
  model: string;
  availableModels: ModelInfo[];

  // Loading states
  isLoadingConversations: boolean;
  isLoadingModels: boolean;
  error: string | null;

  // RAG indexing status
  ragIndexingStatus: RAGIndexingStatus | null;
  ragIndexingError: string | null;

  // RAG suggestion (for large DBs)
  ragSuggestion: RAGSuggestion | null;

  // RAG outdated (when schema changed after indexing)
  ragOutdated: RAGOutdatedInfo | null;

  // RAG completed modal
  ragCompletedInfo: RAGCompletedInfo | null;
  showRagCompletedModal: boolean;

  // Gemini API required modal
  showGeminiRequiredModal: boolean;

  // RAG 외부 업로드 동의 모달
  showRagConsentModal: boolean;
  pendingRagIndexing: { connectionId: string; database: string } | null;

  // Event listeners
  unlistenStream: UnlistenFn | null;
  unlistenStatus: UnlistenFn | null;
  unlistenConversationSaved: UnlistenFn | null;
  unlistenAutoApproval: UnlistenFn | null;
  unlistenRagStatus: UnlistenFn | null;
  unlistenRagSuggest: UnlistenFn | null;
  unlistenRagOutdated: UnlistenFn | null;
  unlistenGeminiRequired: UnlistenFn | null;

  // Actions
  togglePanel: () => Promise<void>;
  openPanel: () => Promise<void>;
  closePanel: () => void;
  setPanelWidth: (width: number) => void;
  initializePanel: () => Promise<void>;

  // Conversation actions
  loadConversations: () => Promise<void>;
  loadConversation: (id: string) => Promise<void>;
  createNewConversation: (
    connectionId: string | null,
    database: string | null
  ) => void;
  deleteConversation: (id: string) => Promise<void>;

  // Message actions
  sendMessage: (
    message: string,
    connectionId?: string | null,
    database?: string | null
  ) => Promise<void>;
  editAndResend: (
    messageId: string,
    newContent: string,
    connectionId?: string | null,
    database?: string | null
  ) => Promise<void>;
  retryMessage: (
    messageId: string,
    connectionId?: string | null,
    database?: string | null
  ) => Promise<void>;
  deleteMessage: (messageId: string) => Promise<void>;
  cancelRequest: () => void;
  appendStreamContent: (content: string) => void;
  finalizeStreamMessage: () => void;

  // LLM settings actions
  loadAvailableModels: () => Promise<void>;
  setProvider: (provider: LLMProvider) => void;
  setModel: (model: string) => void;
  setProviderAndModel: (provider: LLMProvider, model: string) => Promise<void>;
  saveApiKey: (provider: LLMProvider, apiKey: string) => Promise<void>;
  deleteApiKey: (provider: LLMProvider) => Promise<void>;
  hasApiKey: (provider: LLMProvider) => Promise<boolean>;
  testConnection: (provider: LLMProvider) => Promise<boolean>;

  // Stream listener
  setupStreamListener: () => Promise<void>;
  cleanupStreamListener: () => void;
  setupRagStatusListener: () => Promise<void>;

  // RAG suggestion actions
  startRagIndexing: (connectionId: string, database: string) => Promise<void>;
  confirmRagConsent: () => Promise<void>;
  declineRagConsent: () => void;
  dismissRagSuggestion: () => void;

  // RAG outdated actions
  reindexRag: () => Promise<void>;
  dismissRagOutdated: () => void;

  // RAG completed modal actions
  dismissRagCompletedModal: () => void;

  // Gemini required modal actions
  closeGeminiRequiredModal: () => void;

  // AUTO mode actions
  toggleAutoMode: () => void;
  setAutoMode: (enabled: boolean) => void;
  toggleAutoApproveTrusted: () => void;
  respondAutoQuery: (approved: boolean) => Promise<void>;

  // Reset
  reset: () => void;

  // Tab actions
  addTab: (conversationId?: string | null, connectionId?: string | null, database?: string | null) => Promise<string>;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  loadOrCreateConversationForConnection: (connectionId: string, database?: string | null) => Promise<void>;
  updateActiveTabConversation: (conversation: Conversation) => void;
  getActiveConversation: () => Conversation | null;
  setInputFocusCallback: (callback: (() => void) | null) => void;

  // Menu actions
  closeCurrentTab: () => void;
  clearAllConversations: () => Promise<void>;
  closeOtherTabs: () => void;
  exportCurrentConversation: () => Promise<void>;
}

// Helper to get saved panel width
const getSavedPanelWidth = (): number => {
  const saved = localStorage.getItem(PANEL_WIDTH_KEY);
  if (saved) {
    const width = parseInt(saved, 10);
    const maxWidth = getMaxPanelWidth();
    if (width >= MIN_PANEL_WIDTH && width <= maxWidth) {
      return width;
    }
  }
  return DEFAULT_PANEL_WIDTH;
};

// Helper to get/set panel open state (default: true)
const getSavedPanelOpen = (): boolean => {
  const saved = localStorage.getItem(PANEL_OPEN_KEY);
  if (saved === null) return true; // Default to open
  return saved === "true";
};

const savePanelOpen = (isOpen: boolean) => {
  localStorage.setItem(PANEL_OPEN_KEY, isOpen.toString());
};

// Helper to save last session ID (global fallback)
const saveLastSession = (sessionId: string | null) => {
  if (sessionId) {
    localStorage.setItem(LAST_SESSION_KEY, sessionId);
  } else {
    localStorage.removeItem(LAST_SESSION_KEY);
  }
};

// Helper to get/set last session per connection
const getSavedLastSessionForConnection = (connectionId: string): string | null => {
  return localStorage.getItem(`${LAST_SESSION_BY_CONNECTION_PREFIX}${connectionId}`);
};

const saveLastSessionForConnection = (connectionId: string, sessionId: string | null) => {
  if (sessionId) {
    localStorage.setItem(`${LAST_SESSION_BY_CONNECTION_PREFIX}${connectionId}`, sessionId);
  } else {
    localStorage.removeItem(`${LAST_SESSION_BY_CONNECTION_PREFIX}${connectionId}`);
  }
};

// Helper to get/set saved provider and model
const getSavedProvider = (): LLMProvider => {
  const saved = localStorage.getItem(PROVIDER_KEY);
  if (saved && ["openai", "anthropic", "gemini", "ollama"].includes(saved)) {
    return saved as LLMProvider;
  }
  return "openai"; // Default provider
};

const getSavedModel = (): string => {
  return localStorage.getItem(MODEL_KEY) || "gpt-5.4-mini"; // Default model
};

const saveProviderAndModel = (provider: LLMProvider, model: string) => {
  localStorage.setItem(PROVIDER_KEY, provider);
  localStorage.setItem(MODEL_KEY, model);
};

// Helper to generate message ID
const generateMessageId = (): string => {
  return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
};

// Helper to generate tab ID
const generateTabId = (): string => {
  return `tab_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
};

export const useAIStore = create<AIState>((set, get) => ({
  // Initial state
  isPanelOpen: getSavedPanelOpen(),
  panelWidth: getSavedPanelWidth(),
  isInitialized: false,
  openTabs: [],
  activeTabId: null,
  currentConversation: null,
  conversations: [],
  inputFocusCallback: null,
  isStreaming: false,
  streamingMessageId: null,
  currentStreamContent: "",
  streamStatus: null,
  // AUTO 모드 기본 활성화 - SELECT 쿼리만 실행되므로 안전함
  // localStorage에 값이 없으면 true (처음 사용자), "false"일 때만 비활성화
  isAutoMode: localStorage.getItem(AUTO_MODE_KEY) !== "false",
  // 신뢰 토글 기본 비활성화 — 명시적으로 켠 사용자만 무승인 실행
  autoApproveTrusted: localStorage.getItem(AUTO_APPROVE_KEY) === "true",
  pendingApproval: null,
  provider: getSavedProvider(),
  model: getSavedModel(),
  availableModels: [],
  isLoadingConversations: false,
  isLoadingModels: false,
  error: null,
  ragIndexingStatus: null,
  ragIndexingError: null,
  ragSuggestion: null,
  ragOutdated: null,
  ragCompletedInfo: null,
  showRagCompletedModal: false,
  showGeminiRequiredModal: false,
  showRagConsentModal: false,
  pendingRagIndexing: null,
  unlistenStream: null,
  unlistenStatus: null,
  unlistenConversationSaved: null,
  unlistenAutoApproval: null,
  unlistenRagStatus: null,
  unlistenRagSuggest: null,
  unlistenRagOutdated: null,
  unlistenGeminiRequired: null,

  // Panel actions
  togglePanel: async () => {
    const { isPanelOpen, setupStreamListener, cleanupStreamListener } = get();
    const newState = !isPanelOpen;
    if (newState) {
      await setupStreamListener();
    } else {
      cleanupStreamListener();
    }
    savePanelOpen(newState);
    set({ isPanelOpen: newState });
  },

  openPanel: async () => {
    const { setupStreamListener } = get();
    await setupStreamListener();
    savePanelOpen(true);
    set({ isPanelOpen: true });
  },

  closePanel: () => {
    const { cleanupStreamListener } = get();
    cleanupStreamListener();
    savePanelOpen(false);
    set({ isPanelOpen: false });
  },

  setPanelWidth: (width: number) => {
    const maxWidth = getMaxPanelWidth();
    const clampedWidth = Math.min(
      Math.max(width, MIN_PANEL_WIDTH),
      maxWidth
    );
    localStorage.setItem(PANEL_WIDTH_KEY, clampedWidth.toString());
    set({ panelWidth: clampedWidth });
  },

  initializePanel: async () => {
    const { isPanelOpen, isInitialized, setupStreamListener, setupRagStatusListener, loadConversations, addTab, provider, model } = get();

    // Skip if already initialized (synchronous check to prevent race condition)
    if (isInitialized) {
      return;
    }

    // Set initialized flag immediately to prevent concurrent calls
    set({ isInitialized: true });

    // Sync saved provider/model to backend
    try {
      await invoke("set_ai_provider", { provider, model });
    } catch (error) {
      console.error("Failed to sync AI provider:", error);
    }

    // Setup RAG status listener (always, regardless of panel state)
    await setupRagStatusListener();

    // If panel should be open, setup listener
    if (isPanelOpen) {
      await setupStreamListener();
    }

    // Load conversations list
    await loadConversations();

    // Don't restore last session here - let loadOrCreateConversationForConnection handle it
    // when a connection becomes active. This ensures conversations are properly separated by connection.
    // Just create an empty tab for now.
    await addTab(null);
  },

  // Conversation actions
  loadConversations: async () => {
    set({ isLoadingConversations: true, error: null });
    try {
      const conversations = await invoke<ConversationSummary[]>(
        "get_conversations"
      );
      set({ conversations, isLoadingConversations: false });
    } catch (error) {
      set({
        error: String(error),
        isLoadingConversations: false,
      });
    }
  },

  loadConversation: async (id: string) => {
    set({ error: null });
    try {
      const conversation = await invoke<Conversation>("get_conversation", {
        id,
      });
      // Convert backend messages to frontend format
      const messages: ChatMessage[] = conversation.messages.map((msg, idx) => ({
        id: `${conversation.id}_${idx}`,
        role: msg.role as "user" | "assistant" | "system",
        content: msg.content,
        timestamp: conversation.updated_at,
      }));
      set({
        currentConversation: {
          ...conversation,
          messages,
        },
      });
    } catch (error) {
      set({ error: String(error) });
    }
  },

  createNewConversation: (
    connectionId: string | null,
    database: string | null
  ) => {
    const newConversation: Conversation = {
      id: "",
      title: "새 대화",
      messages: [],
      connection_id: connectionId,
      database: database,
      created_at: Date.now(),
      updated_at: Date.now(),
    };
    set({ currentConversation: newConversation });
  },

  deleteConversation: async (id: string) => {
    try {
      await invoke("delete_conversation", { id });
      const { currentConversation, loadConversations } = get();

      // Reload conversations list
      await loadConversations();

      // Clear current conversation if it was deleted
      if (currentConversation?.id === id) {
        set({ currentConversation: null });
      }
    } catch (error) {
      set({ error: String(error) });
    }
  },

  // Message actions
  sendMessage: async (
    message: string,
    connectionId?: string | null,
    database?: string | null
  ) => {
    const { currentConversation, unlistenStream, setupStreamListener } = get();

    // Ensure stream listener is set up before sending
    if (!unlistenStream) {
      console.log("Stream listener not set up, setting up now...");
      await setupStreamListener();
    }

    // Create user message
    const userMessage: ChatMessage = {
      id: generateMessageId(),
      role: "user",
      content: message,
      timestamp: Date.now(),
    };

    // Create placeholder for assistant message
    const assistantMessage: ChatMessage = {
      id: generateMessageId(),
      role: "assistant",
      content: "",
      timestamp: Date.now(),
      isStreaming: true,
    };

    // Update state with new messages
    const updatedMessages = [
      ...(currentConversation?.messages || []),
      userMessage,
      assistantMessage,
    ];

    const updatedConversation: Conversation = currentConversation
      ? {
          ...currentConversation,
          messages: updatedMessages,
        }
      : {
          id: "",
          title: message.slice(0, 50),
          messages: updatedMessages,
          connection_id: connectionId ?? null,
          database: database ?? null,
          created_at: Date.now(),
          updated_at: Date.now(),
        };

    // Update both currentConversation and active tab
    set((state) => {
      const updatedTabs = state.activeTabId
        ? state.openTabs.map((tab) =>
            tab.id === state.activeTabId
              ? { ...tab, conversation: updatedConversation }
              : tab
          )
        : state.openTabs;

      return {
        currentConversation: updatedConversation,
        openTabs: updatedTabs,
        isStreaming: true,
        streamingMessageId: assistantMessage.id,
        currentStreamContent: "",
        error: null,
      };
    });

    try {
      // Send message to backend
      const { isAutoMode, autoApproveTrusted } = get();
      const conversationId = await invoke<string>("send_ai_message", {
        request: {
          conversation_id: currentConversation?.id || null,
          message: message,
          connection_id: connectionId ?? currentConversation?.connection_id,
          database: database ?? currentConversation?.database,
          auto_mode: isAutoMode,
          auto_approve: autoApproveTrusted,
        },
      });

      // Update conversation ID if this was a new conversation
      // IMPORTANT: Must update BOTH currentConversation AND openTabs to stay in sync
      if (!currentConversation?.id) {
        set((state) => {
          const updatedConversation = state.currentConversation
            ? { ...state.currentConversation, id: conversationId }
            : null;

          const updatedTabs = state.activeTabId
            ? state.openTabs.map((tab) =>
                tab.id === state.activeTabId
                  ? {
                      ...tab,
                      conversationId: conversationId,
                      conversation: updatedConversation,
                    }
                  : tab
              )
            : state.openTabs;

          return {
            currentConversation: updatedConversation,
            openTabs: updatedTabs,
          };
        });
      }
    } catch (error) {
      set({
        error: String(error),
        isStreaming: false,
        streamingMessageId: null,
      });

      // Update the assistant message with error
      set((state) => {
        if (!state.currentConversation) return state;
        const messages = state.currentConversation.messages.map((msg) =>
          msg.id === assistantMessage.id
            ? {
                ...msg,
                content: `오류가 발생했습니다: ${error}`,
                isStreaming: false,
              }
            : msg
        );
        return {
          currentConversation: {
            ...state.currentConversation,
            messages,
          },
        };
      });
    }
  },

  // Edit message and resend
  editAndResend: async (
    messageId: string,
    newContent: string,
    connectionId?: string | null,
    database?: string | null
  ) => {
    const { currentConversation, unlistenStream, setupStreamListener } = get();

    if (!currentConversation) return;

    // Find the message index
    const messageIndex = currentConversation.messages.findIndex(
      (msg) => msg.id === messageId
    );
    if (messageIndex === -1) return;

    // Ensure stream listener is set up
    if (!unlistenStream) {
      await setupStreamListener();
    }

    // Keep messages up to and including the edited message (update its content)
    const updatedUserMessage: ChatMessage = {
      ...currentConversation.messages[messageIndex],
      content: newContent,
      timestamp: Date.now(),
    };

    // Create new assistant message placeholder
    const assistantMessage: ChatMessage = {
      id: generateMessageId(),
      role: "assistant",
      content: "",
      timestamp: Date.now(),
      isStreaming: true,
    };

    // Build new messages array: messages before the edited one + edited message + new assistant message
    const newMessages = [
      ...currentConversation.messages.slice(0, messageIndex),
      updatedUserMessage,
      assistantMessage,
    ];

    const updatedConversation: Conversation = {
      ...currentConversation,
      messages: newMessages,
      updated_at: Date.now(),
    };

    // Update state
    set((state) => {
      const updatedTabs = state.activeTabId
        ? state.openTabs.map((tab) =>
            tab.id === state.activeTabId
              ? { ...tab, conversation: updatedConversation }
              : tab
          )
        : state.openTabs;

      return {
        currentConversation: updatedConversation,
        openTabs: updatedTabs,
        isStreaming: true,
        streamingMessageId: assistantMessage.id,
        currentStreamContent: "",
        error: null,
      };
    });

    try {
      // Send message to backend (is_retry: true to avoid duplicate message)
      const { isAutoMode, autoApproveTrusted } = get();
      await invoke<string>("send_ai_message", {
        request: {
          conversation_id: currentConversation.id || null,
          message: newContent,
          connection_id: connectionId ?? currentConversation.connection_id,
          database: database ?? currentConversation.database,
          is_retry: true,
          auto_mode: isAutoMode,
          auto_approve: autoApproveTrusted,
        },
      });
    } catch (error) {
      set({
        error: String(error),
        isStreaming: false,
        streamingMessageId: null,
      });

      // Update the assistant message with error
      set((state) => {
        if (!state.currentConversation) return state;
        const messages = state.currentConversation.messages.map((msg) =>
          msg.id === assistantMessage.id
            ? {
                ...msg,
                content: `오류가 발생했습니다: ${error}`,
                isStreaming: false,
              }
            : msg
        );
        return {
          currentConversation: {
            ...state.currentConversation,
            messages,
          },
        };
      });
    }
  },

  // Retry message (resend same content)
  retryMessage: async (
    messageId: string,
    connectionId?: string | null,
    database?: string | null
  ) => {
    const { currentConversation, unlistenStream, setupStreamListener } = get();

    if (!currentConversation) return;

    // Find the message
    const messageIndex = currentConversation.messages.findIndex(
      (msg) => msg.id === messageId
    );
    if (messageIndex === -1) return;

    const originalMessage = currentConversation.messages[messageIndex];
    if (originalMessage.role !== "user") return;

    // Ensure stream listener is set up
    if (!unlistenStream) {
      await setupStreamListener();
    }

    // Create new assistant message placeholder
    const assistantMessage: ChatMessage = {
      id: generateMessageId(),
      role: "assistant",
      content: "",
      timestamp: Date.now(),
      isStreaming: true,
    };

    // Keep messages up to and including the original user message + new assistant message
    const newMessages = [
      ...currentConversation.messages.slice(0, messageIndex + 1),
      assistantMessage,
    ];

    const updatedConversation: Conversation = {
      ...currentConversation,
      messages: newMessages,
      updated_at: Date.now(),
    };

    // Update state
    set((state) => {
      const updatedTabs = state.activeTabId
        ? state.openTabs.map((tab) =>
            tab.id === state.activeTabId
              ? { ...tab, conversation: updatedConversation }
              : tab
          )
        : state.openTabs;

      return {
        currentConversation: updatedConversation,
        openTabs: updatedTabs,
        isStreaming: true,
        streamingMessageId: assistantMessage.id,
        currentStreamContent: "",
        error: null,
      };
    });

    try {
      // Send same message to backend (is_retry: true to avoid duplicate message)
      const { isAutoMode, autoApproveTrusted } = get();
      await invoke<string>("send_ai_message", {
        request: {
          conversation_id: currentConversation.id || null,
          message: originalMessage.content,
          connection_id: connectionId ?? currentConversation.connection_id,
          database: database ?? currentConversation.database,
          is_retry: true,
          auto_mode: isAutoMode,
          auto_approve: autoApproveTrusted,
        },
      });
    } catch (error) {
      set({
        error: String(error),
        isStreaming: false,
        streamingMessageId: null,
      });

      // Update the assistant message with error
      set((state) => {
        if (!state.currentConversation) return state;
        const messages = state.currentConversation.messages.map((msg) =>
          msg.id === assistantMessage.id
            ? {
                ...msg,
                content: `오류가 발생했습니다: ${error}`,
                isStreaming: false,
              }
            : msg
        );
        return {
          currentConversation: {
            ...state.currentConversation,
            messages,
          },
        };
      });
    }
  },

  // Delete a message and its subsequent messages
  deleteMessage: async (messageId: string) => {
    const { currentConversation } = get();
    if (!currentConversation) return;

    // Find the message index
    const messageIndex = currentConversation.messages.findIndex(
      (msg) => msg.id === messageId
    );
    if (messageIndex === -1) return;

    // Remove this message and all messages after it
    const newMessages = currentConversation.messages.slice(0, messageIndex);

    const updatedConversation: Conversation = {
      ...currentConversation,
      messages: newMessages,
      updated_at: Date.now(),
    };

    // Update state
    set((state) => {
      const updatedTabs = state.activeTabId
        ? state.openTabs.map((tab) =>
            tab.id === state.activeTabId
              ? { ...tab, conversation: updatedConversation }
              : tab
          )
        : state.openTabs;

      return {
        currentConversation: updatedConversation,
        openTabs: updatedTabs,
      };
    });

    // Save to backend if conversation has been persisted
    if (currentConversation.id) {
      try {
        // Convert frontend messages to backend format
        const backendConversation = {
          id: updatedConversation.id,
          title: updatedConversation.title,
          messages: newMessages.map((msg) => ({
            role: msg.role,
            content: msg.content,
          })),
          connection_id: updatedConversation.connection_id,
          database: updatedConversation.database,
          created_at: updatedConversation.created_at,
          updated_at: updatedConversation.updated_at,
        };
        await invoke("update_conversation", { conversation: backendConversation });
      } catch (error) {
        console.error("Failed to save conversation after delete:", error);
      }
    }
  },

  // Cancel ongoing request and reset streaming state
  cancelRequest: () => {
    const { currentConversation, streamingMessageId } = get();

    if (!streamingMessageId) return;

    // Remove the incomplete assistant message
    if (currentConversation) {
      const messages = currentConversation.messages.filter(
        (msg) => msg.id !== streamingMessageId
      );
      const updatedConversation = {
        ...currentConversation,
        messages,
      };

      set((state) => {
        const updatedTabs = state.activeTabId
          ? state.openTabs.map((tab) =>
              tab.id === state.activeTabId
                ? { ...tab, conversation: updatedConversation }
                : tab
            )
          : state.openTabs;

        return {
          currentConversation: updatedConversation,
          openTabs: updatedTabs,
          isStreaming: false,
          streamingMessageId: null,
          currentStreamContent: "",
          streamStatus: null,
          error: null,
        };
      });
    } else {
      set({
        isStreaming: false,
        streamingMessageId: null,
        currentStreamContent: "",
        streamStatus: null,
        error: null,
      });
    }

    console.log("Request cancelled by user");
  },

  appendStreamContent: (content: string) => {
    set((state) => {
      const newContent = state.currentStreamContent + content;

      // Update the streaming message
      if (state.currentConversation && state.streamingMessageId) {
        const messages = state.currentConversation.messages.map((msg) =>
          msg.id === state.streamingMessageId
            ? { ...msg, content: newContent }
            : msg
        );
        const updatedConversation = {
          ...state.currentConversation,
          messages,
        };

        // Also update active tab
        const updatedTabs = state.activeTabId
          ? state.openTabs.map((tab) =>
              tab.id === state.activeTabId
                ? { ...tab, conversation: updatedConversation }
                : tab
            )
          : state.openTabs;

        return {
          currentStreamContent: newContent,
          currentConversation: updatedConversation,
          openTabs: updatedTabs,
        };
      }

      return { currentStreamContent: newContent };
    });
  },

  finalizeStreamMessage: () => {
    set((state) => {
      if (state.currentConversation && state.streamingMessageId) {
        const messages = state.currentConversation.messages.map((msg) =>
          msg.id === state.streamingMessageId
            ? { ...msg, isStreaming: false }
            : msg
        );
        const updatedConversation = {
          ...state.currentConversation,
          messages,
        };

        // Also update active tab with conversationId if available
        const updatedTabs = state.activeTabId
          ? state.openTabs.map((tab) =>
              tab.id === state.activeTabId
                ? {
                    ...tab,
                    conversation: updatedConversation,
                    conversationId:
                      updatedConversation.id || tab.conversationId,
                  }
                : tab
            )
          : state.openTabs;

        return {
          isStreaming: false,
          streamingMessageId: null,
          currentStreamContent: "",
          streamStatus: null,
          currentConversation: updatedConversation,
          openTabs: updatedTabs,
        };
      }
      return {
        isStreaming: false,
        streamingMessageId: null,
        currentStreamContent: "",
        streamStatus: null,
      };
    });

    // Reload conversations to update the list
    get().loadConversations();
  },

  // LLM settings actions
  loadAvailableModels: async () => {
    set({ isLoadingModels: true });
    try {
      const models = await invoke<ModelInfo[]>("get_available_models");
      set({ availableModels: models, isLoadingModels: false });
    } catch (error) {
      set({ error: String(error), isLoadingModels: false });
    }
  },

  setProvider: (provider: LLMProvider) => {
    set({ provider });
  },

  setModel: (model: string) => {
    set({ model });
  },

  setProviderAndModel: async (provider: LLMProvider, model: string) => {
    try {
      await invoke("set_ai_provider", { provider, model });
      saveProviderAndModel(provider, model);
      set({ provider, model });
    } catch (error) {
      set({ error: String(error) });
    }
  },

  saveApiKey: async (provider: LLMProvider, apiKey: string) => {
    try {
      await invoke("save_ai_api_key", { provider, apiKey });
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  deleteApiKey: async (provider: LLMProvider) => {
    try {
      await invoke("delete_ai_api_key", { provider });
    } catch (error) {
      set({ error: String(error) });
      throw error;
    }
  },

  hasApiKey: async (provider: LLMProvider): Promise<boolean> => {
    try {
      return await invoke<boolean>("has_ai_api_key", { provider });
    } catch {
      return false;
    }
  },

  testConnection: async (provider: LLMProvider): Promise<boolean> => {
    try {
      return await invoke<boolean>("test_ai_connection", { provider });
    } catch {
      return false;
    }
  },

  // Stream listener
  setupStreamListener: async () => {
    const { unlistenStream, unlistenStatus, unlistenConversationSaved } = get();
    if (unlistenStream) return; // Already listening

    try {
      // Listen for ai-stream events
      const unlisten = await listen<AIStreamEvent>("ai-stream", (event) => {
        const { content, done, error } = event.payload;

        if (error) {
          set((state) => {
            if (state.currentConversation && state.streamingMessageId) {
              const messages = state.currentConversation.messages.map((msg) =>
                msg.id === state.streamingMessageId
                  ? {
                      ...msg,
                      content: `오류: ${error}`,
                      isStreaming: false,
                    }
                  : msg
              );
              return {
                error,
                isStreaming: false,
                streamingMessageId: null,
                streamStatus: null,
                currentConversation: {
                  ...state.currentConversation,
                  messages,
                },
              };
            }
            return { error, isStreaming: false, streamStatus: null };
          });
          return;
        }

        if (done) {
          get().finalizeStreamMessage();
        } else if (content) {
          get().appendStreamContent(content);
        }
      });

      // Listen for ai-status events (analyzing_tables, generating)
      let statusUnlisten: UnlistenFn | null = null;
      if (!unlistenStatus) {
        statusUnlisten = await listen<AIStatusEvent>("ai-status", (event) => {
          const { status } = event.payload;
          set({ streamStatus: status });
        });
      }

      // Listen for ai-auto-approval events (AUTO 쿼리 실행 승인 요청)
      let autoApprovalUnlisten: UnlistenFn | null = null;
      if (!get().unlistenAutoApproval) {
        autoApprovalUnlisten = await listen<AutoApprovalEvent>("ai-auto-approval", (event) => {
          const { request_id, approval_id, query, reason } = event.payload;
          set({
            pendingApproval: {
              approvalId: approval_id,
              requestId: request_id,
              query,
              reason,
            },
          });
        });
      }

      // Listen for ai-conversation-saved events (when backend saves AI response)
      let conversationSavedUnlisten: UnlistenFn | null = null;
      if (!unlistenConversationSaved) {
        conversationSavedUnlisten = await listen<string>("ai-conversation-saved", async (event) => {
          const savedConversationId = event.payload;
          const { currentConversation, openTabs, activeTabId } = get();

          // Only reload if the saved conversation is the current one
          if (currentConversation?.id === savedConversationId) {
            try {
              const loadedConv = await invoke<Conversation>("get_conversation", {
                id: savedConversationId,
              });
              // Convert backend messages to frontend format
              const messages: ChatMessage[] = loadedConv.messages.map((msg, idx) => ({
                id: `${loadedConv.id}_${idx}`,
                role: msg.role as "user" | "assistant" | "system",
                content: msg.content,
                timestamp: loadedConv.updated_at,
              }));
              const updatedConversation = { ...loadedConv, messages };

              // Update current conversation and tab
              const updatedTabs = activeTabId
                ? openTabs.map((tab) =>
                    tab.id === activeTabId
                      ? { ...tab, conversation: updatedConversation }
                      : tab
                  )
                : openTabs;

              set({
                currentConversation: updatedConversation,
                openTabs: updatedTabs,
              });
            } catch (error) {
              console.error("Failed to reload saved conversation:", error);
            }
          }

          // Also refresh conversation list
          get().loadConversations();
        });
      }

      set({
        unlistenStream: unlisten,
        unlistenStatus: statusUnlisten ?? get().unlistenStatus,
        unlistenConversationSaved: conversationSavedUnlisten ?? get().unlistenConversationSaved,
        unlistenAutoApproval: autoApprovalUnlisten ?? get().unlistenAutoApproval,
      });
    } catch (error) {
      console.error("Failed to setup stream listener:", error);
    }
  },

  cleanupStreamListener: () => {
    const { unlistenStream, unlistenStatus, unlistenConversationSaved, unlistenAutoApproval, unlistenRagStatus, unlistenRagSuggest, unlistenRagOutdated } = get();
    if (unlistenStream) {
      unlistenStream();
    }
    if (unlistenStatus) {
      unlistenStatus();
    }
    if (unlistenConversationSaved) {
      unlistenConversationSaved();
    }
    if (unlistenAutoApproval) {
      unlistenAutoApproval();
    }
    if (unlistenRagStatus) {
      unlistenRagStatus();
    }
    if (unlistenRagSuggest) {
      unlistenRagSuggest();
    }
    if (unlistenRagOutdated) {
      unlistenRagOutdated();
    }
    set({ unlistenStream: null, unlistenStatus: null, unlistenConversationSaved: null, unlistenAutoApproval: null, unlistenRagStatus: null, unlistenRagSuggest: null, unlistenRagOutdated: null, streamStatus: null, pendingApproval: null });
  },

  setupRagStatusListener: async () => {
    const { unlistenRagStatus, unlistenRagSuggest, unlistenRagOutdated, unlistenGeminiRequired } = get();

    // Setup RAG indexing status listener
    if (!unlistenRagStatus) {
      try {
        const unlisten = await listen<RAGIndexingEvent>("rag-indexing-status", (event) => {
          const { status, error, table_count } = event.payload;
          set({
            ragIndexingStatus: status,
            ragIndexingError: error || null,
          });
          // 인덱싱 완료 시 outdated 상태 초기화 및 완료 모달 표시
          if (status === "completed") {
            set({
              ragOutdated: null,
              ragCompletedInfo: table_count ? { tableCount: table_count } : null,
              showRagCompletedModal: table_count ? true : false,
            });
          }
        });
        set({ unlistenRagStatus: unlisten });
      } catch (error) {
        console.error("Failed to setup RAG status listener:", error);
      }
    }

    // Setup RAG suggest listener (for large DBs)
    if (!unlistenRagSuggest) {
      try {
        const unlisten = await listen<RAGSuggestEvent>("rag-suggest", (event) => {
          const { connection_id, database, table_count } = event.payload;
          set({
            ragSuggestion: {
              connectionId: connection_id,
              database: database,
              tableCount: table_count,
            },
          });
        });
        set({ unlistenRagSuggest: unlisten });
      } catch (error) {
        console.error("Failed to setup RAG suggest listener:", error);
      }
    }

    // Setup RAG outdated listener (when tables changed after indexing)
    if (!unlistenRagOutdated) {
      try {
        const unlisten = await listen<RAGOutdatedEvent>("rag-outdated", (event) => {
          const { connection_id, database, added_tables, removed_tables, modified_tables } = event.payload;
          set({
            ragOutdated: {
              connectionId: connection_id,
              database: database,
              addedTables: added_tables,
              removedTables: removed_tables,
              modifiedTables: modified_tables,
            },
          });
        });
        set({ unlistenRagOutdated: unlisten });
      } catch (error) {
        console.error("Failed to setup RAG outdated listener:", error);
      }
    }

    // Setup Gemini required listener (when trying to use RAG without Gemini API key)
    if (!unlistenGeminiRequired) {
      try {
        const unlisten = await listen("rag-gemini-required", () => {
          set({ showGeminiRequiredModal: true });
        });
        set({ unlistenGeminiRequired: unlisten });
      } catch (error) {
        console.error("Failed to setup Gemini required listener:", error);
      }
    }
  },

  // RAG suggestion actions
  startRagIndexing: async (connectionId: string, database: string) => {
    // 최초 인덱싱 전 외부 전송(스키마 → Gemini File Search) 동의 필요
    if (localStorage.getItem(RAG_CONSENT_KEY) !== "true") {
      set({
        showRagConsentModal: true,
        pendingRagIndexing: { connectionId, database },
      });
      return;
    }

    try {
      await invoke("start_rag_indexing_cmd", { connectionId, database });
      // 제안 닫기
      set({ ragSuggestion: null });
    } catch (error) {
      console.error("Failed to start RAG indexing:", error);
    }
  },

  confirmRagConsent: async () => {
    const { pendingRagIndexing } = get();
    localStorage.setItem(RAG_CONSENT_KEY, "true");
    set({ showRagConsentModal: false, pendingRagIndexing: null });

    if (pendingRagIndexing) {
      const { startRagIndexing } = get();
      await startRagIndexing(
        pendingRagIndexing.connectionId,
        pendingRagIndexing.database
      );
    }
  },

  declineRagConsent: () => {
    // 동의 안 함 — 이번 세션의 제안 배너도 함께 닫는다
    set({
      showRagConsentModal: false,
      pendingRagIndexing: null,
      ragSuggestion: null,
    });
  },

  dismissRagSuggestion: () => {
    // 세션 동안만 기억 - 상태만 null로 설정
    // 앱 재시작 시 다시 제안됨
    set({ ragSuggestion: null });
  },

  // RAG outdated actions
  reindexRag: async () => {
    const { ragOutdated, ragIndexingStatus } = get();
    if (!ragOutdated) return;

    // 이미 인덱싱 중이면 중복 요청 방지
    if (ragIndexingStatus === "in_progress") return;

    const { connectionId, database, addedTables, removedTables, modifiedTables } = ragOutdated;
    const totalChanges = addedTables.length + removedTables.length + modifiedTables.length;

    // 즉시 배너 숨기고 인덱싱 상태로 변경
    set({ ragOutdated: null, ragIndexingStatus: "in_progress" });

    // 변경사항이 적으면 증분 동기화, 많으면 전체 재인덱싱
    if (totalChanges <= 10) {
      try {
        await invoke("sync_rag_schema_incremental", {
          connectionId,
          database,
          addedTables,
          modifiedTables,
          removedTables,
        });
        set({ ragIndexingStatus: "completed" });
      } catch (error) {
        console.error("Incremental sync failed, falling back to full reindex:", error);
        // 실패 시 전체 재인덱싱으로 폴백
        const { startRagIndexing } = get();
        await startRagIndexing(connectionId, database);
      }
    } else {
      // 변경사항이 많으면 전체 재인덱싱
      const { startRagIndexing } = get();
      await startRagIndexing(connectionId, database);
    }
  },

  dismissRagOutdated: () => {
    // 세션 동안만 기억 - 상태만 null로 설정
    set({ ragOutdated: null });
  },

  dismissRagCompletedModal: () => {
    set({ showRagCompletedModal: false, ragCompletedInfo: null });
  },

  closeGeminiRequiredModal: () => {
    set({ showGeminiRequiredModal: false });
  },

  // AUTO mode actions
  toggleAutoMode: () => {
    set((state) => {
      const newValue = !state.isAutoMode;
      localStorage.setItem(AUTO_MODE_KEY, newValue.toString());
      return { isAutoMode: newValue };
    });
  },

  setAutoMode: (enabled: boolean) => {
    localStorage.setItem(AUTO_MODE_KEY, enabled.toString());
    set({ isAutoMode: enabled });
  },

  toggleAutoApproveTrusted: () => {
    set((state) => {
      const newValue = !state.autoApproveTrusted;
      localStorage.setItem(AUTO_APPROVE_KEY, newValue.toString());
      return { autoApproveTrusted: newValue };
    });
  },

  // 승인 다이얼로그 응답 — 백엔드 oneshot 채널로 전달
  respondAutoQuery: async (approved: boolean) => {
    const { pendingApproval } = get();
    if (!pendingApproval) return;

    // 먼저 다이얼로그를 닫아 중복 응답 방지
    set({ pendingApproval: null });

    try {
      await invoke("respond_auto_query", {
        approvalId: pendingApproval.approvalId,
        approved,
      });
    } catch (error) {
      // 백엔드 타임아웃(120초) 이후 응답한 경우 등 — 무시해도 안전
      console.warn("Failed to respond to auto query approval:", error);
    }
  },

  // Reset
  reset: () => {
    const { cleanupStreamListener } = get();
    cleanupStreamListener();
    set({
      isPanelOpen: false,
      isInitialized: false,
      openTabs: [],
      activeTabId: null,
      currentConversation: null,
      conversations: [],
      isStreaming: false,
      streamingMessageId: null,
      currentStreamContent: "",
      error: null,
    });
  },

  // Tab actions
  addTab: async (conversationId?: string | null, connectionId?: string | null, database?: string | null): Promise<string> => {
    const { openTabs, inputFocusCallback } = get();

    // Check if conversation is already open in a tab
    if (conversationId) {
      const existingTab = openTabs.find(
        (t) => t.conversationId === conversationId
      );
      if (existingTab) {
        saveLastSession(conversationId);
        // Also save per-connection session
        if (existingTab.conversation?.connection_id) {
          saveLastSessionForConnection(existingTab.conversation.connection_id, conversationId);
        }
        set({ activeTabId: existingTab.id });
        // Sync currentConversation with the active tab
        set({ currentConversation: existingTab.conversation });
        return existingTab.id;
      }
    }

    const tabId = generateTabId();
    let conversation: Conversation | null = null;

    if (conversationId) {
      // Save last session
      saveLastSession(conversationId);
      // Load existing conversation
      try {
        const loadedConv = await invoke<Conversation>("get_conversation", {
          id: conversationId,
        });
        // Convert backend messages to frontend format
        const messages: ChatMessage[] = loadedConv.messages.map((msg, idx) => ({
          id: `${loadedConv.id}_${idx}`,
          role: msg.role as "user" | "assistant" | "system",
          content: msg.content,
          timestamp: loadedConv.updated_at,
        }));
        conversation = { ...loadedConv, messages };
        // Save per-connection session
        if (loadedConv.connection_id) {
          saveLastSessionForConnection(loadedConv.connection_id, conversationId);
        }
      } catch (error) {
        console.error("Failed to load conversation:", error);
      }
    } else {
      // Create new empty conversation with optional connection info
      conversation = {
        id: "",
        title: "새 대화",
        messages: [],
        connection_id: connectionId || null,
        database: database || null,
        created_at: Date.now(),
        updated_at: Date.now(),
      };
    }

    const newTab: AITab = {
      id: tabId,
      conversationId: conversationId || null,
      conversation,
      isLoading: false,
    };

    set((state) => ({
      openTabs: [...state.openTabs, newTab],
      activeTabId: tabId,
      currentConversation: conversation,
    }));

    // Focus input after tab is created
    setTimeout(() => {
      inputFocusCallback?.();
    }, 100);

    return tabId;
  },

  loadOrCreateConversationForConnection: async (connectionId: string, database?: string | null) => {
    const { conversations, openTabs, addTab } = get();

    // First, check if there's already an open tab for this connection
    const existingTab = openTabs.find(
      (tab) => tab.conversation?.connection_id === connectionId
    );
    if (existingTab) {
      // Save per-connection session
      if (existingTab.conversationId) {
        saveLastSessionForConnection(connectionId, existingTab.conversationId);
      }
      set({
        activeTabId: existingTab.id,
        currentConversation: existingTab.conversation,
      });
      return;
    }

    // Check for an empty tab (no connection_id) that can be reused
    const emptyTab = openTabs.find(
      (tab) => !tab.conversation?.connection_id && !tab.conversationId &&
               (!tab.conversation?.messages || tab.conversation.messages.length === 0)
    );

    // Try to find last session for this connection
    const lastSessionId = getSavedLastSessionForConnection(connectionId);

    // Check if that conversation still exists
    if (lastSessionId && conversations.some((c) => c.id === lastSessionId)) {
      // If there's an empty tab, close it first to avoid duplicates
      if (emptyTab) {
        set((state) => ({
          openTabs: state.openTabs.filter((t) => t.id !== emptyTab.id),
        }));
      }
      await addTab(lastSessionId);
      return;
    }

    // Find the most recent conversation for this connection
    const connectionConversations = conversations
      .filter((c) => c.connection_id === connectionId)
      .sort((a, b) => b.updated_at - a.updated_at);

    if (connectionConversations.length > 0) {
      // If there's an empty tab, close it first to avoid duplicates
      if (emptyTab) {
        set((state) => ({
          openTabs: state.openTabs.filter((t) => t.id !== emptyTab.id),
        }));
      }
      await addTab(connectionConversations[0].id);
      saveLastSessionForConnection(connectionId, connectionConversations[0].id);
      return;
    }

    // No existing conversation - reuse empty tab or create new one with connection info
    if (emptyTab) {
      // Update the empty tab with connection info
      const updatedConversation: Conversation = {
        id: "",
        title: "새 대화",
        messages: [],
        connection_id: connectionId,
        database: database || null,
        created_at: Date.now(),
        updated_at: Date.now(),
      };
      set((state) => ({
        openTabs: state.openTabs.map((t) =>
          t.id === emptyTab.id
            ? { ...t, conversation: updatedConversation }
            : t
        ),
        activeTabId: emptyTab.id,
        currentConversation: updatedConversation,
      }));
      return;
    }

    // Create a new tab with connection info
    await addTab(null, connectionId, database);
  },

  closeTab: (tabId: string) => {
    const { openTabs, activeTabId, inputFocusCallback } = get();
    const newTabs = openTabs.filter((t) => t.id !== tabId);

    // If closing last tab, create a new empty tab
    if (newTabs.length === 0) {
      const newTabId = generateTabId();
      const newConversation: Conversation = {
        id: "",
        title: "새 대화",
        messages: [],
        connection_id: null,
        database: null,
        created_at: Date.now(),
        updated_at: Date.now(),
      };
      const newTab: AITab = {
        id: newTabId,
        conversationId: null,
        conversation: newConversation,
        isLoading: false,
      };
      set({
        openTabs: [newTab],
        activeTabId: newTabId,
        currentConversation: newConversation,
      });
      setTimeout(() => {
        inputFocusCallback?.();
      }, 100);
      return;
    }

    // Determine new active tab
    let newActiveId = activeTabId;
    if (activeTabId === tabId) {
      const closedIndex = openTabs.findIndex((t) => t.id === tabId);
      newActiveId = newTabs[Math.min(closedIndex, newTabs.length - 1)]?.id || null;
    }

    // Find the new active tab's conversation
    const newActiveTab = newTabs.find((t) => t.id === newActiveId);

    set({
      openTabs: newTabs,
      activeTabId: newActiveId,
      currentConversation: newActiveTab?.conversation || null,
    });
  },

  setActiveTab: (tabId: string) => {
    const { openTabs } = get();
    const tab = openTabs.find((t) => t.id === tabId);
    if (tab) {
      // Save last session if it has a conversationId
      if (tab.conversationId) {
        saveLastSession(tab.conversationId);
      }
      set({
        activeTabId: tabId,
        currentConversation: tab.conversation,
      });
    }
  },

  updateActiveTabConversation: (conversation: Conversation) => {
    const { openTabs, activeTabId } = get();
    if (!activeTabId) return;

    const updatedTabs = openTabs.map((tab) =>
      tab.id === activeTabId
        ? {
            ...tab,
            conversation,
            conversationId: conversation.id || tab.conversationId,
          }
        : tab
    );

    set({
      openTabs: updatedTabs,
      currentConversation: conversation,
    });
  },

  getActiveConversation: (): Conversation | null => {
    const { openTabs, activeTabId } = get();
    if (!activeTabId) return null;
    const activeTab = openTabs.find((t) => t.id === activeTabId);
    return activeTab?.conversation || null;
  },

  setInputFocusCallback: (callback: (() => void) | null) => {
    set({ inputFocusCallback: callback });
  },

  // Menu actions
  closeCurrentTab: () => {
    const { activeTabId, closeTab } = get();
    if (activeTabId) {
      closeTab(activeTabId);
    }
  },

  clearAllConversations: async () => {
    const { conversations, loadConversations, addTab } = get();

    // Delete all conversations
    for (const conv of conversations) {
      try {
        await invoke("delete_conversation", { id: conv.id });
      } catch (error) {
        console.error("Failed to delete conversation:", conv.id, error);
      }
    }

    // Reset state and create a new empty tab
    set({
      openTabs: [],
      activeTabId: null,
      currentConversation: null,
      conversations: [],
    });

    // Create a fresh tab
    await addTab(null);

    // Reload conversations list
    await loadConversations();
  },

  closeOtherTabs: () => {
    const { openTabs, activeTabId } = get();
    if (!activeTabId) return;

    const activeTab = openTabs.find((t) => t.id === activeTabId);
    if (!activeTab) return;

    set({
      openTabs: [activeTab],
      currentConversation: activeTab.conversation,
    });
  },

  exportCurrentConversation: async () => {
    const { currentConversation } = get();
    if (!currentConversation) return;

    // Convert conversation to Markdown
    const lines: string[] = [];
    lines.push(`# ${currentConversation.title || "Untitled Conversation"}`);
    lines.push("");
    lines.push(`*Exported on ${new Date().toLocaleString()}*`);
    lines.push("");
    lines.push("---");
    lines.push("");

    for (const message of currentConversation.messages) {
      const role = message.role === "user" ? "User" : "Assistant";
      lines.push(`## ${role}`);
      lines.push("");
      lines.push(message.content);
      lines.push("");
      lines.push("---");
      lines.push("");
    }

    const markdown = lines.join("\n");

    try {
      // Use browser-based download
      const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${currentConversation.title || "conversation"}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Failed to export conversation:", error);
    }
  },
}));
