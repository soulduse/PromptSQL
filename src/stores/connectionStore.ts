import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export interface Connection {
  id: string;
  name: string;
  host: string;
  port: number;
  user: string;
  password: string;
  database?: string;
  last_used_database?: string;
  isConnected: boolean;
}

interface ConnectionResult {
  success: boolean;
  message: string;
  connection_id: string | null;
}

interface ConnectionState {
  connections: Connection[];
  // Actions
  loadSavedConnections: () => Promise<void>;
  addConnection: (connection: Omit<Connection, "id" | "isConnected">) => Promise<Connection>;
  updateConnection: (id: string, connection: Omit<Connection, "id" | "isConnected">) => Promise<void>;
  removeConnection: (id: string) => Promise<void>;
  setConnected: (id: string, isConnected: boolean) => void;
  connectDatabase: (id: string) => Promise<ConnectionResult>;
  disconnectDatabase: (id: string) => Promise<boolean>;
  getConnection: (id: string) => Connection | undefined;
}

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  connections: [],

  loadSavedConnections: async (): Promise<void> => {
    try {
      const savedConnections = await invoke<Connection[]>("load_saved_connections");
      const connections = savedConnections.map((c: Connection) => ({
        ...c,
        isConnected: false,
      }));
      set({ connections });
    } catch (error) {
      console.error("Failed to load saved connections:", error);
    }
  },

  addConnection: async (connection: Omit<Connection, "id" | "isConnected">): Promise<Connection> => {
    const newConnection: Connection = {
      ...connection,
      id: crypto.randomUUID(),
      isConnected: false,
    };

    try {
      await invoke("save_connection", { connection: newConnection });
    } catch (error) {
      console.error("Failed to save connection:", error);
    }

    set((state: ConnectionState) => ({
      connections: [...state.connections, newConnection],
    }));

    return newConnection;
  },

  updateConnection: async (id: string, connection: Omit<Connection, "id" | "isConnected">): Promise<void> => {
    const existingConnection = get().connections.find((c) => c.id === id);
    if (!existingConnection) return;

    const updatedConnection: Connection = {
      ...connection,
      id,
      isConnected: existingConnection.isConnected,
    };

    try {
      await invoke("save_connection", { connection: updatedConnection });
    } catch (error) {
      console.error("Failed to update connection:", error);
      throw error;
    }

    set((state: ConnectionState) => ({
      connections: state.connections.map((c: Connection) =>
        c.id === id ? updatedConnection : c
      ),
    }));
  },

  removeConnection: async (id: string): Promise<void> => {
    try {
      await invoke("delete_saved_connection", { connectionId: id });
    } catch (error) {
      console.error("Failed to delete saved connection:", error);
    }

    set((state: ConnectionState) => ({
      connections: state.connections.filter((c: Connection) => c.id !== id),
    }));
  },

  setConnected: (id: string, isConnected: boolean) =>
    set((state: ConnectionState) => ({
      connections: state.connections.map((c: Connection) =>
        c.id === id ? { ...c, isConnected } : c
      ),
    })),

  connectDatabase: async (id: string): Promise<ConnectionResult> => {
    const { connections } = get();
    const connection = connections.find((c: Connection) => c.id === id);
    if (!connection) {
      return { success: false, message: "Connection not found", connection_id: null };
    }

    try {
      const result = await invoke<ConnectionResult>("connect_database", {
        id,
        config: {
          host: connection.host,
          port: connection.port,
          user: connection.user,
          password: connection.password,
          database: connection.database || null,
        },
      });

      if (result.success) {
        set((state: ConnectionState) => ({
          connections: state.connections.map((c: Connection) =>
            c.id === id ? { ...c, isConnected: true } : c
          ),
        }));
      }

      return result;
    } catch (error) {
      return { success: false, message: String(error), connection_id: null };
    }
  },

  disconnectDatabase: async (id: string): Promise<boolean> => {
    try {
      const result = await invoke<boolean>("disconnect_database", { id });
      if (result) {
        set((state: ConnectionState) => ({
          connections: state.connections.map((c: Connection) =>
            c.id === id ? { ...c, isConnected: false } : c
          ),
        }));
      }
      return result;
    } catch (error) {
      console.error("Failed to disconnect:", error);
      return false;
    }
  },

  getConnection: (id: string): Connection | undefined => {
    return get().connections.find((c) => c.id === id);
  },
}));
