import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ColumnInfo } from "../../stores/tabStore";
import { CloseIcon } from "../common/Icons";

type IndexType = "INDEX" | "UNIQUE" | "FULLTEXT";

interface AddIndexModalProps {
  isOpen: boolean;
  onClose: () => void;
  columns: ColumnInfo[];
  connectionId?: string;
  database?: string;
  table?: string;
  onSave: () => void;
  onExecuteQuery?: (query: string) => Promise<{ success: boolean; error?: string }>;
}

export function AddIndexModal({
  isOpen,
  onClose,
  columns,
  connectionId: _connectionId,
  database: _database,
  table,
  onSave,
  onExecuteQuery,
}: AddIndexModalProps) {
  // _connectionId and _database are available for future use if needed
  void _connectionId;
  void _database;
  const { t } = useTranslation();
  const [indexType, setIndexType] = useState<IndexType>("INDEX");
  const [indexName, setIndexName] = useState("");
  const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setIndexType("INDEX");
      setIndexName("");
      setSelectedColumns([]);
      setError(null);
      setTimeout(() => nameInputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const toggleColumn = (columnName: string) => {
    setSelectedColumns(prev =>
      prev.includes(columnName)
        ? prev.filter(c => c !== columnName)
        : [...prev, columnName]
    );
  };

  const handleSave = async () => {
    if (!onExecuteQuery || !table) return;

    if (selectedColumns.length === 0) {
      setError(t("tableView.selectAtLeastOneColumn"));
      return;
    }

    setIsSaving(true);
    setError(null);

    // Build the CREATE INDEX query
    const columnsClause = selectedColumns.map(c => `\`${c}\``).join(", ");
    const nameClause = indexName.trim() || `idx_${selectedColumns.join("_")}`;

    let query: string;
    switch (indexType) {
      case "UNIQUE":
        query = `CREATE UNIQUE INDEX \`${nameClause}\` ON \`${table}\` (${columnsClause})`;
        break;
      case "FULLTEXT":
        query = `CREATE FULLTEXT INDEX \`${nameClause}\` ON \`${table}\` (${columnsClause})`;
        break;
      default:
        query = `CREATE INDEX \`${nameClause}\` ON \`${table}\` (${columnsClause})`;
    }

    const result = await onExecuteQuery(query);
    setIsSaving(false);

    if (result.success) {
      onSave();
      onClose();
    } else {
      setError(result.error || "Failed to create index");
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-gray-800 rounded-lg shadow-xl border border-gray-700 w-full max-w-md mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
          <h3 className="text-lg font-semibold text-white">
            {t("tableView.addIndex")}
          </h3>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-white transition"
          >
            <CloseIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-4 space-y-4">
          {/* Index Type */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              {t("tableView.indexType")}
            </label>
            <div className="flex gap-2">
              {(["INDEX", "UNIQUE", "FULLTEXT"] as IndexType[]).map((type) => (
                <button
                  key={type}
                  onClick={() => setIndexType(type)}
                  className={`px-3 py-1.5 text-sm rounded transition ${
                    indexType === type
                      ? "bg-blue-600 text-white"
                      : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          {/* Index Name */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              {t("tableView.indexName")} <span className="text-gray-500">({t("common.optional")})</span>
            </label>
            <input
              ref={nameInputRef}
              type="text"
              value={indexName}
              onChange={(e) => setIndexName(e.target.value)}
              placeholder="idx_column_name"
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Column Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              {t("tableView.selectColumns")}
            </label>
            <div className="max-h-40 overflow-y-auto border border-gray-600 rounded">
              {columns.map((col) => (
                <label
                  key={col.field}
                  className="flex items-center gap-2 px-3 py-2 hover:bg-gray-700 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedColumns.includes(col.field)}
                    onChange={() => toggleColumn(col.field)}
                    className="w-4 h-4 rounded border-gray-500 bg-gray-700 text-blue-500"
                  />
                  <span className="text-gray-300">{col.field}</span>
                  <span className="text-xs text-gray-500">{col.column_type}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="p-3 bg-red-500/20 border border-red-500/30 rounded text-sm text-red-400">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-700">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-300 hover:text-white hover:bg-gray-700 rounded transition"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving || selectedColumns.length === 0}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded transition"
          >
            {isSaving ? t("common.saving") : t("common.create")}
          </button>
        </div>
      </div>
    </div>
  );
}
