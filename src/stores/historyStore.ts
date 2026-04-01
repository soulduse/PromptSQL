import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export interface QueryHistory {
  id: string;
  query: string;
  connection_id: string;
  database: string | null;
  timestamp: number; // Unix timestamp in milliseconds
  execution_time_ms: number;
  row_count: number;
  status: "success" | "error";
  error_message: string | null;
  note: string | null;
  group_id: string | null;
}

export interface HistoryGroup {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  created_at: number;
  updated_at: number;
}

interface HistoryState {
  history: QueryHistory[];
  groups: HistoryGroup[];
  searchResults: QueryHistory[];
  isSearching: boolean;
  isLoading: boolean;

  // History actions
  loadHistory: () => Promise<void>;
  addHistory: (entry: Omit<QueryHistory, "id">) => Promise<QueryHistory | null>;
  deleteHistory: (id: string) => Promise<void>;
  updateHistory: (id: string, note?: string, groupId?: string | null) => Promise<void>;
  searchHistory: (query: string) => Promise<void>;
  clearSearchResults: () => void;

  // Group actions
  loadGroups: () => Promise<void>;
  createGroup: (name: string, description?: string) => Promise<HistoryGroup | null>;
  updateGroup: (id: string, name?: string, description?: string | null) => Promise<void>;
  deleteGroup: (id: string) => Promise<void>;

  // Helpers
  getGroupById: (id: string) => HistoryGroup | undefined;
  getHistoryByGroup: (groupId: string) => QueryHistory[];
  getRecentHistory: (limit?: number) => QueryHistory[];

  // Save query to group (without execution)
  saveQueryToGroup: (query: string, groupId: string, connectionId: string, database: string | null) => Promise<QueryHistory | null>;
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  history: [],
  groups: [],
  searchResults: [],
  isSearching: false,
  isLoading: false,

  // ============ History Actions ============

  loadHistory: async () => {
    set({ isLoading: true });
    try {
      const history = await invoke<QueryHistory[]>("get_query_history");
      set({ history, isLoading: false });
    } catch (error) {
      console.error("Failed to load history:", error);
      set({ history: [], isLoading: false });
    }
  },

  addHistory: async (entry: Omit<QueryHistory, "id">) => {
    try {
      const newEntry = await invoke<QueryHistory>("add_query_history", {
        history: {
          ...entry,
          id: "", // Backend will generate ID
        },
      });

      set((state) => ({
        history: [newEntry, ...state.history],
      }));

      return newEntry;
    } catch (error) {
      console.error("Failed to add history:", error);
      return null;
    }
  },

  deleteHistory: async (id: string) => {
    try {
      await invoke("delete_query_history", { id });
      set((state) => ({
        history: state.history.filter((h) => h.id !== id),
        searchResults: state.searchResults.filter((h) => h.id !== id),
      }));
    } catch (error) {
      console.error("Failed to delete history:", error);
    }
  },

  updateHistory: async (id: string, note?: string, groupId?: string | null) => {
    try {
      await invoke("update_query_history", {
        id,
        note: note ?? null,
        groupId: groupId !== undefined ? groupId : null,
      });

      set((state) => ({
        history: state.history.map((h) =>
          h.id === id
            ? {
                ...h,
                note: note !== undefined ? note : h.note,
                group_id: groupId !== undefined ? groupId : h.group_id,
              }
            : h
        ),
        searchResults: state.searchResults.map((h) =>
          h.id === id
            ? {
                ...h,
                note: note !== undefined ? note : h.note,
                group_id: groupId !== undefined ? groupId : h.group_id,
              }
            : h
        ),
      }));
    } catch (error) {
      console.error("Failed to update history:", error);
    }
  },

  searchHistory: async (query: string) => {
    if (!query.trim()) {
      set({ searchResults: [], isSearching: false });
      return;
    }

    set({ isSearching: true });
    try {
      const results = await invoke<QueryHistory[]>("search_query_history", { query });
      set({ searchResults: results, isSearching: false });
    } catch (error) {
      console.error("Failed to search history:", error);
      set({ searchResults: [], isSearching: false });
    }
  },

  clearSearchResults: () => {
    set({ searchResults: [], isSearching: false });
  },

  // ============ Group Actions ============

  loadGroups: async () => {
    try {
      const groups = await invoke<HistoryGroup[]>("get_history_groups");
      set({ groups });
    } catch (error) {
      console.error("Failed to load groups:", error);
      set({ groups: [] });
    }
  },

  createGroup: async (name: string, description?: string) => {
    try {
      const newGroup = await invoke<HistoryGroup>("create_history_group", {
        name,
        description: description ?? null,
      });

      set((state) => ({
        groups: [...state.groups, newGroup],
      }));

      return newGroup;
    } catch (error) {
      console.error("Failed to create group:", error);
      return null;
    }
  },

  updateGroup: async (id: string, name?: string, description?: string | null) => {
    try {
      await invoke("update_history_group", {
        id,
        name: name ?? null,
        description: description !== undefined ? description : null,
      });

      set((state) => ({
        groups: state.groups.map((g) =>
          g.id === id
            ? {
                ...g,
                name: name !== undefined ? name : g.name,
                description: description !== undefined ? description : g.description,
                updated_at: Date.now(),
              }
            : g
        ),
      }));
    } catch (error) {
      console.error("Failed to update group:", error);
    }
  },

  deleteGroup: async (id: string) => {
    try {
      await invoke("delete_history_group", { id });

      set((state) => ({
        groups: state.groups.filter((g) => g.id !== id),
        // Clear group_id from history entries that belonged to this group
        history: state.history.map((h) =>
          h.group_id === id ? { ...h, group_id: null } : h
        ),
        searchResults: state.searchResults.map((h) =>
          h.group_id === id ? { ...h, group_id: null } : h
        ),
      }));
    } catch (error) {
      console.error("Failed to delete group:", error);
    }
  },

  // ============ Helpers ============

  getGroupById: (id: string) => {
    return get().groups.find((g) => g.id === id);
  },

  getHistoryByGroup: (groupId: string) => {
    return get().history.filter((h) => h.group_id === groupId);
  },

  getRecentHistory: (limit = 50) => {
    return get().history.slice(0, limit);
  },

  saveQueryToGroup: async (query: string, groupId: string, connectionId: string, database: string | null) => {
    return get().addHistory({
      query,
      connection_id: connectionId,
      database,
      timestamp: Date.now(),
      execution_time_ms: 0,
      row_count: 0,
      status: "success",
      error_message: null,
      note: null,
      group_id: groupId,
    });
  },
}));
