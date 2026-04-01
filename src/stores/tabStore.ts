import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { useHistoryStore } from "./historyStore";

const LAST_DB_KEY_PREFIX = "promptsql-last-database-";
const DEFAULT_QUERY_ROW_LIMIT = 10000; // Default limit for query results

// Helper functions for localStorage
const getLastUsedDatabase = (connectionId: string): string | null => {
  return localStorage.getItem(`${LAST_DB_KEY_PREFIX}${connectionId}`);
};

const saveLastUsedDatabase = (connectionId: string, database: string): void => {
  localStorage.setItem(`${LAST_DB_KEY_PREFIX}${connectionId}`, database);
};

export interface QueryResult {
  columns: string[];
  column_types: string[];
  column_tables: string[];      // Original table name for each column (for JOIN support)
  column_org_names: string[];   // Original column name for each column
  rows: (string | number | boolean | null)[][];
  affected_rows: number;
  execution_time_ms: number;
  truncated?: boolean;  // true if results were limited
}

export interface QueryError {
  message: string;
  errorCode?: string;
  sqlState?: string;
  lineNumber?: number;
  nearText?: string;
  timestamp: number;
}

export interface ColumnInfo {
  field: string;
  column_type: string;
  is_nullable: string;
  key: string;
  default_value: string | null;
  extra: string;
  character_set: string | null;
  collation: string | null;
  column_comment: string | null;
}

export interface TableDetailInfo {
  created: string | null;
  updated: string | null;
  engine: string | null;
  rows: number;
  row_format: string | null;
  avg_row_length: number;
  data_length: number;
  max_data_length: number;
  index_length: number;
  data_free: number;
  table_collation: string | null;
  character_set: string | null;
  auto_increment: number | null;
  table_comment: string | null;
  index_count: number;
  column_count: number;
}

export interface IndexInfo {
  non_unique: boolean;
  key_name: string;
  seq_in_index: number;
  column_name: string;
  collation: string | null;
  cardinality: number | null;
  sub_part: number | null;
  packed: string | null;
  index_comment: string | null;
}

export type TableViewMode = 'structure' | 'content' | 'info' | 'query';

// Sort types for content tab (backend sorting via ORDER BY)
export type SortDirection = 'asc' | 'desc' | null;

export interface ContentSortState {
  column: string;
  columnIndex: number;
  direction: SortDirection;
}

export interface TabState {
  id: string;
  connectionId: string | null;  // null for new tabs
  connectionName: string;
  isNewTab: boolean;  // true for tabs that need connection selection
  query: string;
  results: QueryResult | null;
  queryError: QueryError | null;
  isExecuting: boolean;
  queryStartTime: number | null;  // timestamp when query started
  selectedDatabase: string | null;
  databases: string[];
  tables: string[];
  selectedTable: string | null;
  loadingDatabases: boolean;
  loadingTables: boolean;
  // Table view states
  tableViewMode: TableViewMode;
  tableContent: QueryResult | null;
  tableStructure: ColumnInfo[] | null;
  tableInfo: TableDetailInfo | null;
  tableIndexes: IndexInfo[] | null;
  createTableSql: string | null;
  loadingTableContent: boolean;
  loadingTableStructure: boolean;
  loadingTableInfo: boolean;
  loadingTableIndexes: boolean;
  loadingCreateTable: boolean;
  totalRows: number;
  // Sort state for content tab (backend sorting)
  tableContentSort: ContentSortState | null;
  // Last executed query (for refresh functionality)
  lastQuery: string | null;
}

interface TabsStore {
  tabs: TabState[];
  activeTabId: string | null;

  // Tab actions
  addTab: (connectionId: string, connectionName: string, lastUsedDatabase?: string) => string;
  addNewTab: () => void;
  convertNewTabToConnection: (tabId: string, connectionId: string, connectionName: string, lastUsedDatabase?: string) => void;
  removeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;

  // Query actions
  updateTabQuery: (tabId: string, query: string) => void;
  appendToQuery: (tabId: string, code: string) => void;
  executeQuery: (tabId: string, query?: string) => Promise<void>;
  cancelQuery: (tabId: string) => Promise<void>;
  clearQueryError: (tabId: string) => void;

  // Database actions
  fetchDatabases: (tabId: string) => Promise<void>;
  selectDatabase: (tabId: string, database: string) => void;

  // Table actions
  fetchTables: (tabId: string, database: string) => Promise<void>;
  selectTable: (tabId: string, table: string | null) => void;

