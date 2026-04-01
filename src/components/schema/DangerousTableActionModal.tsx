import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { WarningIcon, CheckIcon, CopyIcon, StructureIcon, BoxIcon, FileJsonIcon, ServerIcon } from "../common/Icons";

interface TableSummary {
  rows: number;
  data_length: number;
  index_length: number;
  engine: string | null;
}

interface DangerousTableActionModalProps {
  isOpen: boolean;
  tableName: string;
  connectionId: string;
  database: string;
  action: "truncate" | "delete";
  onConfirm: () => void;
  onCancel: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KiB", "MiB", "GiB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function formatNumber(num: number): string {
  return num.toLocaleString();
}

export function DangerousTableActionModal({
  isOpen,
  tableName,
  connectionId,
  database,
  action,
  onConfirm,
  onCancel,
}: DangerousTableActionModalProps) {
  const { t } = useTranslation();
  const [confirmInput, setConfirmInput] = useState("");
  const [tableSummary, setTableSummary] = useState<TableSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const isMatching = confirmInput === tableName;

  useEffect(() => {
    if (isOpen && tableName) {
      setConfirmInput("");
      setCopied(false);
      fetchTableSummary();
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen, tableName]);

  const fetchTableSummary = async () => {
    setLoading(true);
    try {
      const result = await invoke<TableSummary>("get_table_summary", {
        connectionId,
        database,
        table: tableName,
      });
      setTableSummary(result);
    } catch (error) {
      console.error("Failed to fetch table summary:", error);
      setTableSummary(null);
    } finally {
      setLoading(false);
    }
  };

  const handleCopyTableName = async () => {
    await navigator.clipboard.writeText(tableName);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && isMatching) {
      onConfirm();
    } else if (e.key === "Escape") {
      onCancel();
    }
  };

  if (!isOpen) return null;

  const isTruncate = action === "truncate";
  const title = isTruncate ? t("dangerAction.truncateTitle") : t("dangerAction.deleteTitle");
  const description = isTruncate ? t("dangerAction.truncateDesc") : t("dangerAction.deleteDesc");
  const buttonLabel = isTruncate ? t("dangerAction.truncateButton") : t("dangerAction.deleteButton");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onCancel} />

      <div className="relative bg-gray-800 rounded-lg shadow-xl w-full max-w-lg mx-4 border border-red-500/30">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-700 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
            <WarningIcon className="w-5 h-5 text-red-500" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white">{title}</h3>
            <p className="text-sm text-gray-400">{description}</p>
          </div>
        </div>

        {/* Content */}
        <div className="px-6 py-4 space-y-4" onKeyDown={handleKeyDown}>
          {/* Table Name with Copy */}
          <div className="bg-gray-900 rounded-lg p-4 border border-gray-700">
            <div className="text-sm text-gray-400 mb-2">{t("dangerAction.targetTable")}</div>
            <div className="flex items-center justify-between">
              <span className="text-xl font-mono font-bold text-red-400">{tableName}</span>
              <button
                onClick={handleCopyTableName}
                className="p-2 rounded hover:bg-gray-700 transition group"
                title={t("common.copy")}
              >
                {copied ? (
                  <CheckIcon className="w-5 h-5 text-green-400" />
                ) : (
                  <CopyIcon className="w-5 h-5 text-gray-400 group-hover:text-white" />
                )}
              </button>
            </div>
          </div>

          {/* Table Summary */}
          <div className="bg-gray-900 rounded-lg p-4 border border-gray-700">
            <div className="text-sm text-gray-400 mb-3">{t("dangerAction.tableSummary")}</div>
            {loading ? (
              <div className="flex items-center gap-2 text-gray-500">
                <div className="animate-spin w-4 h-4 border-2 border-gray-500 border-t-transparent rounded-full" />
                {t("common.loading")}
              </div>
            ) : tableSummary ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center gap-2">
                  <StructureIcon className="w-4 h-4 text-gray-500" />
                  <span className="text-gray-400 text-sm">{t("dangerAction.rowCount")}:</span>
                  <span className="text-white font-medium">~{formatNumber(tableSummary.rows)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <BoxIcon className="w-4 h-4 text-gray-500" />
                  <span className="text-gray-400 text-sm">{t("dangerAction.dataSize")}:</span>
                  <span className="text-white font-medium">{formatBytes(tableSummary.data_length)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <FileJsonIcon className="w-4 h-4 text-gray-500" />
                  <span className="text-gray-400 text-sm">{t("dangerAction.indexSize")}:</span>
                  <span className="text-white font-medium">{formatBytes(tableSummary.index_length)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <ServerIcon className="w-4 h-4 text-gray-500" />
                  <span className="text-gray-400 text-sm">{t("dangerAction.engine")}:</span>
                  <span className="text-white font-medium">{tableSummary.engine || "-"}</span>
                </div>
              </div>
            ) : (
              <div className="text-gray-500 text-sm">{t("dangerAction.noSummary")}</div>
            )}
          </div>

          {/* Warning Message */}
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
            <p className="text-red-400 text-sm">
              {isTruncate ? t("dangerAction.truncateWarning") : t("dangerAction.deleteWarning")}
            </p>
          </div>

          {/* Confirmation Input */}
          <div>
            <label className="block text-sm text-gray-400 mb-2">
              {t("dangerAction.typeToConfirm")}
            </label>
            <input
              ref={inputRef}
              type="text"
              value={confirmInput}
              onChange={(e) => setConfirmInput(e.target.value)}
              placeholder={tableName}
              className={`w-full px-3 py-2 bg-gray-900 border rounded-md text-white text-sm focus:outline-none transition ${
                confirmInput.length > 0 && !isMatching
                  ? "border-red-500 focus:border-red-500"
                  : isMatching
                  ? "border-green-500 focus:border-green-500"
                  : "border-gray-600 focus:border-blue-500"
              }`}
            />
            {confirmInput.length > 0 && !isMatching && (
              <p className="text-red-400 text-xs mt-1">{t("dangerAction.nameMismatch")}</p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-700 flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-gray-300 hover:text-white bg-gray-700 hover:bg-gray-600 rounded-md transition"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={onConfirm}
            disabled={!isMatching}
            className="px-4 py-2 text-sm bg-red-600 hover:bg-red-500 text-white rounded-md transition disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-red-600"
          >
            {buttonLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
