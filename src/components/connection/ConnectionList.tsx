import { Connection } from "../../stores/connectionStore";

interface ConnectionListProps {
  connections: Connection[];
  activeConnectionId: string | null;
  onSelect: (id: string) => void;
  onConnect: (id: string) => void;
  onDisconnect: (id: string) => void;
  onDelete: (id: string) => void;
}

export function ConnectionList({
  connections,
  activeConnectionId,
  onSelect,
  onConnect,
  onDisconnect,
  onDelete,
}: ConnectionListProps) {
  if (connections.length === 0) {
    return (
      <div className="text-gray-500 text-sm p-4 text-center">
        No connections yet.
        <br />
        Click "New Connection" to start.
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {connections.map((conn) => (
        <div
          key={conn.id}
          onClick={() => onSelect(conn.id)}
          className={`p-3 rounded cursor-pointer transition ${
            activeConnectionId === conn.id
              ? "bg-gray-700"
              : "hover:bg-gray-700/50"
          }`}
        >
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${
                conn.isConnected ? "bg-green-500" : "bg-gray-500"
              }`}
            />
            <span className="font-medium text-sm">{conn.name}</span>
          </div>

          {activeConnectionId === conn.id && (
            <div className="flex gap-2 mt-2 ml-4">
              {conn.isConnected ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDisconnect(conn.id);
                  }}
                  className="text-xs px-2 py-1 bg-red-600/20 text-red-400 hover:bg-red-600/30 rounded transition"
                >
                  Disconnect
                </button>
              ) : (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onConnect(conn.id);
                  }}
                  className="text-xs px-2 py-1 bg-green-600/20 text-green-400 hover:bg-green-600/30 rounded transition"
                >
                  Connect
                </button>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(conn.id);
                }}
                className="text-xs px-2 py-1 bg-gray-600/20 text-gray-400 hover:bg-gray-600/30 rounded transition"
              >
                Delete
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
