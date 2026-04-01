import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";

interface AddDatabaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  connectionId: string;
  onSuccess: () => void;
}

// Encoding options with their default collations
const ENCODING_OPTIONS = [
  { value: "", label: "serverDefault", defaultCollation: "" },
  { value: "utf8mb4", label: "utf8mb4", defaultCollation: "utf8mb4_0900_ai_ci" },
  { value: "utf8mb3", label: "utf8mb3", defaultCollation: "utf8mb3_general_ci" },
  { value: "utf8", label: "utf8", defaultCollation: "utf8_general_ci" },
  { value: "latin1", label: "latin1", defaultCollation: "latin1_swedish_ci" },
  { value: "ascii", label: "ascii", defaultCollation: "ascii_general_ci" },
];

// Collation options per encoding
const COLLATION_OPTIONS: Record<string, string[]> = {
  "": [], // Server default
  utf8mb4: [
    "utf8mb4_0900_ai_ci",
    "utf8mb4_0900_as_ci",
    "utf8mb4_0900_as_cs",
    "utf8mb4_unicode_ci",
    "utf8mb4_general_ci",
    "utf8mb4_bin",
  ],
  utf8mb3: [
    "utf8mb3_general_ci",
    "utf8mb3_unicode_ci",
    "utf8mb3_bin",
  ],
  utf8: [
    "utf8_general_ci",
    "utf8_unicode_ci",
    "utf8_bin",
  ],
  latin1: [
    "latin1_swedish_ci",
    "latin1_general_ci",
    "latin1_bin",
  ],
  ascii: [
    "ascii_general_ci",
    "ascii_bin",
  ],
};

export function AddDatabaseModal({
  isOpen,
  onClose,
  connectionId,
  onSuccess,
}: AddDatabaseModalProps) {
  const { t } = useTranslation();
  const [databaseName, setDatabaseName] = useState("");
  const [encoding, setEncoding] = useState("");
  const [collation, setCollation] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setDatabaseName("");
      setEncoding("");
      setCollation("");
      setError(null);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  useEffect(() => {
    // Reset collation when encoding changes
    const encodingOption = ENCODING_OPTIONS.find((e) => e.value === encoding);
    if (encodingOption) {
      setCollation(encodingOption.defaultCollation);
    }
  }, [encoding]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "Enter" && databaseName.trim() && !isLoading) {
      handleCreate();
    }
  };

  const handleCreate = async () => {
    if (!databaseName.trim()) return;

    setIsLoading(true);
    setError(null);

    try {
      // Build CREATE DATABASE query
      let query = `CREATE DATABASE \`${databaseName.trim()}\``;
      if (encoding) {
        query += ` CHARACTER SET ${encoding}`;
        if (collation) {
          query += ` COLLATE ${collation}`;
        }
      }

      await invoke("execute_query", {
        connectionId,
        database: null,
        query,
      });

      onSuccess();
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  const availableCollations = COLLATION_OPTIONS[encoding] || [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
      onKeyDown={handleKeyDown}
    >
      <div
        className="bg-gray-800 rounded-lg shadow-xl w-[400px] border border-gray-700"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-700">
          <h2 className="text-lg font-semibold text-white">
            {t("database.addDatabaseTitle")}
          </h2>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Database Name */}
          <div className="flex items-center gap-3">
            <label className="w-36 text-sm text-gray-300 text-right">
              {t("database.databaseName")}:
            </label>
            <input
              ref={inputRef}
              type="text"
              value={databaseName}
              onChange={(e) => setDatabaseName(e.target.value)}
              className="flex-1 px-3 py-1.5 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:outline-none focus:border-blue-500"
              placeholder=""
              disabled={isLoading}
            />
          </div>

          {/* Database Encoding */}
          <div className="flex items-center gap-3">
            <label className="w-36 text-sm text-gray-300 text-right">
              {t("database.encoding")}:
            </label>
            <select
              value={encoding}
              onChange={(e) => setEncoding(e.target.value)}
              className="flex-1 px-3 py-1.5 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:outline-none focus:border-blue-500"
              disabled={isLoading}
            >
              {ENCODING_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.value === ""
                    ? `${t("database.serverDefault")} (utf8mb4)`
                    : opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Database Collation */}
          <div className="flex items-center gap-3">
            <label className="w-36 text-sm text-gray-300 text-right">
              {t("database.collation")}:
            </label>
            <select
              value={collation}
              onChange={(e) => setCollation(e.target.value)}
              className="flex-1 px-3 py-1.5 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:outline-none focus:border-blue-500"
              disabled={isLoading || !encoding}
            >
              {encoding === "" ? (
                <option value="">
                  {t("database.serverDefault")} (utf8mb4_0900_ai_ci)
                </option>
              ) : (
                availableCollations.map((col) => (
                  <option key={col} value={col}>
                    {col}
                  </option>
                ))
              )}
            </select>
          </div>

          {/* Error */}
          {error && (
            <div className="text-sm text-red-400 bg-red-900/20 px-3 py-2 rounded">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-gray-700 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm text-gray-300 hover:text-white transition"
            disabled={isLoading}
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={handleCreate}
            disabled={!databaseName.trim() || isLoading}
            className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-500 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? t("common.saving") : t("common.add")}
          </button>
        </div>
      </div>
    </div>
  );
}
