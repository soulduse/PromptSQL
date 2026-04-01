import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";

interface RenameTableModalProps {
  isOpen: boolean;
  tableName: string;
  connectionId: string;
  database: string;
  onSuccess: () => void;
  onClose: () => void;
}

export function RenameTableModal({
  isOpen,
  tableName,
  connectionId,
  database,
  onSuccess,
  onClose,
}: RenameTableModalProps) {
  const { t } = useTranslation();
  const [newName, setNewName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setNewName(tableName);
      setError(null);
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 100);
    }
  }, [isOpen, tableName]);

  if (!isOpen) return null;

  const handleRename = async () => {
    if (!newName.trim() || newName === tableName) return;

    setIsLoading(true);
    setError(null);

    try {
      await invoke("execute_query", {
        connectionId,
        database,
        query: `RENAME TABLE \`${tableName}\` TO \`${newName.trim()}\``,
      });
      onSuccess();
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && newName.trim() && newName !== tableName) {
      handleRename();
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4" onKeyDown={handleKeyDown}>
        <div className="px-6 py-4 border-b border-gray-700">
          <h3 className="text-lg font-semibold text-white">{t("tableMenu.renameTitle")}</h3>
        </div>

        <div className="px-6 py-4 space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-2">
              {t("tableMenu.newTableName")}
            </label>
            <input
              ref={inputRef}
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded-md text-white text-sm focus:outline-none focus:border-blue-500"
            />
          </div>

          {error && (
            <div className="text-red-400 text-sm bg-red-400/10 px-3 py-2 rounded">
              {error}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-700 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-300 hover:text-white bg-gray-700 hover:bg-gray-600 rounded-md transition"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={handleRename}
            disabled={isLoading || !newName.trim() || newName === tableName}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-md transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? t("common.loading") : t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
