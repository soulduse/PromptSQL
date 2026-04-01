import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDownIcon, ChevronRightIcon, CopyIcon, CheckIcon, DatabaseIcon } from "../common/Icons";

// Highlight SQL syntax (simplified version)
const highlightSQL = (sql: string): React.ReactNode => {
  const keywords = [
    "SELECT", "FROM", "WHERE", "JOIN", "LEFT", "RIGHT", "INNER", "OUTER",
    "ON", "AND", "OR", "NOT", "IN", "IS", "NULL", "LIKE", "BETWEEN",
    "ORDER", "BY", "GROUP", "HAVING", "LIMIT", "OFFSET", "AS", "DISTINCT",
    "COUNT", "SUM", "AVG", "MAX", "MIN", "SHOW", "DESCRIBE", "DESC", "ASC"
  ];

  const parts = sql.split(/(\s+|,|\(|\))/);
  return parts.map((part, i) => {
    const upperPart = part.toUpperCase();
    if (keywords.includes(upperPart)) {
      return <span key={i} className="text-blue-400 font-medium">{part}</span>;
    }
    if (/^['"].*['"]$/.test(part)) {
      return <span key={i} className="text-green-400">{part}</span>;
    }
    if (/^\d+$/.test(part)) {
      return <span key={i} className="text-amber-400">{part}</span>;
    }
    return <span key={i}>{part}</span>;
  });
};

export interface AutoQueryResultData {
  query: string;
  row_count: number;
  execution_time_ms: number;
  was_limited: boolean;
  error?: string | null;
}

interface AutoQueryResultProps {
  data: AutoQueryResultData;
  index?: number;
}

export default function AutoQueryResult({ data, index }: AutoQueryResultProps) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(data.query);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const hasError = !!data.error;

  return (
    <div className={`my-2 rounded-lg border ${hasError ? "border-red-700/50 bg-red-900/20" : "border-gray-700 bg-gray-800/50"}`}>
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-gray-700/30 rounded-t-lg transition-colors"
      >
        <div className="flex items-center gap-1.5 text-gray-400">
          {isExpanded ? (
            <ChevronDownIcon className="w-4 h-4" />
          ) : (
            <ChevronRightIcon className="w-4 h-4" />
          )}
          <DatabaseIcon className="w-4 h-4" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">
              {index !== undefined ? `#${index} ` : ""}
              {t("ai.executedQuery", "Executed Query")}
            </span>
            {hasError ? (
              <span className="text-xs text-red-400 px-1.5 py-0.5 bg-red-900/30 rounded">
                {t("ai.queryError", "Error")}
              </span>
            ) : (
              <>
                <span className="text-xs text-emerald-400">
                  {data.row_count} {t("ai.rows", "rows")}
                </span>
                <span className="text-xs text-gray-500">
                  {data.execution_time_ms}ms
                </span>
                {data.was_limited && (
                  <span className="text-xs text-amber-400 px-1.5 py-0.5 bg-amber-900/30 rounded">
                    LIMIT
                  </span>
                )}
              </>
            )}
          </div>

          {/* Query preview */}
          <div className="text-xs text-gray-300 font-mono truncate mt-0.5">
            {data.query.slice(0, 80)}{data.query.length > 80 ? "..." : ""}
          </div>
        </div>

        {/* Copy button */}
        <button
          onClick={handleCopy}
          className="p-1.5 text-gray-500 hover:text-gray-300 hover:bg-gray-600/50 rounded transition-colors"
          title={t("common.copy", "Copy")}
        >
          {copied ? (
            <CheckIcon className="w-3.5 h-3.5 text-green-400" />
          ) : (
            <CopyIcon className="w-3.5 h-3.5" />
          )}
        </button>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="px-3 pb-3 border-t border-gray-700">
          {/* Full query */}
          <div className="mt-2 p-2 bg-gray-900 rounded text-xs font-mono text-gray-300 overflow-x-auto whitespace-pre-wrap">
            {highlightSQL(data.query)}
          </div>

          {/* Error message */}
          {hasError && (
            <div className="mt-2 p-2 bg-red-900/30 rounded text-xs text-red-300">
              {data.error}
            </div>
          )}

          {/* Metadata */}
          {!hasError && (
            <div className="mt-2 flex items-center gap-3 text-xs text-gray-500">
              <span>{data.row_count} {t("ai.rowsReturned", "rows returned")}</span>
              <span>{data.execution_time_ms}ms</span>
              {data.was_limited && (
                <span className="text-amber-400">
                  {t("ai.resultsLimited", "Results limited to 100 rows")}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
