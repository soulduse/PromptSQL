import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { save, open } from "@tauri-apps/plugin-dialog";
import { writeTextFile, mkdir, exists } from "@tauri-apps/plugin-fs";
import { CloseIcon, FolderIcon } from "../common/Icons";
import { Modal } from "../common/Modal";

interface QueryResult {
  columns: string[];
  column_types: string[];
  rows: (string | number | boolean | null)[][];
  affected_rows: number;
  execution_time_ms: number;
}

interface TableExportConfig {
  name: string;
  selected: boolean;
  structure: boolean;
  content: boolean;
}

interface DatabaseExportModalProps {
  isOpen: boolean;
  connectionId: string;
  database: string;
  tables: string[];
  onClose: () => void;
}

type ExportFormat = "sql" | "csv" | "json";

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

  const numericTypes = ["int", "bigint", "smallint", "tinyint", "mediumint", "float", "double", "decimal"];
  const isNumeric = numericTypes.some(t => columnType.toLowerCase().includes(t));
  if (isNumeric && !isNaN(Number(value))) return String(value);

  return `'${String(value).replace(/'/g, "''")}'`;
}

export function DatabaseExportModal({
  isOpen,
  connectionId,
  database,
  tables: initialTables,
  onClose,
}: DatabaseExportModalProps) {
  const { t } = useTranslation();
  const [format, setFormat] = useState<ExportFormat>("sql");
  const [savePath, setSavePath] = useState<string>("");
  const [tableConfigs, setTableConfigs] = useState<TableExportConfig[]>([]);
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number; table: string }>({ current: 0, total: 0, table: "" });
  const [error, setError] = useState<string | null>(null);

  // Initialize table configs when modal opens
  useEffect(() => {
    if (isOpen && initialTables.length > 0) {
      setTableConfigs(
        initialTables.map(name => ({
          name,
          selected: true,
          structure: true,
          content: true,
        }))
      );
      setError(null);
      setProgress({ current: 0, total: 0, table: "" });
    }
  }, [isOpen, initialTables]);

  if (!isOpen) return null;

  const selectedCount = tableConfigs.filter(t => t.selected).length;
  const allSelected = tableConfigs.every(t => t.selected);
  const allStructure = tableConfigs.filter(t => t.selected).every(t => t.structure);
  const allContent = tableConfigs.filter(t => t.selected).every(t => t.content);

  const handleSelectPath = async () => {
    try {
      if (format === "csv") {
        // For CSV, select a folder
        const selected = await open({
          directory: true,
          multiple: false,
          title: t("dbExport.selectFolder"),
        });
        if (selected) {
          setSavePath(selected as string);
        }
      } else {
        // For SQL and JSON, select a file
        const selected = await save({
          defaultPath: `${database}_export.${format}`,
          filters: [
            { name: format.toUpperCase(), extensions: [format] }
          ],
          title: t("dbExport.selectFile"),
        });
        if (selected) {
          setSavePath(selected);
        }
      }
    } catch (err) {
      console.error("Failed to select path:", err);
    }
  };

  const toggleAll = () => {
    const newSelected = !allSelected;
    setTableConfigs(prev =>
      prev.map(t => ({ ...t, selected: newSelected }))
    );
  };

  const toggleAllStructure = () => {
    const newStructure = !allStructure;
    setTableConfigs(prev =>
      prev.map(t => t.selected ? { ...t, structure: newStructure } : t)
    );
  };

  const toggleAllContent = () => {
    const newContent = !allContent;
    setTableConfigs(prev =>
      prev.map(t => t.selected ? { ...t, content: newContent } : t)
    );
  };

  const toggleTable = (index: number) => {
    setTableConfigs(prev =>
      prev.map((t, i) => i === index ? { ...t, selected: !t.selected } : t)
    );
  };

  const toggleStructure = (index: number) => {
    setTableConfigs(prev =>
      prev.map((t, i) => i === index ? { ...t, structure: !t.structure } : t)
    );
  };

  const toggleContent = (index: number) => {
    setTableConfigs(prev =>
      prev.map((t, i) => i === index ? { ...t, content: !t.content } : t)
    );
  };

  const handleExport = async () => {
    if (!savePath) {
      setError(t("dbExport.selectPathFirst"));
      return;
    }

    const selectedTables = tableConfigs.filter(t => t.selected);
    if (selectedTables.length === 0) {
      setError(t("dbExport.selectTablesFirst"));
      return;
    }

    setIsExporting(true);
    setError(null);
    setProgress({ current: 0, total: selectedTables.length, table: "" });

    try {
      switch (format) {
        case "sql":
          await exportToSQL(selectedTables);
          break;
        case "csv":
          await exportToCSV(selectedTables);
          break;
        case "json":
          await exportToJSON(selectedTables);
          break;
      }
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setIsExporting(false);
    }
  };

  const exportToSQL = async (tables: TableExportConfig[]) => {
    const lines: string[] = [];
    lines.push(`-- Database Export: ${database}`);
    lines.push(`-- Generated: ${new Date().toISOString()}`);
    lines.push(`-- Tables: ${tables.map(t => t.name).join(", ")}`);
    lines.push("");

    for (let i = 0; i < tables.length; i++) {
      const table = tables[i];
      setProgress({ current: i + 1, total: tables.length, table: table.name });

      if (table.structure) {
        const createSql = await invoke<string>("get_create_table", {
          connectionId,
          database,
          table: table.name,
        });
        lines.push(`-- Structure for table \`${table.name}\``);
        lines.push(`DROP TABLE IF EXISTS \`${table.name}\`;`);
        lines.push(createSql + ";");
        lines.push("");
      }

      if (table.content) {
        const result = await invoke<QueryResult>("execute_query", {
          connectionId,
          database,
          query: `SELECT * FROM \`${table.name}\``,
        });

        if (result.rows.length > 0) {
          lines.push(`-- Data for table \`${table.name}\` (${result.rows.length} rows)`);
          const columnsStr = result.columns.map(c => `\`${c}\``).join(", ");

          for (const row of result.rows) {
            const valuesStr = row.map((cell, j) =>
              escapeSQL(cell, result.column_types[j])
            ).join(", ");
            lines.push(`INSERT INTO \`${table.name}\` (${columnsStr}) VALUES (${valuesStr});`);
          }
          lines.push("");
        }
      }
    }

    await writeTextFile(savePath, lines.join("\n"));
  };

  const exportToCSV = async (tables: TableExportConfig[]) => {
    // Ensure folder exists
    const folderExists = await exists(savePath);
    if (!folderExists) {
      await mkdir(savePath, { recursive: true });
    }

    for (let i = 0; i < tables.length; i++) {
      const table = tables[i];
      if (!table.content) continue;

      setProgress({ current: i + 1, total: tables.length, table: table.name });

      const result = await invoke<QueryResult>("execute_query", {
        connectionId,
        database,
        query: `SELECT * FROM \`${table.name}\``,
      });

      const header = result.columns.map(col => escapeCSV(col)).join(",");
      const rows = result.rows.map(row =>
        row.map(cell => escapeCSV(cell)).join(",")
      );
      const content = [header, ...rows].join("\n");

      const filePath = `${savePath}/${table.name}.csv`;
      await writeTextFile(filePath, content);
    }
  };

  const exportToJSON = async (tables: TableExportConfig[]) => {
    const exportData: Record<string, unknown> = {
      database,
      exported_at: new Date().toISOString(),
      tables: {} as Record<string, unknown[]>,
    };

    for (let i = 0; i < tables.length; i++) {
      const table = tables[i];
      if (!table.content) continue;

      setProgress({ current: i + 1, total: tables.length, table: table.name });

      const result = await invoke<QueryResult>("execute_query", {
        connectionId,
        database,
        query: `SELECT * FROM \`${table.name}\``,
      });

      const tableData = result.rows.map(row => {
        const obj: Record<string, unknown> = {};
        result.columns.forEach((col, j) => {
          obj[col] = row[j];
        });
        return obj;
      });

      (exportData.tables as Record<string, unknown[]>)[table.name] = tableData;
    }

    await writeTextFile(savePath, JSON.stringify(exportData, null, 2));
  };

  const formatTabs: { key: ExportFormat; label: string }[] = [
    { key: "sql", label: "SQL" },
    { key: "csv", label: "CSV" },
    { key: "json", label: "JSON" },
  ];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="2xl"
      skin={false}
      panelClassName="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-h-[80vh] flex flex-col"
    >
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between flex-shrink-0">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{t("dbExport.title")}</h3>
        <button onClick={onClose} className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-white">
          <CloseIcon className="w-5 h-5" />
        </button>
      </div>

      {/* Content */}
      <div className="px-6 py-4 space-y-4 overflow-auto flex-1">
        {/* Format Tabs */}
        <div className="flex gap-1 bg-gray-100 dark:bg-gray-900 p-1 rounded-lg">
          {formatTabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => {
                setFormat(tab.key);
                setSavePath("");
              }}
              className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition ${
                format === tab.key
                  ? "bg-blue-600 text-white"
                  : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-white hover:bg-gray-200 dark:hover:bg-gray-700"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Save Path */}
        <div className="space-y-2">
          <label className="text-sm text-gray-600 dark:text-gray-400">{t("dbExport.savePath")}</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={savePath}
              readOnly
              placeholder={format === "csv" ? t("dbExport.selectFolder") : t("dbExport.selectFile")}
              className="flex-1 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm text-gray-800 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500"
            />
            <button
              onClick={handleSelectPath}
              className="px-4 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 border border-gray-300 dark:border-transparent rounded text-sm text-gray-700 dark:text-gray-200 flex items-center gap-2"
            >
              <FolderIcon className="w-4 h-4" />
              {t("dbExport.browse")}
            </button>
          </div>
        </div>

        {/* Table List */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-sm text-gray-600 dark:text-gray-400">{t("dbExport.tables")}</label>
            <span className="text-xs text-gray-500">
              {t("dbExport.selectedCount", { count: selectedCount })}
            </span>
          </div>

          {/* Header Row */}
          <div className="flex items-center gap-4 px-3 py-2 bg-gray-100 dark:bg-gray-900 rounded-t border border-gray-200 dark:border-gray-700 text-sm">
            <label className="flex items-center gap-2 flex-1">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                className="rounded bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600"
              />
              <span className="text-gray-600 dark:text-gray-400">{t("dbExport.selectAll")}</span>
            </label>
            {format === "sql" && (
              <>
                <label className="flex items-center gap-1 w-16">
                  <input
                    type="checkbox"
                    checked={allStructure}
                    onChange={toggleAllStructure}
                    className="rounded bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600"
                  />
                  <span className="text-gray-600 dark:text-gray-400 text-xs">S</span>
                </label>
                <label className="flex items-center gap-1 w-16">
                  <input
                    type="checkbox"
                    checked={allContent}
                    onChange={toggleAllContent}
                    className="rounded bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600"
                  />
                  <span className="text-gray-600 dark:text-gray-400 text-xs">C</span>
                </label>
              </>
            )}
          </div>

          {/* Table Rows */}
          <div className="border border-t-0 border-gray-200 dark:border-gray-700 rounded-b max-h-64 overflow-auto">
            {tableConfigs.map((table, index) => (
              <div
                key={table.name}
                className={`flex items-center gap-4 px-3 py-2 text-sm border-b border-gray-200 dark:border-gray-700 last:border-b-0 ${
                  table.selected ? "bg-blue-50 dark:bg-gray-800/50" : "bg-gray-50 dark:bg-gray-900/50 opacity-60"
                }`}
              >
                <label className="flex items-center gap-2 flex-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={table.selected}
                    onChange={() => toggleTable(index)}
                    className="rounded bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600"
                  />
                  <span className="text-gray-800 dark:text-gray-200 truncate">{table.name}</span>
                </label>
                {format === "sql" && (
                  <>
                    <label className="flex items-center justify-center w-16">
                      <input
                        type="checkbox"
                        checked={table.structure}
                        onChange={() => toggleStructure(index)}
                        disabled={!table.selected}
                        className="rounded bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 disabled:opacity-40"
                      />
                    </label>
                    <label className="flex items-center justify-center w-16">
                      <input
                        type="checkbox"
                        checked={table.content}
                        onChange={() => toggleContent(index)}
                        disabled={!table.selected}
                        className="rounded bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 disabled:opacity-40"
                      />
                    </label>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Progress */}
        {isExporting && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 text-sm">
              <div className="animate-spin w-4 h-4 border-2 border-blue-600 dark:border-blue-400 border-t-transparent rounded-full" />
              {t("dbExport.exporting", { table: progress.table })}
            </div>
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
              <div
                className="bg-blue-500 h-2 rounded-full transition-all"
                style={{ width: `${(progress.current / progress.total) * 100}%` }}
              />
            </div>
            <div className="text-xs text-gray-500 text-right">
              {progress.current} / {progress.total}
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="text-red-600 dark:text-red-400 text-sm bg-red-100 dark:bg-red-400/10 px-3 py-2 rounded">
            {error}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3 flex-shrink-0">
        <button
          onClick={onClose}
          disabled={isExporting}
          className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-md transition disabled:opacity-50"
        >
          {t("common.cancel")}
        </button>
        <button
          onClick={handleExport}
          disabled={isExporting || selectedCount === 0 || !savePath}
          className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-md transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isExporting ? t("dbExport.exporting", { table: "" }) : t("dbExport.export")}
        </button>
      </div>
    </Modal>
  );
}