  // Table view actions
  setTableViewMode: (tabId: string, mode: TableViewMode) => void;
  setTableContentSort: (tabId: string, sort: ContentSortState | null) => void;
  fetchTableContent: (tabId: string, filter?: { column: string; operator: string; value: string } | null, sort?: ContentSortState | null) => Promise<void>;
  fetchTableStructure: (tabId: string) => Promise<void>;
  fetchTableInfo: (tabId: string) => Promise<void>;
  fetchTableIndexes: (tabId: string) => Promise<void>;
  fetchCreateTable: (tabId: string) => Promise<void>;
  updateCellValue: (
    tabId: string,
    columnIndex: number,
    newValue: string | null,
    originalRow: (string | number | boolean | null)[],
    columns: string[]
  ) => Promise<{ success: boolean; error?: string }>;
  insertRow: (
    tabId: string,
    values: (string | null)[],
    columns: string[]
  ) => Promise<{ success: boolean; error?: string }>;
  deleteRow: (
    tabId: string,
    rowData: (string | number | boolean | null)[],
    columns: string[]
  ) => Promise<{ success: boolean; error?: string }>;
  buildDeleteQuery: (
    tabId: string,
    rowData: (string | number | boolean | null)[],
    columns: string[]
  ) => string | null;

  // Query result cell editing (for JOIN support)
  updateQueryResultCellValue: (
    tabId: string,
    rowIndex: number,
    columnIndex: number,
    newValue: string | null,
    originalRow: (string | number | boolean | null)[]
  ) => Promise<{ success: boolean; error?: string }>;

  // Query result row deletion
  deleteQueryResultRows: (
    tabId: string,
    rowsToDelete: (string | number | boolean | null)[][]
  ) => Promise<{ success: boolean; error?: string }>;

  // Utils
  getActiveTab: () => TabState | undefined;
  clearTab: (tabId: string) => void;
}

