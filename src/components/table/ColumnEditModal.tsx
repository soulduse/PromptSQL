import { useState, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { ColumnInfo } from "../../stores/tabStore";
import { CustomSelect } from "../common/CustomSelect";

// MySQL data type definition
interface MySQLType {
  value: string;
  label: string;
  hasLength: boolean;
  placeholder?: string;
}

// MySQL data types grouped by category
const MYSQL_TYPES: { numeric: MySQLType[]; string: MySQLType[]; binary: MySQLType[]; datetime: MySQLType[] } = {
  numeric: [
    { value: "TINYINT", label: "TINYINT", hasLength: true },
    { value: "SMALLINT", label: "SMALLINT", hasLength: true },
    { value: "MEDIUMINT", label: "MEDIUMINT", hasLength: true },
    { value: "INT", label: "INT", hasLength: true },
    { value: "BIGINT", label: "BIGINT", hasLength: true },
    { value: "DECIMAL", label: "DECIMAL", hasLength: true, placeholder: "10,2" },
    { value: "FLOAT", label: "FLOAT", hasLength: true },
    { value: "DOUBLE", label: "DOUBLE", hasLength: true },
    { value: "BIT", label: "BIT", hasLength: true },
  ],
  string: [
    { value: "CHAR", label: "CHAR", hasLength: true, placeholder: "255" },
    { value: "VARCHAR", label: "VARCHAR", hasLength: true, placeholder: "255" },
    { value: "TINYTEXT", label: "TINYTEXT", hasLength: false },
    { value: "TEXT", label: "TEXT", hasLength: false },
    { value: "MEDIUMTEXT", label: "MEDIUMTEXT", hasLength: false },
    { value: "LONGTEXT", label: "LONGTEXT", hasLength: false },
    { value: "ENUM", label: "ENUM", hasLength: true, placeholder: "'a','b','c'" },
    { value: "SET", label: "SET", hasLength: true, placeholder: "'a','b','c'" },
    { value: "JSON", label: "JSON", hasLength: false },
  ],
  binary: [
    { value: "BINARY", label: "BINARY", hasLength: true },
    { value: "VARBINARY", label: "VARBINARY", hasLength: true },
    { value: "TINYBLOB", label: "TINYBLOB", hasLength: false },
    { value: "BLOB", label: "BLOB", hasLength: false },
    { value: "MEDIUMBLOB", label: "MEDIUMBLOB", hasLength: false },
    { value: "LONGBLOB", label: "LONGBLOB", hasLength: false },
  ],
  datetime: [
    { value: "DATE", label: "DATE", hasLength: false },
    { value: "TIME", label: "TIME", hasLength: true },
    { value: "DATETIME", label: "DATETIME", hasLength: true },
    { value: "TIMESTAMP", label: "TIMESTAMP", hasLength: true },
    { value: "YEAR", label: "YEAR", hasLength: false },
  ],
};

const ALL_TYPES = [
  ...MYSQL_TYPES.numeric,
  ...MYSQL_TYPES.string,
  ...MYSQL_TYPES.binary,
  ...MYSQL_TYPES.datetime,
];

// Parse column type into base type and length
function parseColumnType(columnType: string): { baseType: string; length: string; unsigned: boolean } {
  const unsignedMatch = columnType.match(/\bunsigned\b/i);
  const unsigned = !!unsignedMatch;
  const cleanType = columnType.replace(/\s*unsigned\s*/i, "").trim();

  const match = cleanType.match(/^(\w+)(?:\((.+)\))?$/);
  if (match) {
    return { baseType: match[1].toUpperCase(), length: match[2] || "", unsigned };
  }
  return { baseType: cleanType.toUpperCase(), length: "", unsigned };
}

// Build full column type from parts
function buildColumnType(baseType: string, length: string, unsigned: boolean): string {
  let result = baseType;
  if (length) {
    result += `(${length})`;
  }
  if (unsigned && ["TINYINT", "SMALLINT", "MEDIUMINT", "INT", "BIGINT", "DECIMAL", "FLOAT", "DOUBLE"].includes(baseType)) {
    result += " unsigned";
  }
  return result;
}

export interface UpdateColumnRequest {
  column_name: string;
  new_column_name: string | null;
  column_type: string;
  is_nullable: boolean;
  default_value: string | null;
  comment: string | null;
}

interface ColumnEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  column: ColumnInfo | null;
  connectionId: string;
  database: string;
  table: string;
  onSave: () => void;
}

