import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useConnectionStore, Connection } from "../../stores/connectionStore";
import { useTabStore } from "../../stores/tabStore";
import { invoke } from "@tauri-apps/api/core";
import { ConnectionModal, ConnectionFormData } from "./ConnectionModal";
import { DatabaseIcon, EditIcon, TrashIcon, PlusIcon } from "../common/Icons";
import { Modal } from "../common/Modal";

interface WelcomeScreenProps {
  onNewConnection: () => void;
}

export function WelcomeScreen({ onNewConnection }: WelcomeScreenProps) {
  const { t } = useTranslation();
  const { connections, connectDatabase, removeConnection, updateConnection } = useConnectionStore();
  const { addTab } = useTabStore();
  const [connecting, setConnecting] = useState<string | null>(null);
  const [editingConnection, setEditingConnection] = useState<Connection | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);

  const handleConnect = async (connection: Connection) => {
    setConnecting(connection.id);
    try {
      const result = await connectDatabase(connection.id);
      if (result.success) {
        addTab(connection.id, connection.name);
        const databases = await invoke<string[]>("get_databases", { connectionId: connection.id });
        useTabStore.setState((state) => ({
          tabs: state.tabs.map((tab) =>
            tab.id === connection.id ? { ...tab, databases } : tab
          ),
        }));
      } else {
        alert(`${t("connection.failed")}: ${result.message}`);
      }
    } catch (error) {
      alert(`${t("connection.failed")}: ${error}`);
    } finally {
      setConnecting(null);
    }
  };

  const handleEdit = (e: React.MouseEvent, connection: Connection) => {
    e.stopPropagation();
    setEditingConnection(connection);
  };

  const handleSaveEdit = async (data: ConnectionFormData) => {
    if (!editingConnection) return;
    await updateConnection(editingConnection.id, {
      name: data.name,
      host: data.host,
      port: data.port,
      user: data.user,
      password: data.password,
      database: data.database || undefined,
    });
    setEditingConnection(null);
  };

  const handleDeleteClick = (e: React.MouseEvent, connectionId: string) => {
    e.stopPropagation();
    setShowDeleteConfirm(connectionId);
  };

  const handleConfirmDelete = async () => {
    if (showDeleteConfirm) {
      await removeConnection(showDeleteConfirm);
      setShowDeleteConfirm(null);
    }
  };

  return (
    <div className="flex-1 flex bg-gray-900">
      {/* Left Sidebar - Connection List */}
      <div className="w-64 bg-gray-800 border-r border-gray-700 flex flex-col">
        <div className="px-3 py-3 border-b border-gray-700 flex items-center justify-between">
          <span className="text-xs text-gray-500 uppercase tracking-wider">
            {t("welcome.savedConnections")}
          </span>
          <button
            onClick={onNewConnection}
            className="p-1 hover:bg-gray-700 rounded transition"
            title={t("connection.new")}
          >
            <PlusIcon className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-2">
          {connections.length > 0 ? (
            <div className="space-y-1">
              {connections.map((conn) => (
                <div
                  key={conn.id}
                  onClick={() => handleConnect(conn)}
                  className="flex items-center justify-between p-2 hover:bg-gray-700 rounded cursor-pointer transition group"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-6 h-6 bg-blue-600/20 rounded flex-shrink-0 flex items-center justify-center">
                      <DatabaseIcon className="w-3 h-3 text-blue-400" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{conn.name}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {connecting === conn.id ? (
                      <span className="text-xs text-gray-400">...</span>
                    ) : (
                      <>
                        <button
                          onClick={(e) => handleEdit(e, conn)}
                          className="p-1 text-gray-500 hover:text-blue-400 opacity-0 group-hover:opacity-100 transition"
                          title={t("common.edit")}
                        >
                          <EditIcon className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => handleDeleteClick(e, conn.id)}
                          className="p-1 text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition"
                          title={t("common.delete")}
                        >
                          <TrashIcon className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center text-gray-500 text-sm py-8">
              {t("welcome.noConnections")}
            </div>
          )}
        </div>
      </div>

      {/* Main Content - Welcome Message */}
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center max-w-md px-4">
          <img
            src="/app-icon.png"
            alt="PromptSQL"
            className="w-24 h-24 mx-auto mb-6"
          />
          <h2 className="text-2xl font-bold mb-2">{t("welcome.title")}</h2>
          <p className="text-gray-400 mb-8 whitespace-pre-line">
            {t("welcome.description")}
          </p>
          <button
            onClick={onNewConnection}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg text-lg font-medium transition"
          >
            + {t("connection.new")}
          </button>
        </div>
      </div>

      {/* Edit Connection Modal */}
      <ConnectionModal
        isOpen={!!editingConnection}
        onClose={() => setEditingConnection(null)}
        onSave={handleSaveEdit}
        initialData={editingConnection ? {
          name: editingConnection.name,
          host: editingConnection.host,
          port: editingConnection.port,
          user: editingConnection.user,
          // 비밀번호는 프론트로 반환되지 않는다 — 빈칸 = 변경 안 함
          password: "",
          database: editingConnection.database || "",
        } : null}
        mode="edit"
      />

      {/* Delete Confirmation Dialog */}
      {showDeleteConfirm && (
        <Modal isOpen onClose={() => setShowDeleteConfirm(null)} size="sm">
          <div className="p-6">
            <h3 className="text-lg font-bold mb-4">{t("connection.confirmDeleteTitle")}</h3>
            <p className="text-gray-400 mb-6">{t("connection.confirmDelete")}</p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteConfirm(null)}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm transition"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={handleConfirmDelete}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded text-sm transition"
              >
                {t("common.delete")}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
