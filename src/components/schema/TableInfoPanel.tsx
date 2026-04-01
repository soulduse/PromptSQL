import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";

interface TableDetailInfo {
  created: string | null;
  updated: string | null;
  engine: string | null;
  rows: number;
  row_format: string | null;
  avg_row_length: number;
  data_length: number;
  max_data_length: number;
  index_length: number;
  data_free: number;
  table_collation: string | null;
  character_set: string | null;
  auto_increment: number | null;
  table_comment: string | null;
  index_count: number;
  column_count: number;
}

interface TableInfoPanelProps {
  connectionId: string;
  database: string | null;
  table: string | null;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function formatNumber(num: number): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + "M";
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + "K";
  }
  return num.toLocaleString();
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "-";
  const date = new Date(dateStr);
  return date.toLocaleDateString() + " " + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function TableInfoPanel({ connectionId, database, table }: TableInfoPanelProps) {
  const { t } = useTranslation();
  const [info, setInfo] = useState<TableDetailInfo | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!database || !table) {
      setInfo(null);
      return;
    }

    const fetchInfo = async () => {
      setLoading(true);
      try {
        const result = await invoke<TableDetailInfo>("get_table_detail_info", {
          connectionId,
          database,
          table,
        });
        setInfo(result);
      } catch (error) {
        console.error("Failed to fetch table info:", error);
        setInfo(null);
      } finally {
        setLoading(false);
      }
    };

    fetchInfo();
  }, [connectionId, database, table]);

  if (!table) {
    return (
      <div className="p-3 text-gray-500 text-sm text-center">
        {t("sidebar.noTableSelected")}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-3 text-gray-500 text-sm text-center">
        {t("common.loading")}
      </div>
    );
  }

  if (!info) {
    return null;
  }

  const infoItems = [
    { label: t("tableInfo.created"), value: formatDate(info.created) },
    { label: t("tableInfo.updated"), value: formatDate(info.updated) },
    { label: t("tableInfo.engine"), value: info.engine || "-" },
    { label: t("tableInfo.rows"), value: "~" + formatNumber(info.rows) },
    { label: t("tableInfo.size"), value: formatBytes(info.data_length + info.index_length) },
    { label: t("tableInfo.encoding"), value: info.character_set || "-" },
    { label: t("tableInfo.autoIncrement"), value: info.auto_increment?.toLocaleString() || "-" },
    { label: t("tableInfo.indexes"), value: info.index_count.toString() },
    { label: t("tableInfo.columns"), value: info.column_count.toString() },
  ];

  return (
    <div className="border-t border-gray-700">
      <div className="px-3 py-2 bg-gray-800 border-b border-gray-700">
        <span className="text-xs text-gray-500 uppercase tracking-wider">
          {t("sidebar.tableInfo")}
        </span>
      </div>
      <div className="p-3 space-y-2 text-xs">
        {infoItems.map((item, index) => (
          <div key={index} className="flex items-center gap-2">
            <span className="text-gray-500 w-24 flex-shrink-0">{item.label}:</span>
            <span className="text-gray-300 truncate">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
