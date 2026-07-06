import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { TabBar } from "./components/tabs/TabBar";
import { ConnectionModal, ConnectionFormData } from "./components/connection/ConnectionModal";
import { WelcomeScreen } from "./components/connection/WelcomeScreen";
import { NewTabView } from "./components/connection/NewTabView";
import { SettingsModal } from "./components/settings/SettingsModal";
import { HistorySearchModal } from "./components/history/HistorySearchModal";
import { TableList } from "./components/schema/TableList";
import { TableInfoPanel } from "./components/schema/TableInfoPanel";
import { ResizableSidebar } from "./components/common/ResizableSidebar";
import { TableViewTabs } from "./components/table/TableViewTabs";
import { DatabaseExportModal } from "./components/schema/DatabaseExportModal";
import { AddDatabaseModal } from "./components/database/AddDatabaseModal";
import AIChatPanel from "./components/ai/AIChatPanel";
import { useConnectionStore, Connection } from "./stores/connectionStore";
import { useTabStore } from "./stores/tabStore";
import { useAIStore } from "./stores/aiStore";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { UploadIcon } from "./components/common/Icons";

// System databases that are auto-created by database services
const SYSTEM_DATABASES = new Set([
  // MySQL / MariaDB / RDS
  "information_schema",
  "mysql",
  "performance_schema",
  "sys",
  // PostgreSQL
  "postgres",
  "template0",
  "template1",
  // SQL Server
  "master",
  "model",
  "msdb",
  "tempdb",
]);

const isSystemDatabase = (dbName: string): boolean => {
  return SYSTEM_DATABASES.has(dbName.toLowerCase());
};