export function ColumnEditModal({
  isOpen,
  onClose,
  column,
  connectionId,
  database,
  table,
  onSave,
}: ColumnEditModalProps) {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [columnName, setColumnName] = useState("");
  const [baseType, setBaseType] = useState("");
  const [length, setLength] = useState("");
  const [isUnsigned, setIsUnsigned] = useState(false);
  const [isNullable, setIsNullable] = useState(true);
  const [defaultValue, setDefaultValue] = useState("");
  const [comment, setComment] = useState("");

  // Get current type info for placeholder
  const currentTypeInfo = ALL_TYPES.find((t) => t.value === baseType);
  const hasLengthInput = currentTypeInfo?.hasLength ?? true;
  const lengthPlaceholder = currentTypeInfo?.placeholder || "";
  const canBeUnsigned = ["TINYINT", "SMALLINT", "MEDIUMINT", "INT", "BIGINT", "DECIMAL", "FLOAT", "DOUBLE"].includes(baseType);

  useEffect(() => {
    if (isOpen && column) {
      const parsed = parseColumnType(column.column_type);
      setColumnName(column.field);
      setBaseType(parsed.baseType);
      setLength(parsed.length);
      setIsUnsigned(parsed.unsigned);
      setIsNullable(column.is_nullable === "YES");
      setDefaultValue(column.default_value || "");
      setComment(column.column_comment || "");
      setError(null);
    }
  }, [isOpen, column]);

  // ESC key handler
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

  // Build full column type from parts
  const columnType = useMemo(() => {
    return buildColumnType(baseType, length, isUnsigned);
  }, [baseType, length, isUnsigned]);

  const request: UpdateColumnRequest = useMemo(() => ({
    column_name: column?.field || "",
    new_column_name: columnName !== column?.field ? columnName : null,
    column_type: columnType,
    is_nullable: isNullable,
    default_value: defaultValue || null,
    comment: comment || null,
  }), [column, columnName, columnType, isNullable, defaultValue, comment]);

  const previewSql = useMemo(() => {
    if (!column || !database || !table) return "";

    const nullable = isNullable ? "NULL" : "NOT NULL";

    let defaultClause = "";
    if (defaultValue) {
      const upperVal = defaultValue.toUpperCase();
      if (upperVal === "NULL" || upperVal === "CURRENT_TIMESTAMP" || upperVal.startsWith("CURRENT_TIMESTAMP") || defaultValue.startsWith("(")) {
        defaultClause = ` DEFAULT ${defaultValue}`;
      } else {
        defaultClause = ` DEFAULT '${defaultValue.replace(/'/g, "''")}'`;
      }
    }

    const commentClause = comment ? ` COMMENT '${comment.replace(/'/g, "''")}'` : "";

    if (columnName !== column.field) {
      return `ALTER TABLE \`${database}\`.\`${table}\`\nCHANGE COLUMN \`${column.field}\` \`${columnName}\` ${columnType} ${nullable}${defaultClause}${commentClause};`;
    }

    return `ALTER TABLE \`${database}\`.\`${table}\`\nMODIFY COLUMN \`${column.field}\` ${columnType} ${nullable}${defaultClause}${commentClause};`;
  }, [column, database, table, columnName, columnType, isNullable, defaultValue, comment]);

  if (!isOpen || !column) return null;

  const handleSave = async () => {
    setSaving(true);
    setError(null);

    try {
      await invoke("update_column", {
        connectionId,
        database,
        table,
        request,
      });
      onSave();
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const isPrimaryKey = column.key === "PRI";

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg w-full max-w-lg p-6 shadow-xl">
        <h2 className="text-xl font-bold mb-6">
          {t("columnEdit.title")}: <code className="text-blue-400">`{column.field}`</code>
        </h2>

        <div className="space-y-4">
          {/* Column Name */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">{t("columnEdit.name")}</label>
            <input
              type="text"
              value={columnName}
              onChange={(e) => setColumnName(e.target.value)}
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Column Type */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-400 mb-1">{t("columnEdit.type")}</label>
              <CustomSelect
                value={baseType}
                onChange={(value) => {
                  setBaseType(value);
                  // Clear length if new type doesn't support it
                  const newTypeInfo = ALL_TYPES.find((t) => t.value === value);
                  if (!newTypeInfo?.hasLength) {
                    setLength("");
                  }
                  // Clear unsigned if new type doesn't support it
                  if (!["TINYINT", "SMALLINT", "MEDIUMINT", "INT", "BIGINT", "DECIMAL", "FLOAT", "DOUBLE"].includes(value)) {
                    setIsUnsigned(false);
                  }
                }}
                options={[
                  {
                    label: t("columnEdit.typeNumeric"),
                    options: MYSQL_TYPES.numeric.map((type) => ({ value: type.value, label: type.label })),
                  },
                  {
                    label: t("columnEdit.typeString"),
                    options: MYSQL_TYPES.string.map((type) => ({ value: type.value, label: type.label })),
                  },
                  {
                    label: t("columnEdit.typeBinary"),
                    options: MYSQL_TYPES.binary.map((type) => ({ value: type.value, label: type.label })),
                  },
                  {
                    label: t("columnEdit.typeDatetime"),
                    options: MYSQL_TYPES.datetime.map((type) => ({ value: type.value, label: type.label })),
                  },
                ]}
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">{t("columnEdit.length")}</label>
              <input
                type="text"
                value={length}
                onChange={(e) => setLength(e.target.value)}
                placeholder={lengthPlaceholder || "-"}
                disabled={!hasLengthInput}
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </div>
          </div>

          {/* Unsigned (for numeric types) */}
          {canBeUnsigned && (
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="unsigned"
                checked={isUnsigned}
                onChange={(e) => setIsUnsigned(e.target.checked)}
                className="w-4 h-4 rounded bg-gray-700 border-gray-600 text-blue-600 focus:ring-blue-500"
              />
              <label htmlFor="unsigned" className="text-sm text-gray-300">
                {t("columnEdit.unsigned")}
              </label>
            </div>
          )}

          {/* Nullable */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="nullable"
              checked={isNullable}
              onChange={(e) => setIsNullable(e.target.checked)}
              disabled={isPrimaryKey}
              className="w-4 h-4 rounded bg-gray-700 border-gray-600 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
            />
            <label htmlFor="nullable" className={`text-sm ${isPrimaryKey ? 'text-gray-500' : 'text-gray-300'}`}>
              {t("columnEdit.nullable")}
            </label>
            {isPrimaryKey && (
              <span className="text-xs text-yellow-500 ml-2">(Primary Key)</span>
            )}
          </div>

          {/* Default Value */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">{t("columnEdit.default")}</label>
            <input
              type="text"
              value={defaultValue}
              onChange={(e) => setDefaultValue(e.target.value)}
              placeholder="NULL, CURRENT_TIMESTAMP, 0, 'value', etc."
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Comment */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">{t("columnEdit.comment")}</label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500 resize-none"
            />
          </div>

          {/* Preview SQL */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">{t("columnEdit.previewSql")}</label>
            <pre className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-green-400 text-sm overflow-x-auto font-mono">
              {previewSql}
            </pre>
          </div>

          {/* Error */}
          {error && (
            <div className="p-3 rounded text-sm bg-red-900/50 text-red-400">
              {error}
            </div>
          )}
        </div>

        {/* Buttons */}
        <div className="flex justify-end gap-2 mt-6">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm transition disabled:opacity-50"
          >
            {t("columnEdit.cancel")}
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !columnName.trim() || !columnType.trim()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm transition disabled:opacity-50"
          >
            {saving ? t("columnEdit.saving") : t("columnEdit.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
