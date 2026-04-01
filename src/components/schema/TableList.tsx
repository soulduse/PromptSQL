import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { TableMenu } from "./TableMenu";
import { RenameTableModal } from "./RenameTableModal";
import { DuplicateTableModal } from "./DuplicateTableModal";
import { CreateTableSyntaxModal } from "./CreateTableSyntaxModal";
import { ExportTableModal } from "./ExportTableModal";
import { DangerousTableActionModal } from "./DangerousTableActionModal";
import { CloseIcon, BookmarkIcon, TableIcon, MoreVerticalIcon, RefreshIcon } from "../common/Icons";

const PINNED_TABLES_KEY = "promptsql-pinned-tables";

interface TableListProps {
  tables: string[];
  loading: boolean;
  selectedTable: string | null;
  connectionId: string | null;
  database: string | null;
  onTableClick: (table: string) => void;
  onOpenInNewTab: (table: string) => void;
  onRefreshTables: () => void;
}

// Helper functions for pinned tables
const getPinnedTables = (connectionId: string, database: string): string[] => {
  const key = `${PINNED_TABLES_KEY}-${connectionId}-${database}`;
  const stored = localStorage.getItem(key);
  return stored ? JSON.parse(stored) : [];
};

const savePinnedTables = (connectionId: string, database: string, tables: string[]): void => {
  const key = `${PINNED_TABLES_KEY}-${connectionId}-${database}`;
  localStorage.setItem(key, JSON.stringify(tables));
};

