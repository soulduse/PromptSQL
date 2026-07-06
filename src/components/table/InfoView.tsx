import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { TableDetailInfo } from "../../stores/tabStore";
import { CheckIcon, CopyIcon } from "../common/Icons";

interface InfoViewProps {
  info: TableDetailInfo | null;
  createTableSql: string | null;
  loading: boolean;
  loadingCreateTable: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KiB", "MiB", "GiB", "TiB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function formatNumber(num: number): string {
  return num.toLocaleString();
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "-";
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString() + " " + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return dateStr;
  }
}

// SQL syntax highlighter
function highlightSql(sql: string): React.ReactElement[] {
  const keywords = [
    'CREATE', 'TABLE', 'NOT', 'NULL', 'DEFAULT', 'AUTO_INCREMENT',
    'PRIMARY', 'KEY', 'UNIQUE', 'INDEX', 'FOREIGN', 'REFERENCES',
    'ON', 'DELETE', 'UPDATE', 'CASCADE', 'SET', 'CONSTRAINT',
    'ENGINE', 'CHARSET', 'COLLATE', 'COMMENT', 'UNSIGNED', 'ZEROFILL'
  ];

  const types = [
    'INT', 'BIGINT', 'SMALLINT', 'TINYINT', 'MEDIUMINT',
    'VARCHAR', 'CHAR', 'TEXT', 'TINYTEXT', 'MEDIUMTEXT', 'LONGTEXT',
    'BLOB', 'TINYBLOB', 'MEDIUMBLOB', 'LONGBLOB',
    'DECIMAL', 'FLOAT', 'DOUBLE', 'BOOLEAN', 'BOOL',
    'DATE', 'DATETIME', 'TIMESTAMP', 'TIME', 'YEAR',
    'ENUM', 'SET', 'JSON', 'BINARY', 'VARBINARY', 'BIT'
  ];

  const lines = sql.split('\n');

  return lines.map((line, lineIndex) => {
    const tokens: React.ReactElement[] = [];
    let remaining = line;
    let keyIndex = 0;

    while (remaining.length > 0) {
      let matched = false;

      // Check for strings (single quotes)
      const stringMatch = remaining.match(/^'([^']*(?:''[^']*)*)'/);
      if (stringMatch) {
        tokens.push(<span key={`${lineIndex}-${keyIndex++}`} className="text-amber-400">{stringMatch[0]}</span>);
        remaining = remaining.slice(stringMatch[0].length);
        continue;
      }

      // Check for backtick identifiers
      const backtickMatch = remaining.match(/^`[^`]+`/);
      if (backtickMatch) {
        tokens.push(<span key={`${lineIndex}-${keyIndex++}`} className="text-cyan-400">{backtickMatch[0]}</span>);
        remaining = remaining.slice(backtickMatch[0].length);
        continue;
      }

      // Check for numbers
      const numberMatch = remaining.match(/^\d+(\.\d+)?/);
      if (numberMatch) {
        tokens.push(<span key={`${lineIndex}-${keyIndex++}`} className="text-purple-400">{numberMatch[0]}</span>);
        remaining = remaining.slice(numberMatch[0].length);
        continue;
      }

      // Check for keywords
      for (const keyword of keywords) {
        const regex = new RegExp(`^\\b${keyword}\\b`, 'i');
        const match = remaining.match(regex);
        if (match) {
          tokens.push(<span key={`${lineIndex}-${keyIndex++}`} className="text-blue-400 font-semibold">{match[0]}</span>);
          remaining = remaining.slice(match[0].length);
          matched = true;
          break;
        }
      }
      if (matched) continue;

      // Check for types
      for (const type of types) {
        const regex = new RegExp(`^\\b${type}\\b`, 'i');
        const match = remaining.match(regex);
        if (match) {
          tokens.push(<span key={`${lineIndex}-${keyIndex++}`} className="text-green-400">{match[0]}</span>);
          remaining = remaining.slice(match[0].length);
          matched = true;
          break;
        }
      }
      if (matched) continue;

      // Check for parentheses and special characters
      const specialMatch = remaining.match(/^[(),;]/);
      if (specialMatch) {
        tokens.push(<span key={`${lineIndex}-${keyIndex++}`} className="text-gray-400">{specialMatch[0]}</span>);
        remaining = remaining.slice(1);
        continue;
      }

      // Default: take one character
      tokens.push(<span key={`${lineIndex}-${keyIndex++}`} className="text-gray-300">{remaining[0]}</span>);
      remaining = remaining.slice(1);
    }

    return (
      <div key={lineIndex} className="whitespace-pre">
        {tokens}
      </div>
    );
  });
}

export function InfoView({ info, createTableSql, loading, loadingCreateTable }: InfoViewProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (createTableSql) {
      try {
        await navigator.clipboard.writeText(createTableSql);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        console.error("Failed to copy:", err);
      }
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500">
        {t("common.loading")}
      </div>
    );
  }

  if (!info) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500">
        {t("tableView.noInfo")}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="max-w-4xl space-y-6">
        {/* Basic Info Section */}
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
          <div className="grid grid-cols-2 gap-x-8 gap-y-3">
            <div className="flex items-center gap-3">
              <span className="text-gray-500 text-sm w-24">{t("tableInfo.type")}:</span>
              <span className="text-gray-200">{info.engine || "-"}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-gray-500 text-sm w-24">{t("tableInfo.createdAt")}:</span>
              <span className="text-gray-200">{formatDate(info.created)}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-gray-500 text-sm w-24">{t("tableInfo.encoding")}:</span>
              <span className="text-gray-200">{info.character_set || "-"}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-gray-500 text-sm w-24">{t("tableInfo.updatedAt")}:</span>
              <span className="text-gray-200">{formatDate(info.updated)}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-gray-500 text-sm w-24">{t("tableInfo.collation")}:</span>
              <span className="text-gray-200">{info.table_collation || "-"}</span>
            </div>
          </div>
        </div>

        {/* Stats Section */}
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
          <div className="grid grid-cols-2 gap-x-8 gap-y-3">
            <div className="flex items-center gap-3">
              <span className="text-gray-500 text-sm w-32">{t("tableInfo.numberOfRows")}:</span>
              <span className="text-gray-200">~{formatNumber(info.rows)}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-gray-500 text-sm w-32">{t("tableView.dataSize")}:</span>
              <span className="text-gray-200">{formatBytes(info.data_length)}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-gray-500 text-sm w-32">{t("tableInfo.rowFormat")}:</span>
              <span className="text-gray-200">{info.row_format || "-"}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-gray-500 text-sm w-32">{t("tableInfo.maxDataSize")}:</span>
              <span className="text-gray-200">{formatBytes(info.max_data_length)}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-gray-500 text-sm w-32">{t("tableInfo.avgRowLength")}:</span>
              <span className="text-gray-200">{formatNumber(info.avg_row_length)}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-gray-500 text-sm w-32">{t("tableView.indexSize")}:</span>
              <span className="text-gray-200">{formatBytes(info.index_length)}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-gray-500 text-sm w-32">{t("tableInfo.autoIncrement")}:</span>
              <span className="text-gray-200">{info.auto_increment ? formatNumber(info.auto_increment) : "-"}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-gray-500 text-sm w-32">{t("tableInfo.freeDataSize")}:</span>
              <span className="text-gray-200">{formatBytes(info.data_free)}</span>
            </div>
          </div>
        </div>

        {/* Comments Section */}
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
          <div className="text-sm text-gray-500 mb-2">{t("tableInfo.comments")}:</div>
          <textarea
            readOnly
            value={info.table_comment || ""}
            placeholder={t("tableInfo.noComment")}
            className="w-full h-20 bg-gray-900 border border-gray-700 rounded-md px-3 py-2 text-gray-300 text-sm resize-none focus:outline-none"
          />
        </div>

        {/* Create Table Syntax Section */}
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-500">{t("tableInfo.createSyntax")}:</span>
            {createTableSql && (
              <button
                onClick={handleCopy}
                className={`flex items-center gap-1 px-2 py-1 text-xs rounded transition ${
                  copied
                    ? "bg-green-600 text-white"
                    : "bg-gray-700 hover:bg-gray-600 text-gray-300"
                }`}
              >
                {copied ? (
                  <>
                    <CheckIcon className="w-3.5 h-3.5" />
                    {t("common.copied")}
                  </>
                ) : (
                  <>
                    <CopyIcon className="w-3.5 h-3.5" />
                    {t("common.copy")}
                  </>
                )}
              </button>
            )}
          </div>
          {loadingCreateTable ? (
            <div className="text-gray-500 text-sm py-4">{t("common.loading")}</div>
          ) : createTableSql ? (
            <div className="w-full bg-gray-900 border border-gray-700 rounded-md px-3 py-2 text-sm overflow-auto max-h-96 font-mono">
              {highlightSql(createTableSql)}
            </div>
          ) : (
            <div className="w-full bg-gray-900 border border-gray-700 rounded-md px-3 py-2 text-gray-500 text-sm">
              {t("tableInfo.noCreateSyntax")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