function DatabaseSelector({ tabId }: { tabId: string }) {
  const { t } = useTranslation();
  const tab = useTabStore((state) => state.tabs.find((t) => t.id === tabId));
  const { selectDatabase, fetchTables, fetchDatabases } = useTabStore();
  const [isOpen, setIsOpen] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (tabId) {
      fetchDatabases(tabId);
    }
  }, [tabId, fetchDatabases]);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  // Close on ESC
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  if (!tab) return null;

  const handleSelect = async (database: string) => {
    selectDatabase(tabId, database);
    fetchTables(tabId, database);
    setIsOpen(false);

    // Save last used database
    if (tab?.connectionId) {
      try {
        await invoke("update_last_database", {
          connectionId: tab.connectionId,
          database,
        });
      } catch (e) {
        console.error("Failed to save last used database:", e);
      }
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={tab.loadingDatabases}
        className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 border border-gray-600 rounded-md px-4 py-2 text-sm transition disabled:opacity-50 min-w-[200px]"
      >
        <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
        </svg>
        <span className={tab.selectedDatabase ? "text-white" : "text-gray-400"}>
          {tab.loadingDatabases ? t("database.loading") : tab.selectedDatabase || t("database.select")}
        </span>
        <svg className={`w-4 h-4 text-gray-400 ml-auto transition ${isOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (() => {
        const userDatabases = tab.databases.filter((db) => !isSystemDatabase(db));
        const systemDatabases = tab.databases.filter((db) => isSystemDatabase(db));

        return (
          <div className="absolute z-50 mt-1 w-full bg-gray-800 border border-gray-600 rounded-md shadow-lg max-h-60 overflow-auto">
            {/* Add Database */}
            <button
              onClick={() => {
                setShowAddModal(true);
                setIsOpen(false);
              }}
              className="w-full px-4 py-2 text-sm text-left hover:bg-gray-700 transition text-gray-300 flex items-center gap-2 border-b border-gray-600"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              {t("database.addDatabase")}
            </button>

            {/* User Databases */}
            {userDatabases.map((db) => (
              <button
                key={db}
                onClick={() => handleSelect(db)}
                className={`w-full px-4 py-2 text-sm text-left hover:bg-gray-700 transition ${
                  tab.selectedDatabase === db ? "bg-blue-600/20 text-blue-400" : "text-gray-300"
                }`}
              >
                {db}
              </button>
            ))}

            {/* Separator and System Databases */}
            {systemDatabases.length > 0 && (
              <>
                <div className="flex items-center gap-2 px-4 py-1.5 border-t border-gray-600">
                  <span className="text-xs text-gray-500">{t("database.systemDatabases")}</span>
                  <div className="flex-1 h-px bg-gray-600" />
                </div>
                {systemDatabases.map((db) => (
                  <button
                    key={db}
                    onClick={() => handleSelect(db)}
                    className={`w-full px-4 py-2 text-sm text-left hover:bg-gray-700 transition ${
                      tab.selectedDatabase === db ? "bg-blue-600/20 text-blue-400" : "text-gray-400"
                    }`}
                  >
                    {db}
                  </button>
                ))}
              </>
            )}
          </div>
        );
      })()}

      {isOpen && tab.databases.length === 0 && !tab.loadingDatabases && (
        <div className="absolute z-50 mt-1 w-full bg-gray-800 border border-gray-600 rounded-md shadow-lg overflow-hidden">
          {/* Add Database option even when empty */}
          <button
            onClick={() => {
              setShowAddModal(true);
              setIsOpen(false);
            }}
            className="w-full px-4 py-2 text-sm text-left hover:bg-gray-700 transition text-gray-300 flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            {t("database.addDatabase")}
          </button>
          <div className="px-4 py-2 text-sm text-gray-500 text-center border-t border-gray-600">
            {t("database.noDatabase")}
          </div>
        </div>
      )}

      {/* Add Database Modal */}
      {tab.connectionId && (
        <AddDatabaseModal
          isOpen={showAddModal}
          onClose={() => setShowAddModal(false)}
          connectionId={tab.connectionId}
          onSuccess={() => fetchDatabases(tabId)}
        />
      )}
    </div>
  );
}

function App() {
  const { t } = useTranslation();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsDefaultTab, setSettingsDefaultTab] = useState<string | undefined>(undefined);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [editingConnection, setEditingConnection] = useState<Connection | null>(null);

  const { loadSavedConnections, addConnection, updateConnection, removeConnection, connectDatabase } = useConnectionStore();
  const { tabs, activeTabId, addTab, convertNewTabToConnection, selectTable, fetchTables } = useTabStore();
  const { togglePanel: toggleAIPanel, initializePanel, isPanelOpen: isAIPanelOpen, closeCurrentTab: closeAITab } = useAIStore();
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const lastClickInAIPanelRef = useRef(false);

  useEffect(() => {
    loadSavedConnections();
  }, [loadSavedConnections]);

  // Initialize AI panel on app startup
  useEffect(() => {
    initializePanel();
  }, [initializePanel]);

  // Load font size and theme settings on startup
  useEffect(() => {
    const savedFontSize = localStorage.getItem("promptsql-font-size");
    if (savedFontSize) {
      const size = parseInt(savedFontSize, 10);
      if (size >= 12 && size <= 24) {
        document.documentElement.style.fontSize = `${size}px`;
      }
    }

    // Load theme setting (default to dark)
    const savedTheme = localStorage.getItem("promptsql-theme");
    if (savedTheme === "light") {
      document.documentElement.classList.remove("dark");
    } else {
      document.documentElement.classList.add("dark");
    }
  }, []);

  // Track clicks to determine if last interaction was in AI panel
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Element;
      lastClickInAIPanelRef.current = !!target?.closest('[data-ai-panel]');
    };

    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Global keyboard shortcuts
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Cmd+W: Close AI tab or show close confirmation
    if ((e.metaKey || e.ctrlKey) && e.key === "w") {
      e.preventDefault();
      e.stopPropagation();

      // Check if focus is in AI panel OR last click was in AI panel
      const activeElement = document.activeElement;
      const isFocusInAIPanel = !!activeElement?.closest('[data-ai-panel]');
      const isInAIPanel = isFocusInAIPanel || lastClickInAIPanelRef.current;

      if (isAIPanelOpen && isInAIPanel) {
        closeAITab();
      } else {
        // Show close confirmation dialog
        setShowCloseConfirm(true);
      }
      return;
    }
    // Cmd+H: Open history
    if ((e.metaKey || e.ctrlKey) && e.key === "h") {
      e.preventDefault();
      setIsHistoryOpen(true);
    }
    // Cmd+,: Open settings
    if ((e.metaKey || e.ctrlKey) && e.key === ",") {
      e.preventDefault();
      setIsSettingsOpen(true);
    }
    // Cmd+K: Toggle AI panel
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      toggleAIPanel();
    }
  }, [toggleAIPanel, isAIPanelOpen, closeAITab]);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const activeTab = tabs.find((t) => t.id === activeTabId);

  const handleSaveConnection = async (data: ConnectionFormData) => {
    if (editingConnection) {
      // Edit mode
      await updateConnection(editingConnection.id, {
        name: data.name,
        host: data.host,
        port: data.port,
        user: data.user,
        password: data.password,
        database: data.database || undefined,
      });
      setEditingConnection(null);
    } else {
      // Create mode
      const connection = await addConnection({
        name: data.name,
        host: data.host,
        port: data.port,
        user: data.user,
        password: data.password,
        database: data.database || undefined,
      });

      // Auto-connect after save
      const result = await connectDatabase(connection.id);
      if (result.success) {
        let tabId: string;
        // Check if we have an active new tab to convert
        if (activeTab?.isNewTab) {
          tabId = activeTab.id;
          convertNewTabToConnection(tabId, connection.id, connection.name, connection.last_used_database);
        } else {
          tabId = addTab(connection.id, connection.name, connection.last_used_database);
        }
        // Fetch databases after tab is ready
        try {
          const databases = await invoke<string[]>("get_databases", { connectionId: connection.id });
          useTabStore.setState((state) => ({
            tabs: state.tabs.map((t) =>
              t.id === tabId ? { ...t, databases } : t
            ),
          }));
          // If there's a last used database, fetch its tables
          if (connection.last_used_database) {
            fetchTables(tabId, connection.last_used_database);
          }
        } catch (e) {
          console.error("Failed to fetch databases:", e);
        }
      } else {
        alert(`${t("connection.failed")}: ${result.message}`);
      }
    }
  };

  const handleConnectFromNewTab = async (connection: Connection) => {
    const result = await connectDatabase(connection.id);
    if (result.success && activeTab?.isNewTab) {
      const tabId = activeTab.id;  // Save the original tab ID before conversion
      convertNewTabToConnection(tabId, connection.id, connection.name, connection.last_used_database);
      // Fetch databases
      try {
        const databases = await invoke<string[]>("get_databases", { connectionId: connection.id });
        useTabStore.setState((state) => ({
          tabs: state.tabs.map((t) =>
            t.id === tabId ? { ...t, databases } : t
          ),
        }));
        // If there's a last used database, fetch its tables
        if (connection.last_used_database) {
          fetchTables(tabId, connection.last_used_database);
        }
      } catch (e) {
        console.error("Failed to fetch databases:", e);
      }
    } else if (!result.success) {
      alert(`${t("connection.failed")}: ${result.message}`);
    }
  };

  const handleEditConnection = (connection: Connection) => {
    setEditingConnection(connection);
    setIsModalOpen(true);
  };

  const handleDeleteConnection = async (connectionId: string) => {
    await removeConnection(connectionId);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingConnection(null);
  };

  const handleExecute = (query: string) => {
    if (!activeTab) return;
    useTabStore.getState().executeQuery(activeTab.id, query);
  };

  const handleTableClick = (table: string) => {
    if (!activeTabId) return;
    selectTable(activeTabId, table);
  };

  const handleOpenInNewTab = (table: string) => {
    if (!activeTab?.connectionId || !activeTab.selectedDatabase) return;
    const newTabId = addTab(activeTab.connectionId, activeTab.connectionName, activeTab.selectedDatabase);
    // Select the table in the new tab after a short delay to ensure tab is ready
    setTimeout(() => {
      selectTable(newTabId, table);
    }, 100);
  };

  const handleRefreshTables = () => {
    if (!activeTab?.connectionId || !activeTab.selectedDatabase) return;
    fetchTables(activeTabId!, activeTab.selectedDatabase);
  };

  return (
    <div className="h-screen flex flex-col bg-gray-900 text-white">
      {/* Tab Bar */}
      <TabBar
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenHistory={() => setIsHistoryOpen(true)}
      />

      {/* Main Content */}
      {tabs.length > 0 && activeTab ? (
        activeTab.isNewTab ? (
          // Show NewTabView for new tabs
          <NewTabView
            tabId={activeTab.id}
            onConnect={handleConnectFromNewTab}
            onEditConnection={handleEditConnection}
            onDeleteConnection={handleDeleteConnection}
            onNewConnection={() => setIsModalOpen(true)}
          />
        ) : (
          // Show database view for connected tabs
          <div className="flex-1 flex overflow-hidden">
            {/* Resizable Sidebar */}
            <ResizableSidebar>
              <div className="flex-1 overflow-auto">
                {activeTab.selectedDatabase ? (
                  <TableList
                    tables={activeTab.tables}
                    loading={activeTab.loadingTables}
                    selectedTable={activeTab.selectedTable}
                    connectionId={activeTab.connectionId}
                    database={activeTab.selectedDatabase}
                    onTableClick={handleTableClick}
                    onOpenInNewTab={handleOpenInNewTab}
                    onRefreshTables={handleRefreshTables}
                  />
                ) : (
                  <div className="p-4 text-gray-500 text-sm text-center">
                    {t("database.select")}
                  </div>
                )}
              </div>
              {/* Table Info Panel */}
              <TableInfoPanel
                connectionId={activeTab.connectionId || ""}
                database={activeTab.selectedDatabase}
                table={activeTab.selectedTable}
              />
            </ResizableSidebar>

            {/* Main Panel */}
            <main className="flex-1 flex flex-col overflow-hidden">
              {/* Database Selector Header */}
              <div className="h-12 bg-gray-800 border-b border-gray-700 flex items-center justify-center gap-2 px-4 flex-shrink-0">
                <DatabaseSelector tabId={activeTab.id} />
                {activeTab.selectedDatabase && activeTab.tables.length > 0 && (
                  <button
                    onClick={() => setIsExportOpen(true)}
                    className="flex items-center gap-1.5 px-3 py-2 text-sm bg-gray-700 hover:bg-gray-600 rounded-md transition text-gray-300 hover:text-white"
                    title={t("dbExport.title")}
                  >
                    <UploadIcon className="w-4 h-4" />
                    <span className="hidden sm:inline">{t("dbExport.export")}</span>
                  </button>
                )}
              </div>

              {/* Table View Tabs */}
              <TableViewTabs
                tab={activeTab}
                onExecuteQuery={handleExecute}
                onOpenHistory={() => setIsHistoryOpen(true)}
              />
            </main>

            {/* AI Chat Panel */}
            <AIChatPanel
              onOpenSettings={(tab) => {
                setSettingsDefaultTab(tab);
                setIsSettingsOpen(true);
              }}
              isSettingsOpen={isSettingsOpen}
            />
          </div>
        )
      ) : (
        <WelcomeScreen onNewConnection={() => setIsModalOpen(true)} />
      )}

      {/* Modals */}
      <ConnectionModal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        onSave={handleSaveConnection}
        initialData={editingConnection ? {
          name: editingConnection.name,
          host: editingConnection.host,
          port: editingConnection.port,
          user: editingConnection.user,
          // 비밀번호는 프론트로 반환되지 않는다 — 빈칸 = 변경 안 함
          password: "",
          database: editingConnection.database || "",
        } : null}
        mode={editingConnection ? "edit" : "create"}
      />
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => {
          setIsSettingsOpen(false);
          setSettingsDefaultTab(undefined);
        }}
        defaultTab={settingsDefaultTab}
      />
      <HistorySearchModal
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
      />
      {activeTab?.connectionId && activeTab?.selectedDatabase && (
        <DatabaseExportModal
          isOpen={isExportOpen}
          connectionId={activeTab.connectionId}
          database={activeTab.selectedDatabase}
          tables={activeTab.tables}
          onClose={() => setIsExportOpen(false)}
        />
      )}

      {/* Close Confirmation Dialog */}
      {showCloseConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
          <div className="bg-gray-800 border border-gray-600 rounded-lg shadow-xl p-6 max-w-sm mx-4">
            <h3 className="text-lg font-semibold text-white mb-2">
              {t("app.closeConfirmTitle", "앱을 종료하시겠습니까?")}
            </h3>
            <p className="text-gray-400 text-sm mb-6">
              {t("app.closeConfirmMessage", "저장하지 않은 변경 사항이 있을 수 있습니다.")}
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowCloseConfirm(false)}
                className="px-4 py-2 text-sm bg-gray-700 hover:bg-gray-600 rounded-md transition text-gray-300"
              >
                {t("common.cancel", "취소")}
              </button>
              <button
                onClick={async () => {
                  await getCurrentWindow().close();
                }}
                className="px-4 py-2 text-sm bg-red-600 hover:bg-red-500 rounded-md transition text-white"
              >
                {t("app.quit", "종료")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
