import { invoke } from "@tauri-apps/api/core";

export async function greet(name: string): Promise<string> {
  return await invoke<string>("greet", { name });
}

// TODO: Implement these functions when backend is ready
// export async function connectDatabase(config: ConnectionConfig): Promise<string> {
//   return await invoke<string>("connect_database", config);
// }

// export async function executeQuery(connectionId: string, query: string): Promise<any[]> {
//   return await invoke<any[]>("execute_query", { connectionId, query });
// }

// export async function getSchema(connectionId: string): Promise<Schema> {
//   return await invoke<Schema>("get_schema", { connectionId });
// }