export const useTabStore = create<TabsStore>((set, get) => ({
  tabs: [],
  activeTabId: null,

  addTab: (connectionId: string, connectionName: string, lastUsedDatabase?: string) => {
    // Generate unique tab ID (not using connectionId to allow multiple tabs to same connection)
    const tabId = `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Get last used database from localStorage if not provided
    const savedDatabase = lastUsedDatabase || getLastUsedDatabase(connectionId);

    const newTab: TabState = {
      id: tabId,
      connectionId,
      connectionName,
      isNewTab: false,
      query: "",
      results: null,
      queryError: null,
      isExecuting: false,
      queryStartTime: null,
      selectedDatabase: savedDatabase,
      databases: [],
      tables: [],
      selectedTable: null,
      loadingDatabases: false,
      loadingTables: false,
      // Table view states
      tableViewMode: 'content',
      tableContent: null,
      tableStructure: null,
      tableInfo: null,
      tableIndexes: null,
      createTableSql: null,
      loadingTableContent: false,
      loadingTableStructure: false,
      loadingTableInfo: false,
      loadingTableIndexes: false,
      loadingCreateTable: false,
      totalRows: 0,
      tableContentSort: null,
      lastQuery: null,
    };

    set((state) => ({
      tabs: [...state.tabs, newTab],
      activeTabId: tabId,
    }));

    return tabId;
  },

  addNewTab: () => {
    const tabId = `new-tab-${Date.now()}`;

    const newTab: TabState = {
      id: tabId,
      connectionId: null,
      connectionName: "New Tab",
      isNewTab: true,
      query: "",
      results: null,
      queryError: null,
      isExecuting: false,
      queryStartTime: null,
      selectedDatabase: null,
      databases: [],
      tables: [],
      selectedTable: null,
      loadingDatabases: false,
      loadingTables: false,
      tableViewMode: 'content',
      tableContent: null,
      tableStructure: null,
      tableInfo: null,
      tableIndexes: null,
      createTableSql: null,
      loadingTableContent: false,
      loadingTableStructure: false,
      loadingTableInfo: false,
      loadingTableIndexes: false,
      loadingCreateTable: false,
      totalRows: 0,
      tableContentSort: null,
      lastQuery: null,
    };

    set((state) => ({
      tabs: [...state.tabs, newTab],
      activeTabId: tabId,
    }));
  },

  convertNewTabToConnection: (tabId: string, connectionId: string, connectionName: string, lastUsedDatabase?: string) => {
    // Get last used database from localStorage if not provided
    const savedDatabase = lastUsedDatabase || getLastUsedDatabase(connectionId);

    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId
          ? {
              ...t,
              // Keep the original tab ID (don't change to connectionId)
              connectionId,
              connectionName,
              isNewTab: false,
              selectedDatabase: savedDatabase,
            }
          : t
      ),
      // Keep the same activeTabId since we're not changing the tab ID
      activeTabId: tabId,
    }));
  },

  removeTab: (tabId: string) => {
    set((state) => {
      const newTabs = state.tabs.filter((t) => t.id !== tabId);
      let newActiveTabId = state.activeTabId;

      if (state.activeTabId === tabId) {
        const index = state.tabs.findIndex((t) => t.id === tabId);
        if (newTabs.length > 0) {
          newActiveTabId = newTabs[Math.min(index, newTabs.length - 1)].id;
        } else {
          newActiveTabId = null;
        }
      }

      return { tabs: newTabs, activeTabId: newActiveTabId };
    });
  },

  setActiveTab: (tabId: string) => {
    set({ activeTabId: tabId });
  },

  updateTabQuery: (tabId: string, query: string) => {
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, query } : t)),
    }));
  },

  appendToQuery: (tabId: string, code: string) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab) return;

    // Switch to query view mode
    get().setTableViewMode(tabId, 'query');

    // Append code to existing query with proper spacing
    const currentQuery = tab.query.trim();
    const newQuery = currentQuery
      ? `${currentQuery}\n\n${code}`
      : code;

    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, query: newQuery } : t)),
    }));
  },

  executeQuery: async (tabId: string, queryToExecute?: string) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || !tab.connectionId) return;

    // Use provided query or fall back to full editor content
    let query = queryToExecute || tab.query;
    if (!query.trim()) return;

    // Check if this is a SELECT query without LIMIT
    const trimmedQuery = query.trim().toUpperCase();
    const isSelectQuery = trimmedQuery.startsWith("SELECT");
    const hasLimit = /\bLIMIT\s+\d+/i.test(query);
    let limitApplied = false;

    // Add LIMIT if it's a SELECT query without LIMIT
    if (isSelectQuery && !hasLimit) {
      // Remove trailing semicolon and add LIMIT
      query = query.trim().replace(/;$/, '') + ` LIMIT ${DEFAULT_QUERY_ROW_LIMIT}`;
      limitApplied = true;
    }

    const startTime = Date.now();

    // Clear queryError on start, set queryStartTime, but keep previous results
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, isExecuting: true, queryError: null, queryStartTime: startTime } : t
      ),
    }));

    try {
      const results = await invoke<QueryResult>("execute_query", {
        connectionId: tab.connectionId,
        database: tab.selectedDatabase || null,
        query: query,
      });

      // Mark as truncated if we applied limit and got exactly that many rows
      if (limitApplied && results.rows.length === DEFAULT_QUERY_ROW_LIMIT) {
        results.truncated = true;
      }

      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === tabId ? { ...t, results, queryError: null, isExecuting: false, queryStartTime: null, lastQuery: query } : t
        ),
      }));

      // Record successful query to history
      useHistoryStore.getState().addHistory({
        query: query,
        connection_id: tab.connectionId,
        database: tab.selectedDatabase,
        timestamp: startTime,
        execution_time_ms: results.execution_time_ms,
        row_count: results.rows.length,
        status: "success",
        error_message: null,
        note: null,
        group_id: null,
      });
    } catch (error) {
      console.error("Query execution failed:", error);

      // Parse error message for line number and near text
      const errorMessage = String(error);
      let lineNumber: number | undefined;
      let nearText: string | undefined;
      let errorCode: string | undefined;
      let sqlState: string | undefined;

      // Parse MySQL error code and state: "1064 (42000):"
      const codeMatch = errorMessage.match(/^(\d+)\s*\((\w+)\):/);
      if (codeMatch) {
        errorCode = codeMatch[1];
        sqlState = codeMatch[2];
      }

      // Parse line number: "at line N"
      const lineMatch = errorMessage.match(/at line (\d+)/i);
      if (lineMatch) {
        lineNumber = parseInt(lineMatch[1], 10);
      }

      // Parse near text: "near 'xxx'"
      const nearMatch = errorMessage.match(/near ['"]([^'"]+)['"]/i);
      if (nearMatch) {
        nearText = nearMatch[1];
      }

      const queryError: QueryError = {
        message: errorMessage,
        errorCode,
        sqlState,
        lineNumber,
        nearText,
        timestamp: Date.now(),
      };

      // Set queryError but keep previous results
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === tabId ? { ...t, isExecuting: false, queryError, queryStartTime: null } : t
        ),
      }));

      // Record failed query to history
      useHistoryStore.getState().addHistory({
        query: query,
        connection_id: tab.connectionId,
        database: tab.selectedDatabase,
        timestamp: startTime,
        execution_time_ms: Date.now() - startTime,
        row_count: 0,
        status: "error",
        error_message: errorMessage,
        note: null,
        group_id: null,
      });
    }
  },

  cancelQuery: async (tabId: string) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || !tab.connectionId || !tab.isExecuting) {
      return;
    }

    try {
      await invoke<number>("cancel_query", {
        connectionId: tab.connectionId,
      });

      // Mark query as cancelled
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === tabId ? {
            ...t,
            isExecuting: false,
            queryStartTime: null,
            queryError: {
              message: "Query cancelled by user",
              timestamp: Date.now(),
            },
          } : t
        ),
      }));
    } catch (error) {
      console.error("Failed to cancel query:", error);
    }
  },

  clearQueryError: (tabId: string) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, queryError: null } : t
      ),
    }));
  },

  fetchDatabases: async (tabId: string) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab) return;

    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, loadingDatabases: true } : t
      ),
    }));

    try {
      const databases = await invoke<string[]>("get_databases", {
        connectionId: tab.connectionId,
      });

      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === tabId ? { ...t, databases, loadingDatabases: false } : t
        ),
      }));

      // If there's a pre-selected database (restored from localStorage), fetch its tables
      const updatedTab = get().tabs.find((t) => t.id === tabId);
      if (updatedTab?.selectedDatabase && databases.includes(updatedTab.selectedDatabase)) {
        get().fetchTables(tabId, updatedTab.selectedDatabase);
      }
    } catch (error) {
      console.error("Failed to fetch databases:", error);
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === tabId ? { ...t, databases: [], loadingDatabases: false } : t
        ),
      }));
    }
  },

  selectDatabase: (tabId: string, database: string) => {
    const tab = get().tabs.find((t) => t.id === tabId);

    // Save to localStorage if we have a connectionId
    if (tab?.connectionId) {
      saveLastUsedDatabase(tab.connectionId, database);
    }

    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId
          ? { ...t, selectedDatabase: database, tables: [], selectedTable: null }
          : t
      ),
    }));
  },

  fetchTables: async (tabId: string, database: string) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab) return;

    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, loadingTables: true } : t
      ),
    }));

    try {
      const tables = await invoke<string[]>("get_tables", {
        connectionId: tab.connectionId,
        database,
      });

      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === tabId ? { ...t, tables, loadingTables: false } : t
        ),
      }));

      // Check RAG schema changes in background (fire and forget)
      // Has 5-minute cooldown to prevent excessive checking
      if (tab.connectionId) {
        invoke("check_rag_schema_changes", {
          connectionId: tab.connectionId,
          database,
        }).catch((err) => {
          // Silently ignore errors - this is a background check
          console.debug("RAG schema check:", err);
        });
      }
    } catch (error) {
      console.error("Failed to fetch tables:", error);
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === tabId ? { ...t, tables: [], loadingTables: false } : t
        ),
      }));
    }
  },

  selectTable: (tabId: string, table: string | null) => {
    const currentTab = get().tabs.find((t) => t.id === tabId);
    const currentMode = currentTab?.tableViewMode || 'content';

    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? {
          ...t,
          selectedTable: table,
          // Keep current tableViewMode - don't reset to 'content'
          tableContent: null,
          tableStructure: null,
          tableInfo: null,
          tableIndexes: null,
          createTableSql: null,
          // Reset sort when table changes
          tableContentSort: null,
        } : t
      ),
    }));
    // Fetch data based on current view mode when table is selected
    if (table) {
      // Always need structure for inline editing (PK detection)
      get().fetchTableStructure(tabId);

      // Fetch data based on current mode
      if (currentMode === 'content') {
        get().fetchTableContent(tabId);
        get().fetchTableInfo(tabId);
      } else if (currentMode === 'structure') {
        get().fetchTableIndexes(tabId);
      } else if (currentMode === 'info') {
        get().fetchTableInfo(tabId);
        get().fetchCreateTable(tabId);
      }
      // For 'query' mode, no additional data needed
    }
  },

  setTableViewMode: (tabId: string, mode: TableViewMode) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, tableViewMode: mode } : t
      ),
    }));
    // Fetch data for the mode if not already loaded
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab) return;

    if (mode === 'content' && !tab.tableContent && tab.selectedTable) {
      get().fetchTableContent(tabId);
    } else if (mode === 'structure' && tab.selectedTable) {
      if (!tab.tableStructure) {
        get().fetchTableStructure(tabId);
      }
      if (!tab.tableIndexes) {
        get().fetchTableIndexes(tabId);
      }
    } else if (mode === 'info' && tab.selectedTable) {
      if (!tab.tableInfo) {
        get().fetchTableInfo(tabId);
      }
      if (!tab.createTableSql) {
        get().fetchCreateTable(tabId);
      }
    }
  },

  setTableContentSort: (tabId: string, sort: ContentSortState | null) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, tableContentSort: sort } : t
      ),
    }));
  },

  fetchTableContent: async (tabId: string, filter?: { column: string; operator: string; value: string } | null, sort?: ContentSortState | null) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || !tab.selectedDatabase || !tab.selectedTable) return;

    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, loadingTableContent: true } : t
      ),
    }));

    try {
      // Build WHERE clause if filter is provided
      let whereClause = "";
      if (filter && filter.column) {
        const escapeString = (str: string): string => {
          return str.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
        };

        const { column, operator, value } = filter;
        if (operator === "IS NULL") {
          whereClause = ` WHERE \`${column}\` IS NULL`;
        } else if (operator === "IS NOT NULL") {
          whereClause = ` WHERE \`${column}\` IS NOT NULL`;
        } else if (operator === "LIKE") {
          whereClause = ` WHERE \`${column}\` LIKE '%${escapeString(value)}%'`;
        } else {
          whereClause = ` WHERE \`${column}\` ${operator} '${escapeString(value)}'`;
        }
      }

      // Build ORDER BY clause if sort is provided
      let orderByClause = "";
      if (sort && sort.column && sort.direction) {
        // Escape backticks in column name for SQL injection prevention
        const escapedColumn = sort.column.replace(/`/g, '``');
        const direction = sort.direction === 'desc' ? 'DESC' : 'ASC';
        orderByClause = ` ORDER BY \`${escapedColumn}\` ${direction}`;
      }

      const query = `SELECT * FROM \`${tab.selectedDatabase}\`.\`${tab.selectedTable}\`${whereClause}${orderByClause} LIMIT 1000`;
      const results = await invoke<QueryResult>("execute_query", {
        connectionId: tab.connectionId,
        query,
      });

      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === tabId ? { ...t, tableContent: results, loadingTableContent: false } : t
        ),
      }));
    } catch (error) {
      console.error("Failed to fetch table content:", error);
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === tabId ? { ...t, tableContent: null, loadingTableContent: false } : t
        ),
      }));
    }
  },

  fetchTableStructure: async (tabId: string) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || !tab.selectedDatabase || !tab.selectedTable) return;

    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, loadingTableStructure: true } : t
      ),
    }));

    try {
      const structure = await invoke<ColumnInfo[]>("get_table_schema", {
        connectionId: tab.connectionId,
        database: tab.selectedDatabase,
        table: tab.selectedTable,
      });

      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === tabId ? { ...t, tableStructure: structure, loadingTableStructure: false } : t
        ),
      }));
    } catch (error) {
      console.error("Failed to fetch table structure:", error);
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === tabId ? { ...t, tableStructure: null, loadingTableStructure: false } : t
        ),
      }));
    }
  },

  fetchTableInfo: async (tabId: string) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || !tab.selectedDatabase || !tab.selectedTable) return;

    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, loadingTableInfo: true } : t
      ),
    }));

    try {
      const info = await invoke<TableDetailInfo>("get_table_detail_info", {
        connectionId: tab.connectionId,
        database: tab.selectedDatabase,
        table: tab.selectedTable,
      });

      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === tabId ? {
            ...t,
            tableInfo: info,
            totalRows: info.rows,
            loadingTableInfo: false
          } : t
        ),
      }));
    } catch (error) {
      console.error("Failed to fetch table info:", error);
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === tabId ? { ...t, tableInfo: null, loadingTableInfo: false } : t
        ),
      }));
    }
  },

  fetchTableIndexes: async (tabId: string) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || !tab.selectedDatabase || !tab.selectedTable) return;

    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, loadingTableIndexes: true } : t
      ),
    }));

    try {
      const indexes = await invoke<IndexInfo[]>("get_table_indexes", {
        connectionId: tab.connectionId,
        database: tab.selectedDatabase,
        table: tab.selectedTable,
      });

      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === tabId ? { ...t, tableIndexes: indexes, loadingTableIndexes: false } : t
        ),
      }));
    } catch (error) {
      console.error("Failed to fetch table indexes:", error);
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === tabId ? { ...t, tableIndexes: null, loadingTableIndexes: false } : t
        ),
      }));
    }
  },

  fetchCreateTable: async (tabId: string) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || !tab.selectedDatabase || !tab.selectedTable) return;

    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId ? { ...t, loadingCreateTable: true } : t
      ),
    }));

    try {
      const sql = await invoke<string>("get_create_table", {
        connectionId: tab.connectionId,
        database: tab.selectedDatabase,
        table: tab.selectedTable,
      });

      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === tabId ? { ...t, createTableSql: sql, loadingCreateTable: false } : t
        ),
      }));
    } catch (error) {
      console.error("Failed to fetch CREATE TABLE:", error);
      set((state) => ({
        tabs: state.tabs.map((t) =>
          t.id === tabId ? { ...t, createTableSql: null, loadingCreateTable: false } : t
        ),
      }));
    }
  },

  updateCellValue: async (
    tabId: string,
    columnIndex: number,
    newValue: string | null,
    originalRow: (string | number | boolean | null)[],
    columns: string[]
  ) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || !tab.connectionId || !tab.selectedDatabase || !tab.selectedTable) {
      return { success: false, error: "Invalid tab state" };
    }

    // Helper function to escape string values for SQL
    const escapeString = (str: string): string => {
      return str.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    };

    // Helper function to format value for SQL
    const formatValue = (val: string | number | boolean | null): string => {
      if (val === null) return "NULL";
      if (typeof val === "boolean") return val ? "1" : "0";
      if (typeof val === "number") return String(val);
      return `'${escapeString(String(val))}'`;
    };

    // Find primary key columns from tableStructure
    let pkColumns: string[] = [];
    if (tab.tableStructure) {
      pkColumns = tab.tableStructure
        .filter(col => col.key === 'PRI')
        .map(col => col.field);
    }

    // Build WHERE clause - use PK columns if available, otherwise use all columns
    let whereConditions: string;
    if (pkColumns.length > 0) {
      // Use only primary key columns for WHERE
      whereConditions = pkColumns.map(pkCol => {
        const colIndex = columns.indexOf(pkCol);
        if (colIndex === -1) return null;
        const val = originalRow[colIndex];
        if (val === null) {
          return `\`${pkCol}\` IS NULL`;
        }
        return `\`${pkCol}\` = ${formatValue(val)}`;
      }).filter(Boolean).join(" AND ");
    } else {
      // Fallback: use all columns (may have issues with date/time types)
      whereConditions = columns.map((col, i) => {
        const val = originalRow[i];
        if (val === null) {
          return `\`${col}\` IS NULL`;
        }
        return `\`${col}\` = ${formatValue(val)}`;
      }).join(" AND ");
    }

    if (!whereConditions) {
      return { success: false, error: "Cannot build WHERE clause" };
    }

    // Build SET clause
    const columnName = columns[columnIndex];
    const setValue = newValue === null ? "NULL" : `'${escapeString(newValue)}'`;

    const sql = `UPDATE \`${tab.selectedDatabase}\`.\`${tab.selectedTable}\` SET \`${columnName}\` = ${setValue} WHERE ${whereConditions} LIMIT 1`;

    try {
      await invoke<QueryResult>("execute_query", {
        connectionId: tab.connectionId,
        query: sql,
      });

      // Refresh table content after successful update
      await get().fetchTableContent(tabId);
      return { success: true };
    } catch (error) {
      console.error("Update failed:", error);
      return { success: false, error: String(error) };
    }
  },

  insertRow: async (
    tabId: string,
    values: (string | null)[],
    columns: string[]
  ) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || !tab.connectionId || !tab.selectedDatabase || !tab.selectedTable) {
      return { success: false, error: "Invalid tab state" };
    }

    // Helper function to escape string values for SQL
    const escapeString = (str: string): string => {
      return str.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    };

    // Build column and value lists - include all columns, use NULL explicitly for empty values
    const colList = columns.map(col => `\`${col}\``).join(", ");
    const valList = values.map(val => {
      if (val === null || val === "") {
        return "NULL";
      }
      return `'${escapeString(val)}'`;
    }).join(", ");

    // Build INSERT query with all columns
    const sql = `INSERT INTO \`${tab.selectedDatabase}\`.\`${tab.selectedTable}\` (${colList}) VALUES (${valList})`;

    try {
      await invoke<QueryResult>("execute_query", {
        connectionId: tab.connectionId,
        query: sql,
      });

      // Refresh table content after successful insert
      await get().fetchTableContent(tabId);
      return { success: true };
    } catch (error) {
      console.error("Insert failed:", error);
      return { success: false, error: String(error) };
    }
  },

  buildDeleteQuery: (
    tabId: string,
    rowData: (string | number | boolean | null)[],
    columns: string[]
  ) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || !tab.selectedDatabase || !tab.selectedTable) {
      return null;
    }

    // Helper function to escape string values for SQL
    const escapeString = (str: string): string => {
      return str.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    };

    // Helper function to format value for SQL
    const formatValue = (val: string | number | boolean | null): string => {
      if (val === null) return "NULL";
      if (typeof val === "boolean") return val ? "1" : "0";
      if (typeof val === "number") return String(val);
      return `'${escapeString(String(val))}'`;
    };

    // Find primary key columns from tableStructure
    let pkColumns: string[] = [];
    if (tab.tableStructure) {
      pkColumns = tab.tableStructure
        .filter(col => col.key === 'PRI')
        .map(col => col.field);
    }

    // Build WHERE clause - use PK columns if available, otherwise use all columns
    let whereConditions: string;
    if (pkColumns.length > 0) {
      whereConditions = pkColumns.map(pkCol => {
        const colIndex = columns.indexOf(pkCol);
        if (colIndex === -1) return null;
        const val = rowData[colIndex];
        if (val === null) {
          return `\`${pkCol}\` IS NULL`;
        }
        return `\`${pkCol}\` = ${formatValue(val)}`;
      }).filter(Boolean).join(" AND ");
    } else {
      whereConditions = columns.map((col, i) => {
        const val = rowData[i];
        if (val === null) {
          return `\`${col}\` IS NULL`;
        }
        return `\`${col}\` = ${formatValue(val)}`;
      }).join(" AND ");
    }

    if (!whereConditions) {
      return null;
    }

    return `DELETE FROM \`${tab.selectedDatabase}\`.\`${tab.selectedTable}\` WHERE ${whereConditions} LIMIT 1`;
  },

  deleteRow: async (
    tabId: string,
    rowData: (string | number | boolean | null)[],
    columns: string[]
  ) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || !tab.connectionId || !tab.selectedDatabase || !tab.selectedTable) {
      return { success: false, error: "Invalid tab state" };
    }

    const sql = get().buildDeleteQuery(tabId, rowData, columns);
    if (!sql) {
      return { success: false, error: "Cannot build DELETE query" };
    }

    try {
      await invoke<QueryResult>("execute_query", {
        connectionId: tab.connectionId,
        query: sql,
      });

      // Refresh table content after successful delete
      await get().fetchTableContent(tabId);
      return { success: true };
    } catch (error) {
      console.error("Delete failed:", error);
      return { success: false, error: String(error) };
    }
  },

  updateQueryResultCellValue: async (
    tabId: string,
    rowIndex: number,
    columnIndex: number,
    newValue: string | null,
    originalRow: (string | number | boolean | null)[]
  ) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || !tab.connectionId || !tab.selectedDatabase || !tab.results) {
      return { success: false, error: "Invalid tab state" };
    }

    const results = tab.results;

    // Get original table and column names from metadata
    const orgTable = results.column_tables[columnIndex];
    const orgColumn = results.column_org_names[columnIndex];

    // Check if this column is editable (has original table info)
    if (!orgTable || orgTable === "") {
      return { success: false, error: "This column is a computed value and cannot be edited" };
    }

    // Helper function to escape string values for SQL
    const escapeString = (str: string): string => {
      return str.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    };

    // Helper function to format value for SQL
    const formatValue = (val: string | number | boolean | null): string => {
      if (val === null) return "NULL";
      if (typeof val === "boolean") return val ? "1" : "0";
      if (typeof val === "number") return String(val);
      return `'${escapeString(String(val))}'`;
    };

    try {
      // First, get the primary key columns for this table
      const pkResult: QueryResult = await invoke("execute_query", {
        connectionId: tab.connectionId,
        database: tab.selectedDatabase,
        query: `SHOW KEYS FROM \`${orgTable}\` WHERE Key_name = 'PRIMARY'`,
      });

      if (!pkResult.rows || pkResult.rows.length === 0) {
        return { success: false, error: "Cannot edit: table has no primary key" };
      }

      // Get PK column names (Column_name is typically at index 4)
      const columnNameIndex = pkResult.columns.indexOf("Column_name");
      const pkColumns = pkResult.rows.map(row => String(row[columnNameIndex]));

      // Build WHERE clause using PK values from original row
      const whereConditions = pkColumns.map(pkCol => {
        // Find this PK column in our result set
        const pkColIndex = results.column_org_names.findIndex(
          (col, idx) => col === pkCol && results.column_tables[idx] === orgTable
        );
        if (pkColIndex === -1) {
          return null;
        }
        const val = originalRow[pkColIndex];
        if (val === null) {
          return `\`${pkCol}\` IS NULL`;
        }
        return `\`${pkCol}\` = ${formatValue(val)}`;
      }).filter(Boolean);

      if (whereConditions.length !== pkColumns.length) {
        return { success: false, error: "Cannot edit: primary key columns not found in result set" };
      }

      // Build UPDATE query
      const updateQuery = `UPDATE \`${tab.selectedDatabase}\`.\`${orgTable}\` SET \`${orgColumn}\` = ${formatValue(newValue)} WHERE ${whereConditions.join(" AND ")} LIMIT 1`;

      // Execute update
      await invoke("execute_query", {
        connectionId: tab.connectionId,
        database: tab.selectedDatabase,
        query: updateQuery,
      });

      // Update local state - update the specific cell in the results
      set((state) => ({
        tabs: state.tabs.map((t) => {
          if (t.id !== tabId || !t.results) return t;
          const newRows = [...t.results.rows];
          newRows[rowIndex] = [...newRows[rowIndex]];
          newRows[rowIndex][columnIndex] = newValue;
          return {
            ...t,
            results: {
              ...t.results,
              rows: newRows,
            },
          };
        }),
      }));

      return { success: true };
    } catch (error) {
      console.error("Update query result cell failed:", error);
      return { success: false, error: String(error) };
    }
  },

  deleteQueryResultRows: async (
    tabId: string,
    rowsToDelete: (string | number | boolean | null)[][]
  ) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || !tab.connectionId || !tab.selectedDatabase || !tab.results) {
      return { success: false, error: "Invalid tab state" };
    }

    const results = tab.results;

    // Check if all rows are from the same table
    const uniqueTables = [...new Set(results.column_tables.filter(t => t && t.length > 0))];
    if (uniqueTables.length !== 1) {
      return { success: false, error: "Cannot delete rows from multiple tables or computed columns" };
    }

    const tableName = uniqueTables[0];

    // Helper function to escape string values for SQL
    const escapeString = (str: string): string => {
      return str.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    };

    // Helper function to format value for SQL
    const formatValue = (val: string | number | boolean | null): string => {
      if (val === null) return "NULL";
      if (typeof val === "boolean") return val ? "1" : "0";
      if (typeof val === "number") return String(val);
      return `'${escapeString(String(val))}'`;
    };

    try {
      // Get primary key columns for this table
      const pkResult: QueryResult = await invoke("execute_query", {
        connectionId: tab.connectionId,
        database: tab.selectedDatabase,
        query: `SHOW KEYS FROM \`${tableName}\` WHERE Key_name = 'PRIMARY'`,
      });

      if (!pkResult.rows || pkResult.rows.length === 0) {
        return { success: false, error: "Cannot delete: table has no primary key" };
      }

      // Get PK column names
      const columnNameIndex = pkResult.columns.indexOf("Column_name");
      const pkColumns = pkResult.rows.map(row => String(row[columnNameIndex]));

      // Find PK column indices in result set
      const pkColumnIndices = pkColumns.map(pkCol => {
        return results.column_org_names.findIndex(
          (col, idx) => col === pkCol && results.column_tables[idx] === tableName
        );
      });

      if (pkColumnIndices.some(idx => idx === -1)) {
        return { success: false, error: "Cannot delete: primary key columns not found in result set" };
      }

      // Delete each row
      let deletedCount = 0;
      const deletedRowIndices: number[] = [];

      for (const rowData of rowsToDelete) {
        // Build WHERE clause using PK values
        const whereConditions = pkColumns.map((pkCol, i) => {
          const val = rowData[pkColumnIndices[i]];
          if (val === null) {
            return `\`${pkCol}\` IS NULL`;
          }
          return `\`${pkCol}\` = ${formatValue(val)}`;
        });

        const deleteQuery = `DELETE FROM \`${tab.selectedDatabase}\`.\`${tableName}\` WHERE ${whereConditions.join(" AND ")} LIMIT 1`;

        try {
          await invoke("execute_query", {
            connectionId: tab.connectionId,
            database: tab.selectedDatabase,
            query: deleteQuery,
          });
          deletedCount++;

          // Find the index of this row in results.rows
          const rowIndex = results.rows.findIndex(row =>
            pkColumnIndices.every((pkIdx) => row[pkIdx] === rowData[pkIdx])
          );
          if (rowIndex !== -1) {
            deletedRowIndices.push(rowIndex);
          }
        } catch (rowError) {
          console.error("Failed to delete row:", rowError);
        }
      }

      // Update local state - remove deleted rows from results
      if (deletedRowIndices.length > 0) {
        set((state) => ({
          tabs: state.tabs.map((t) => {
            if (t.id !== tabId || !t.results) return t;
            const newRows = t.results.rows.filter((_, idx) => !deletedRowIndices.includes(idx));
            return {
              ...t,
              results: {
                ...t.results,
                rows: newRows,
              },
            };
          }),
        }));
      }

      if (deletedCount === 0) {
        return { success: false, error: "No rows were deleted" };
      }

      return { success: true };
    } catch (error) {
      console.error("Delete query result rows failed:", error);
      return { success: false, error: String(error) };
    }
  },

  getActiveTab: () => {
    const { tabs, activeTabId } = get();
    return tabs.find((t) => t.id === activeTabId);
  },

  clearTab: (tabId: string) => {
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tabId
          ? {
              ...t,
              query: "",
              results: null,
              selectedDatabase: null,
              databases: [],
              tables: [],
              selectedTable: null,
              tableViewMode: 'content' as TableViewMode,
              tableContent: null,
              tableStructure: null,
              tableInfo: null,
              tableIndexes: null,
              createTableSql: null,
              loadingTableContent: false,
              loadingTableStructure: false,
              loadingTableInfo: false,
              loadingTableIndexes: false,
              loadingCreateTable: false,
              totalRows: 0,
              tableContentSort: null,
              lastQuery: null,
            }
          : t
      ),
    }));
  },
}));
