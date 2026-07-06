import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { Modal } from "../common/Modal";

interface DuplicateTableModalProps {
  isOpen: boolean;
  tableName: string;
  connectionId: string;
  database: string;
  onSuccess: () => void;
  onClose: () => void;
}

export function DuplicateTableModal({
  isOpen,
  tableName,
  connectionId,
  database,
  onSuccess,
  onClose,
}: DuplicateTableModalProps) {
  const { t } = useTranslation();
  const [newName, setNewName] = useState("");
  const [includeData, setIncludeData] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setNewName(`${tableName}_copy`);
      setIncludeData(true);
      setError(null);
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 100);
    }
  }, [isOpen, tableName]);

  if (!isOpen) return null;

  const handleDuplicate = async () => {
    if (!newName.trim()) return;

    setIsLoading(true);
    setError(null);

    try {
      // Create table structure
      await invoke("execute_query", {
        connectionId,
        database,
        query: `CREATE TABLE \`${newName.trim()}\` LIKE \`${tableName}\``,
      });

      // Copy data if requested
      if (includeData) {
        await invoke("execute_query", {
          connectionId,
          database,
          query: `INSERT INTO \`${newName.trim()}\` SELECT * FROM \`${tableName}\``,
        });
      }

      onSuccess();
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && newName.trim()) {
      handleDuplicate();
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md" closeOnBackdrop={false}>
      <div onKeyDown={handleKeyDown}>
        <div className="px-6 py-4 border-b border-gray-700">
          <h3 className="text-lg font-semibold text-white">{t("tableMenu.duplicateTitle")}</h3>
        </div>

        <div className="px-6 py-4 space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-2">
              {t("tableMenu.newTableNameDuplicate")}
            </label>
            <input
              ref={inputRef}
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded-md text-white text-sm focus:outline-none focus:border-blue-500"
            />
          </div>

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={includeData}
              onChange={(e) => setIncludeData(e.target.checked)}
              className="w-4 h-4 rounded border-gray-600 bg-gray-900 text-blue-600 focus:ring-blue-500 focus:ring-offset-gray-800"
            />
            <span className="text-sm text-gray-300">{t("tableMenu.includeData")}</span>
          </label>

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
            onClick={handleDuplicate}
            disabled={isLoading || !newName.trim()}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-md transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? t("common.loading") : t("tableMenu.duplicateTable")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