export function TableList({
  tables,
  loading,
  selectedTable,
  connectionId,
  database,
  onTableClick,
  onOpenInNewTab,
  onRefreshTables,
}: TableListProps) {
  const { t } = useTranslation();
  const [hoveredTable, setHoveredTable] = useState<string | null>(null);
  const [menuOpenTable, setMenuOpenTable] = useState<string | null>(null);
  const [pinnedTables, setPinnedTables] = useState<string[]>([]);
  const [filterText, setFilterText] = useState("");

  // Modal states
  const [truncateModal, setTruncateModal] = useState<{ isOpen: boolean; tableName: string }>({ isOpen: false, tableName: "" });
  const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; tableName: string }>({ isOpen: false, tableName: "" });
  const [renameModal, setRenameModal] = useState<{ isOpen: boolean; tableName: string }>({ isOpen: false, tableName: "" });
  const [duplicateModal, setDuplicateModal] = useState<{ isOpen: boolean; tableName: string }>({ isOpen: false, tableName: "" });
  const [createTableModal, setCreateTableModal] = useState<{ isOpen: boolean; tableName: string }>({ isOpen: false, tableName: "" });
  const [exportModal, setExportModal] = useState<{ isOpen: boolean; tableName: string; type: "csv" | "json" | "sql" }>({ isOpen: false, tableName: "", type: "csv" });

  // Load pinned tables when connection/database changes
  useEffect(() => {
    if (connectionId && database) {
      setPinnedTables(getPinnedTables(connectionId, database));
    }
  }, [connectionId, database]);

  // Sort tables: pinned first, then alphabetically
  const sortedTables = [...tables].sort((a, b) => {
    const aIsPinned = pinnedTables.includes(a);
    const bIsPinned = pinnedTables.includes(b);
    if (aIsPinned && !bIsPinned) return -1;
    if (!aIsPinned && bIsPinned) return 1;
    return a.localeCompare(b);
  });

  // Filter tables by search text
  const filteredTables = filterText
    ? sortedTables.filter((table) =>
        table.toLowerCase().includes(filterText.toLowerCase())
      )
    : sortedTables;

  const handleTogglePin = (table: string) => {
    if (!connectionId || !database) return;

    const newPinned = pinnedTables.includes(table)
      ? pinnedTables.filter((t) => t !== table)
      : [...pinnedTables, table];

    setPinnedTables(newPinned);
    savePinnedTables(connectionId, database, newPinned);
  };

  const handleCopyName = async (table: string) => {
    await navigator.clipboard.writeText(table);
  };

  const handleCopyCreateTable = async (table: string) => {
    if (!connectionId || !database) return;
    try {
      const sql = await invoke<string>("get_create_table", {
        connectionId,
        database,
        table,
      });
      await navigator.clipboard.writeText(sql);
    } catch (error) {
      console.error("Failed to copy CREATE TABLE:", error);
    }
  };

  const handleRename = (table: string) => {
    setRenameModal({ isOpen: true, tableName: table });
  };

  const handleDuplicate = (table: string) => {
    setDuplicateModal({ isOpen: true, tableName: table });
  };

  const handleTruncate = (table: string) => {
    setTruncateModal({ isOpen: true, tableName: table });
  };

  const handleDelete = (table: string) => {
    setDeleteModal({ isOpen: true, tableName: table });
  };

  const executeTruncate = async () => {
    if (!connectionId || !database) return;
    try {
      await invoke("execute_query", {
        connectionId,
        database,
        query: `TRUNCATE TABLE \`${truncateModal.tableName}\``,
      });
      setTruncateModal({ isOpen: false, tableName: "" });
      onRefreshTables();
    } catch (error) {
      console.error("Failed to truncate table:", error);
    }
  };

  const executeDelete = async () => {
    if (!connectionId || !database) return;
    try {
      await invoke("execute_query", {
        connectionId,
        database,
        query: `DROP TABLE \`${deleteModal.tableName}\``,
      });
      setDeleteModal({ isOpen: false, tableName: "" });
      onRefreshTables();
    } catch (error) {
      console.error("Failed to delete table:", error);
    }
  };

  const handleExportCsv = (table: string) => {
    setExportModal({ isOpen: true, tableName: table, type: "csv" });
  };

  const handleExportJson = (table: string) => {
    setExportModal({ isOpen: true, tableName: table, type: "json" });
  };

  const handleExportSql = (table: string) => {
    setExportModal({ isOpen: true, tableName: table, type: "sql" });
  };

  const handleShowCreateTable = (table: string) => {
    setCreateTableModal({ isOpen: true, tableName: table });
  };

  if (loading) {
    return (
      <div className="px-3 py-6 text-center text-gray-500 text-sm">
        <div className="inline-block animate-spin w-4 h-4 border-2 border-gray-500 border-t-transparent rounded-full mr-2" />
        {t("common.loading")}
      </div>
    );
  }

  if (tables.length === 0) {
    return (
      <div className="px-3 py-6 text-center text-gray-500 text-sm">
        No tables found
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Filter Input with Refresh Button */}
      <div className="px-3 py-2 border-b border-gray-700 flex-shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={onRefreshTables}
            disabled={loading}
            className="p-1.5 text-gray-400 hover:text-gray-200 hover:bg-gray-700 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
            title={t("sidebar.refreshTables", "Refresh tables")}
          >
            <RefreshIcon className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          <div className="relative flex-1">
            <input
              type="text"
              placeholder={t("sidebar.filter")}
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-1.5 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
            />
            {filterText && (
              <button
                onClick={() => setFilterText("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-gray-400 hover:text-gray-200 transition"
              >
                <CloseIcon className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Table List */}
      <div className="py-1 flex-1 overflow-auto">
      {filteredTables.map((table) => {
        const isPinned = pinnedTables.includes(table);
        const isHovered = hoveredTable === table;
        const isMenuOpen = menuOpenTable === table;

        return (
          <div
            key={table}
            className="relative"
            onMouseEnter={() => setHoveredTable(table)}
            onMouseLeave={() => setHoveredTable(null)}
          >
            <div
              onClick={() => onTableClick(table)}
              className={`px-3 py-1.5 text-sm cursor-pointer flex items-center gap-2 transition group ${
                selectedTable === table
                  ? "bg-blue-600/20 text-blue-400"
                  : "text-gray-300 hover:bg-gray-700/50"
              }`}
            >
              {/* Pin icon */}
              {isPinned && (
                <BookmarkIcon className="w-3 h-3 text-yellow-500 flex-shrink-0" />
              )}

              {/* Table icon */}
              <TableIcon className="w-4 h-4 text-amber-400 flex-shrink-0" />

              {/* Table name */}
              <span className="truncate flex-1">{table}</span>

              {/* Menu button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpenTable(isMenuOpen ? null : table);
                }}
                className={`p-0.5 rounded hover:bg-gray-600 transition-opacity ${
                  isHovered || isMenuOpen ? "opacity-100" : "opacity-0"
                }`}
              >
                <MoreVerticalIcon className="w-4 h-4 text-gray-400" />
              </button>
            </div>

            {/* Dropdown Menu */}
            {isMenuOpen && connectionId && database && (
              <TableMenu
                tableName={table}
                database={database}
                connectionId={connectionId}
                isPinned={isPinned}
                onCopyName={() => handleCopyName(table)}
                onRename={() => handleRename(table)}
                onDuplicate={() => handleDuplicate(table)}
                onTruncate={() => handleTruncate(table)}
                onDelete={() => handleDelete(table)}
                onTogglePin={() => handleTogglePin(table)}
                onOpenInNewTab={() => onOpenInNewTab(table)}
                onExportCsv={() => handleExportCsv(table)}
                onExportJson={() => handleExportJson(table)}
                onExportSql={() => handleExportSql(table)}
                onShowCreateTable={() => handleShowCreateTable(table)}
                onCopyCreateTable={() => handleCopyCreateTable(table)}
                onClose={() => setMenuOpenTable(null)}
              />
            )}
          </div>
        );
      })}
      </div>

      {/* Truncate Confirmation Modal */}
      {connectionId && database && (
        <DangerousTableActionModal
          isOpen={truncateModal.isOpen}
          tableName={truncateModal.tableName}
          connectionId={connectionId}
          database={database}
          action="truncate"
          onConfirm={executeTruncate}
          onCancel={() => setTruncateModal({ isOpen: false, tableName: "" })}
        />
      )}

      {/* Delete Confirmation Modal */}
      {connectionId && database && (
        <DangerousTableActionModal
          isOpen={deleteModal.isOpen}
          tableName={deleteModal.tableName}
          connectionId={connectionId}
          database={database}
          action="delete"
          onConfirm={executeDelete}
          onCancel={() => setDeleteModal({ isOpen: false, tableName: "" })}
        />
      )}

      {/* Rename Table Modal */}
      {connectionId && database && (
        <RenameTableModal
          isOpen={renameModal.isOpen}
          tableName={renameModal.tableName}
          connectionId={connectionId}
          database={database}
          onSuccess={onRefreshTables}
          onClose={() => setRenameModal({ isOpen: false, tableName: "" })}
        />
      )}

      {/* Duplicate Table Modal */}
      {connectionId && database && (
        <DuplicateTableModal
          isOpen={duplicateModal.isOpen}
          tableName={duplicateModal.tableName}
          connectionId={connectionId}
          database={database}
          onSuccess={onRefreshTables}
          onClose={() => setDuplicateModal({ isOpen: false, tableName: "" })}
        />
      )}

      {/* Create Table Syntax Modal */}
      {connectionId && database && (
        <CreateTableSyntaxModal
          isOpen={createTableModal.isOpen}
          tableName={createTableModal.tableName}
          connectionId={connectionId}
          database={database}
          onClose={() => setCreateTableModal({ isOpen: false, tableName: "" })}
        />
      )}

      {/* Export Table Modal */}
      {connectionId && database && (
        <ExportTableModal
          isOpen={exportModal.isOpen}
          tableName={exportModal.tableName}
          connectionId={connectionId}
          database={database}
          exportType={exportModal.type}
          onClose={() => setExportModal({ isOpen: false, tableName: "", type: "csv" })}
        />
      )}
    </div>
  );
}
