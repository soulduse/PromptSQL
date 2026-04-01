import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { TabState, TableViewMode, useTabStore, ContentSortState } from "../../stores/tabStore";
import { useAIStore } from "../../stores/aiStore";
import { ContentView } from "./ContentView";
import { StructureView } from "./StructureView";
import { InfoView } from "./InfoView";
import { QueryEditor, SelectionInfo, QueryEditorHandle } from "../editor/QueryEditor";
import { SelectionFloatingMenu } from "../editor/SelectionFloatingMenu";
import { QueryErrorPanel } from "../editor/QueryErrorPanel";
import { QueryProgressOverlay } from "../editor/QueryProgressOverlay";
import { StructureIcon, ContentIcon, InfoIcon, TerminalIcon, QuestionMarkCircleIcon, RefreshIcon } from "../common/Icons";
import { ResizableDataTable } from "../common/ResizableDataTable";

type FilterOperator = '=' | '!=' | 'LIKE' | '>' | '<' | '>=' | '<=' | 'IS NULL' | 'IS NOT NULL';

interface FilterState {
  column: string;
  operator: FilterOperator;
  value: string;
}

const QUERY_EDITOR_HEIGHT_KEY = "promptsql-query-editor-height";
const DEFAULT_EDITOR_HEIGHT = 50; // percentage
const MIN_EDITOR_HEIGHT = 20; // percentage
const MAX_EDITOR_HEIGHT = 80; // percentage

interface TableViewTabsProps {
  tab: TabState;
  onExecuteQuery: (query: string) => void;
  onOpenHistory?: () => void;
}

const tabs: { mode: TableViewMode; icon: React.ReactNode; labelKey: string }[] = [
  {
    mode: 'structure',
    icon: <StructureIcon className="w-4 h-4" />,
    labelKey: 'tableView.structure',
  },
  {
    mode: 'content',
    icon: <ContentIcon className="w-4 h-4" />,
    labelKey: 'tableView.content',
  },
  {
    mode: 'info',
    icon: <InfoIcon className="w-4 h-4" />,
    labelKey: 'tableView.info',
  },
  {
    mode: 'query',
    icon: <TerminalIcon className="w-4 h-4" />,
    labelKey: 'tableView.query',
  },
];

