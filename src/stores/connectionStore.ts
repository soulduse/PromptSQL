import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

// 비밀번호는 백엔드 Keychain 전용 — 프론트엔드 상태에 저장하지 않는다
export interface Connection {
  id: string;
  name: string;
  host: string;
  port: number;
  user: string;
  database?: string;
  last_used_database?: string;
  isConnected: boolean;
}

/** 생성/수정 폼 입력 — 비밀번호는 저장 시에만 백엔드로 전달 */
export type ConnectionInput = Omit<Connection, "id" | "isConnected"> & {
  password: string;
};

interface ConnectionResult {
  success: boolean;
  message: string;
  connection_id: string | null;
}

interface ConnectionState {
  connections: Connection[];
  // Actions
  loadSavedConnections: () => Promise<void>;
  addConnection: (connection: ConnectionInput) => Promise<Connection>;
  updateConnection: (id: string, connection: ConnectionInput) => Promise<void>;
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

  addConnection: async (connection: ConnectionInput): Promise<Connection> => {
    const id = crypto.randomUUID();
    const { password, ...metadata } = connection;
    const newConnection: Connection = {
      ...metadata,
      id,
      isConnected: false,
    };

    try {
      // 비밀번호는 저장 요청에만 실려가고 상태에는 남기지 않는다
      await invoke("save_connection", {
        connection: { ...metadata, id, password },
      });
    } catch (error) {
      console.error("Failed to save connection:", error);
    }

    set((state: ConnectionState) => ({
      connections: [...state.connections, newConnection],
    }));

    return newConnection;
  },

  updateConnection: async (id: string, connection: ConnectionInput): Promise<void> => {
    const existingConnection = get().connections.find((c) => c.id === id);
    if (!existingConnection) return;

    const { password, ...metadata } = connection;
    const updatedConnection: Connection = {
      ...metadata,
      id,
      isConnected: existingConnection.isConnected,
    };

    try {
      // 빈 비밀번호는 백엔드가 "변경 안 함"으로 처리 (기존 Keychain 유지)
      await invoke("save_connection", {
        connection: { ...metadata, id, password },
      });
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
      // 백엔드가 Keychain에서 비밀번호를 직접 읽는다
      const result = await invoke<ConnectionResult>("connect_saved_database", { id });

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
