import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useConnectionStore, Connection } from "../../stores/connectionStore";
import { DatabaseIcon, PencilIcon, TrashIcon, PlusIcon } from "../common/Icons";

interface NewTabViewProps {
  tabId: string;
  onConnect: (connection: Connection) => void;
  onEditConnection: (connection: Connection) => void;
  onDeleteConnection: (connectionId: string) => void;
  onNewConnection: () => void;
}

export function NewTabView({
  onConnect,
  onEditConnection,
  onDeleteConnection,
  onNewConnection,
}: NewTabViewProps) {
  const { t } = useTranslation();
  const { connections } = useConnectionStore();
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const handleDeleteClick = (e: React.MouseEvent, connectionId: string) => {
    e.stopPropagation();
    setDeleteConfirmId(connectionId);
  };

  const handleConfirmDelete = (connectionId: string) => {
    onDeleteConnection(connectionId);
    setDeleteConfirmId(null);
  };

  return (
    <div className="flex-1 flex items-center justify-center bg-gray-900">
      <div className="max-w-lg w-full p-6">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 mx-auto mb-4 bg-blue-600/20 rounded-full flex items-center justify-center">
            <DatabaseIcon className="w-8 h-8 text-blue-400" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">
            {t("newTab.title")}
          </h1>
          <p className="text-gray-400">{t("newTab.description")}</p>
        </div>

        {/* Connection List */}
        <div className="space-y-2 mb-6 max-h-64 overflow-y-auto">
          {connections.length === 0 ? (
            <p className="text-gray-500 text-center py-8">
              {t("newTab.noConnections")}
            </p>
          ) : (
            connections.map((conn) => (
              <div key={conn.id}>
                {deleteConfirmId === conn.id ? (
                  // Delete confirmation
                  <div className="flex items-center bg-red-900/30 border border-red-700 rounded-lg p-3">
                    <p className="flex-1 text-red-300 text-sm">
                      {t("connection.confirmDelete")}
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setDeleteConfirmId(null)}
                        className="px-3 py-1 text-sm bg-gray-700 hover:bg-gray-600 text-white rounded transition"
                      >
                        {t("common.cancel")}
                      </button>
                      <button
                        onClick={() => handleConfirmDelete(conn.id)}
                        className="px-3 py-1 text-sm bg-red-600 hover:bg-red-700 text-white rounded transition"
                      >
                        {t("common.delete")}
                      </button>
                    </div>
                  </div>
                ) : (
                  // Normal connection item
                  <div className="flex items-center bg-gray-800 rounded-lg p-3 hover:bg-gray-750 transition group">
                    {/* Connection Info - Click to connect */}
                    <button
                      onClick={() => onConnect(conn)}
                      className="flex-1 flex items-center gap-3 text-left"
                    >
                      <div className="w-10 h-10 bg-blue-600/20 rounded-lg flex items-center justify-center flex-shrink-0">
                        <DatabaseIcon className="w-5 h-5 text-blue-400" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-white font-medium truncate">
                          {conn.name}
                        </div>
                      </div>
                    </button>

                    {/* Edit/Delete Buttons */}
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditConnection(conn);
                        }}
                        className="p-2 hover:bg-gray-600 rounded transition"
                        title={t("common.edit")}
                      >
                        <PencilIcon className="w-4 h-4 text-gray-400" />
                      </button>
                      <button
                        onClick={(e) => handleDeleteClick(e, conn.id)}
                        className="p-2 hover:bg-red-600/50 rounded transition"
                        title={t("common.delete")}
                      >
                        <TrashIcon className="w-4 h-4 text-gray-400" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* New Connection Button */}
        <button
          onClick={onNewConnection}
          className="w-full flex items-center justify-center gap-2 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition font-medium"
        >
          <PlusIcon className="w-5 h-5" />
          {t("newTab.addConnection")}
        </button>
      </div>
    </div>
  );
}