export function TableViewTabs({ tab, onExecuteQuery, onOpenHistory }: TableViewTabsProps) {
  const { t } = useTranslation();
  const { setTableViewMode, updateTabQuery, fetchTableStructure, fetchTableIndexes, fetchTableContent, updateCellValue, insertRow, deleteRow, buildDeleteQuery, clearQueryError, cancelQuery, updateQueryResultCellValue, deleteQueryResultRows, setTableContentSort } = useTabStore();
  const { togglePanel: toggleAIPanel } = useAIStore();

  // Filter state for content view
  const [activeFilter, setActiveFilter] = useState<FilterState | null>(null);

  // Selection floating menu state
  const [selection, setSelection] = useState<SelectionInfo | null>(null);

  // QueryEditor ref for goToLine
  const queryEditorRef = useRef<QueryEditorHandle>(null);

  // Resizer state
  const [editorHeight, setEditorHeight] = useState(() => {
    const saved = localStorage.getItem(QUERY_EDITOR_HEIGHT_KEY);
    if (saved) {
      const parsed = parseFloat(saved);
      // Validate: must be a valid number within bounds
      if (!isNaN(parsed) && parsed >= MIN_EDITOR_HEIGHT && parsed <= MAX_EDITOR_HEIGHT) {
        return parsed;
      }
    }
    return DEFAULT_EDITOR_HEIGHT;
  });
  const [isResizing, setIsResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Save editor height to localStorage (with validation)
  useEffect(() => {
    if (!isNaN(editorHeight) && editorHeight >= MIN_EDITOR_HEIGHT && editorHeight <= MAX_EDITOR_HEIGHT) {
      localStorage.setItem(QUERY_EDITOR_HEIGHT_KEY, String(editorHeight));
    }
  }, [editorHeight]);

  // Cmd+R keyboard handler for content tab refresh
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'r') {
        // Only handle for content tab - query tab is handled by QueryEditor
        if (tab.tableViewMode === 'content' && tab.selectedTable) {
          e.preventDefault();
          fetchTableContent(tab.id, activeFilter, tab.tableContentSort);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [tab.id, tab.tableViewMode, tab.selectedTable, tab.tableContentSort, activeFilter, fetchTableContent]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing || !containerRef.current) return;

    const containerRect = containerRef.current.getBoundingClientRect();
    // Prevent division by zero
    if (containerRect.height <= 0) return;

    const newHeight = ((e.clientY - containerRect.top) / containerRect.height) * 100;

    if (!isNaN(newHeight) && newHeight >= MIN_EDITOR_HEIGHT && newHeight <= MAX_EDITOR_HEIGHT) {
      setEditorHeight(newHeight);
    }
  }, [isResizing]);

  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
  }, []);

  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, handleMouseMove, handleMouseUp]);

  const handleTabClick = (mode: TableViewMode) => {
    setTableViewMode(tab.id, mode);
  };

  // Handle column sort for content view (backend sorting via ORDER BY)
  const handleSort = useCallback((columnIndex: number, columnName: string) => {
    const currentSort = tab.tableContentSort;

    let newSort: ContentSortState | null;

    // Different column clicked: start with ascending
    if (currentSort?.columnIndex !== columnIndex) {
      newSort = { column: columnName, columnIndex, direction: 'asc' };
    }
    // Same column: toggle asc -> desc -> null
    else if (currentSort.direction === 'asc') {
      newSort = { column: columnName, columnIndex, direction: 'desc' };
    }
    else if (currentSort.direction === 'desc') {
      newSort = null; // Reset to original order
    }
    else {
      newSort = { column: columnName, columnIndex, direction: 'asc' };
    }

    // Update sort state and refetch with new sort
    setTableContentSort(tab.id, newSort);
    fetchTableContent(tab.id, activeFilter, newSort);
  }, [tab.id, tab.tableContentSort, activeFilter, setTableContentSort, fetchTableContent]);

  const renderContent = () => {
    if (!tab.selectedTable && tab.tableViewMode !== 'query') {
      return (
        <div className="flex-1 flex items-center justify-center text-gray-500">
          {t('tableView.selectTable')}
        </div>
      );
    }

    switch (tab.tableViewMode) {
      case 'structure':
        return (
          <StructureView
            structure={tab.tableStructure}
            indexes={tab.tableIndexes}
            loading={tab.loadingTableStructure}
            loadingIndexes={tab.loadingTableIndexes}
            connectionId={tab.connectionId || undefined}
            database={tab.selectedDatabase || undefined}
            table={tab.selectedTable || undefined}
            onRefresh={() => {
              fetchTableStructure(tab.id);
              fetchTableIndexes(tab.id);
            }}
            onRefreshIndexes={() => fetchTableIndexes(tab.id)}
            onExecuteQuery={async (query: string) => {
              if (!tab.connectionId || !tab.selectedDatabase) {
                return { success: false, error: "No connection or database selected" };
              }
              try {
                await invoke("execute_query", {
                  connectionId: tab.connectionId,
                  database: tab.selectedDatabase,
                  query,
                });
                return { success: true };
              } catch (error) {
                return { success: false, error: String(error) };
              }
            }}
          />
        );
      case 'content':
        return (
          <ContentView
            content={tab.tableContent}
            loading={tab.loadingTableContent}
            totalRows={tab.totalRows}
            tableName={tab.selectedTable}
            tableStructure={tab.tableStructure}
            onCellUpdate={
              tab.tableContent
                ? async (columnIndex, newValue, originalRow) => {
                    return await updateCellValue(
                      tab.id,
                      columnIndex,
                      newValue,
                      originalRow,
                      tab.tableContent!.columns
                    );
                  }
                : undefined
            }
            onInsertRow={
              tab.tableContent
                ? async (values, columns) => {
                    return await insertRow(tab.id, values, columns);
                  }
                : undefined
            }
            onDeleteRow={
              tab.tableContent
                ? async (rowData, columns) => {
                    return await deleteRow(tab.id, rowData, columns);
                  }
                : undefined
            }
            onBuildDeleteQuery={
              tab.tableContent
                ? (rowData, columns) => {
                    return buildDeleteQuery(tab.id, rowData, columns);
                  }
                : undefined
            }
            onRefresh={() => fetchTableContent(tab.id, activeFilter, tab.tableContentSort)}
            onFilter={(filter) => {
              setActiveFilter(filter);
              fetchTableContent(tab.id, filter, tab.tableContentSort);
            }}
            sortState={tab.tableContentSort}
            onSort={handleSort}
          />
        );
      case 'info':
        return (
          <InfoView
            info={tab.tableInfo}
            createTableSql={tab.createTableSql}
            loading={tab.loadingTableInfo}
            loadingCreateTable={tab.loadingCreateTable}
          />
        );
      case 'query':
        return (
          <div ref={containerRef} className="flex-1 flex flex-col h-full">
            {/* Query Editor Section */}
            <div
              className="flex flex-col"
              style={{ height: `calc(${editorHeight}% - 2px)` }}
            >
              <div className="h-10 bg-gray-800 border-b border-gray-700 flex items-center px-4 justify-between flex-shrink-0">
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-400">{t("query.editor")}</span>
                  <span className="text-xs text-gray-500">{t("query.autocompleteHint")}</span>
                </div>
                <button
                  onClick={() => {
                    // Execute first query only (split by semicolon)
                    const firstQuery = tab.query.split(';')[0]?.trim();
                    if (firstQuery) {
                      onExecuteQuery(firstQuery);
                    }
                  }}
                  disabled={!tab.selectedDatabase || tab.isExecuting}
                  className="px-3 py-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm transition flex items-center gap-2"
                >
                  <span>&#9654;</span>
                  <span>{tab.isExecuting ? t("query.executing") : t("query.run")}</span>
                  <span className="text-xs opacity-70">&#8984;R</span>
                </button>
              </div>
              <div className="flex-1 min-h-0 relative">
                <QueryEditor
                  ref={queryEditorRef}
                  value={tab.query}
                  onChange={(v) => updateTabQuery(tab.id, v || "")}
                  onExecute={onExecuteQuery}
                  onOpenHistory={onOpenHistory}
                  onToggleAI={toggleAIPanel}
                  onSelectionChange={setSelection}
                  tables={tab.tables}
                  errorInfo={tab.queryError ? { lineNumber: tab.queryError.lineNumber, nearText: tab.queryError.nearText } : null}
                />
                {selection && tab.connectionId && (
                  <SelectionFloatingMenu
                    selectedText={selection.text}
                    position={selection.position}
                    connectionId={tab.connectionId}
                    database={tab.selectedDatabase}
                    onClose={() => setSelection(null)}
                    onSaved={() => setSelection(null)}
                  />
                )}
              </div>
            </div>

            {/* Resizer */}
            <div
              className={`h-1 bg-gray-700 cursor-row-resize hover:bg-blue-500 transition-colors flex-shrink-0 ${
                isResizing ? 'bg-blue-500' : ''
              }`}
              onMouseDown={handleMouseDown}
            />

            {/* Results Section */}
            <div
              className="flex flex-col relative"
              style={{ height: `calc(${100 - editorHeight}% - 2px)` }}
            >
              <div className="h-10 bg-gray-800 border-b border-gray-700 flex items-center justify-between px-4 flex-shrink-0">
                <div className="flex items-center">
                  <span className="text-sm text-gray-400">{t("query.results")}</span>
                  {tab.results && (
                    <span className="ml-4 text-xs text-gray-500">
                      {t("query.executionTime", { time: tab.results.execution_time_ms })}
                    </span>
                  )}
                  {tab.results && tab.results.rows.length > 0 && (
                    <span className="ml-4 text-xs text-gray-500 flex items-center gap-1">
                      {tab.results.rows.length.toLocaleString()} rows
                      {tab.results.truncated && (
                        <span className="ml-2 text-yellow-500 flex items-center gap-1">
                          ({t("query.limited")})
                          <span title={t("query.resultsTruncatedHint")} className="cursor-help">
                            <QuestionMarkCircleIcon className="w-4 h-4" />
                          </span>
                        </span>
                      )}
                    </span>
                  )}
                </div>
                {tab.lastQuery && (
                  <button
                    onClick={() => onExecuteQuery(tab.lastQuery!)}
                    disabled={tab.isExecuting}
                    className="p-1.5 rounded hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    title={t("query.refresh")}
                  >
                    <RefreshIcon className={`w-4 h-4 text-gray-400 ${tab.isExecuting ? 'animate-spin' : ''}`} />
                  </button>
                )}
              </div>
              <div className="flex-1 overflow-auto min-h-0 relative">
                {/* Query Progress Overlay */}
                <QueryProgressOverlay
                  isExecuting={tab.isExecuting}
                  startTime={tab.queryStartTime}
                  onCancel={() => cancelQuery(tab.id)}
                />
                {tab.results ? (
                  tab.results.columns.length > 0 ? (
                    <ResizableDataTable
                      columns={tab.results.columns}
                      columnTypes={tab.results.column_types}
                      columnTables={tab.results.column_tables}
                      rows={tab.results.rows}
                      showColumnTypes={true}
                      onCellUpdate={async (rowIndex, columnIndex, newValue, originalRow) => {
                        return await updateQueryResultCellValue(
                          tab.id,
                          rowIndex,
                          columnIndex,
                          newValue,
                          originalRow
                        );
                      }}
                      onDeleteRows={async (rowsToDelete) => {
                        return await deleteQueryResultRows(tab.id, rowsToDelete);
                      }}
                    />
                  ) : (
                    <div className="p-4">
                      <p className="text-gray-500 text-sm">
                        {t("query.rowsAffected", { count: tab.results.affected_rows })}
                      </p>
                    </div>
                  )
                ) : (
                  <div className="p-4">
                    <p className="text-gray-500 text-sm">{t("query.noResults")}</p>
                  </div>
                )}
              </div>

              {/* Error Panel */}
              {tab.queryError && (
                <div className="absolute bottom-0 left-0 right-0 z-20">
                  <QueryErrorPanel
                    error={tab.queryError}
                    onDismiss={() => clearQueryError(tab.id)}
                    onGoToLine={(line) => queryEditorRef.current?.goToLine(line)}
                  />
                </div>
              )}
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Tab Buttons */}
      <div className="h-10 bg-gray-800 border-b border-gray-700 flex items-center px-2">
        {tabs.map((tabItem) => (
          <button
            key={tabItem.mode}
            onClick={() => handleTabClick(tabItem.mode)}
            className={`flex items-center gap-2 px-4 py-2 text-sm rounded-t transition ${
              tab.tableViewMode === tabItem.mode
                ? 'bg-gray-900 text-white border-t border-l border-r border-gray-700 -mb-px'
                : 'text-gray-400 hover:text-white hover:bg-gray-700'
            }`}
          >
            {tabItem.icon}
            <span>{t(tabItem.labelKey)}</span>
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 flex flex-col overflow-hidden bg-gray-900">
        {/* Table Name Header - only for structure, content, info tabs */}
        {tab.selectedTable && tab.tableViewMode !== 'query' && (
          <div className="h-10 bg-blue-50 dark:bg-blue-900/30 border-b border-blue-200 dark:border-blue-800 flex items-center px-4 flex-shrink-0">
            <span className="text-sm font-semibold text-blue-700 dark:text-blue-300">{tab.selectedTable}</span>
            {tab.selectedDatabase && (
              <span className="text-xs text-blue-500 dark:text-blue-400 ml-2">({tab.selectedDatabase})</span>
            )}
          </div>
        )}
        {renderContent()}
      </div>
    </div>
  );
}
