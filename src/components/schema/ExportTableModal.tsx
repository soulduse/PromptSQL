import { useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";

interface QueryResult {
  columns: string[];
  column_types: string[];
  rows: (string | number | boolean | null)[][];
  affected_rows: number;
  execution_time_ms: number;
}

interface ExportTableModalProps {
  isOpen: boolean;
  tableName: string;
  connectionId: string;
  database: string;
  exportType: "csv" | "json" | "sql";
  onClose: () => void;
}

function escapeCSV(value: string | number | boolean | null): string {
  if (value === null) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function escapeSQL(value: string | number | boolean | null, columnType: string): string {
  if (value === null) return "NULL";
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "number") return String(value);

  // Check if it's a numeric type
  const numericTypes = ["int", "bigint", "smallint", "tinyint", "mediumint", "float", "double", "decimal"];
  const isNumeric = numericTypes.some(t => columnType.toLowerCase().includes(t));
  if (isNumeric && !isNaN(Number(value))) return String(value);

  // Escape string
  return `'${String(value).replace(/'/g, "''")}'`;
}

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function ExportTableModal({
  isOpen,
  tableName,
  connectionId,
  database,
  exportType,
  onClose,
}: ExportTableModalProps) {
  const { t } = useTranslation();
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleExport = async () => {
    setIsExporting(true);
    setError(null);
    setProgress(t("export.fetchingData"));

    try {
      // Fetch all table data (no limit for export)
      const query = `SELECT * FROM \`${database}\`.\`${tableName}\``;
      const result = await invoke<QueryResult>("execute_query", {
        connectionId,
        query,
      });

      setProgress(t("export.generatingFile"));

      let content = "";
      let filename = "";
      let mimeType = "";

      switch (exportType) {
        case "csv": {
          // Header
          const header = result.columns.map(col => escapeCSV(col)).join(",");
          // Rows
          const rows = result.rows.map(row =>
            row.map(cell => escapeCSV(cell)).join(",")
          );
          content = [header, ...rows].join("\n");
          filename = `${tableName}.csv`;
          mimeType = "text/csv;charset=utf-8";
          break;
        }
        case "json": {
          // Convert to array of objects
          const data = result.rows.map(row => {
            const obj: Record<string, string | number | boolean | null> = {};
            result.columns.forEach((col, i) => {
              obj[col] = row[i];
            });
            return obj;
          });
          content = JSON.stringify(data, null, 2);
          filename = `${tableName}.json`;
          mimeType = "application/json;charset=utf-8";
          break;
        }
        case "sql": {
          // Generate INSERT statements
          const lines: string[] = [];
          lines.push(`-- Export of table \`${tableName}\``);
          lines.push(`-- Generated at ${new Date().toISOString()}`);
          lines.push(`-- Total rows: ${result.rows.length}`);
          lines.push("");

          if (result.rows.length > 0) {
            const columnsStr = result.columns.map(c => `\`${c}\``).join(", ");

            for (const row of result.rows) {
              const valuesStr = row.map((cell, i) =>
                escapeSQL(cell, result.column_types[i])
              ).join(", ");
              lines.push(`INSERT INTO \`${tableName}\` (${columnsStr}) VALUES (${valuesStr});`);
            }
          }

          content = lines.join("\n");
          filename = `${tableName}.sql`;
          mimeType = "text/sql;charset=utf-8";
          break;
        }
      }

      setProgress(t("export.downloading"));
      downloadFile(content, filename, mimeType);

      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setIsExporting(false);
      setProgress("");
    }
  };

  const getExportTitle = () => {
    switch (exportType) {
      case "csv": return t("export.exportCsv");
      case "json": return t("export.exportJson");
      case "sql": return t("export.exportSql");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4">
        <div className="px-6 py-4 border-b border-gray-700">
          <h3 className="text-lg font-semibold text-white">{getExportTitle()}</h3>
        </div>

        <div className="px-6 py-4 space-y-4">
          <p className="text-gray-300 text-sm">
            {t("export.confirmExport", { table: tableName })}
          </p>

          {progress && (
            <div className="flex items-center gap-2 text-blue-400 text-sm">
              <div className="animate-spin w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full" />
              {progress}
            </div>
          )}

          {error && (
            <div className="text-red-400 text-sm bg-red-400/10 px-3 py-2 rounded">
              {error}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-700 flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={isExporting}
            className="px-4 py-2 text-sm text-gray-300 hover:text-white bg-gray-700 hover:bg-gray-600 rounded-md transition disabled:opacity-50"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={handleExport}
            disabled={isExporting}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-md transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isExporting ? t("common.loading") : t("export.export")}
          </button>
        </div>
      </div>
    </div>
  );
}
