import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { TrashIcon } from "../common/Icons";
import { Row } from "../../utils/copyUtils";
import { Modal } from "../common/Modal";

interface DeleteRowsConfirmModalProps {
  isOpen: boolean;
  rowCount: number;
  tableName: string;
  sampleRows: Row[];
  columns: string[];
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteRowsConfirmModal({
  isOpen,
  rowCount,
  tableName,
  sampleRows,
  columns,
  onConfirm,
  onCancel,
}: DeleteRowsConfirmModalProps) {
  const { t } = useTranslation();
  const deleteButtonRef = useRef<HTMLButtonElement>(null);

  if (!isOpen) return null;

  // Format cell value for display
  const formatCellValue = (value: string | number | boolean | null): string => {
    if (value === null) return "NULL";
    if (typeof value === "boolean") return value ? "true" : "false";
    const str = String(value);
    return str.length > 20 ? str.substring(0, 20) + "..." : str;
  };

  const displayColumns = columns.slice(0, 4);
  const displayRows = sampleRows.slice(0, 3);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      onConfirm();
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      size="lg"
      initialFocusRef={deleteButtonRef}
    >
      <div className="p-6" onKeyDown={handleKeyDown}>
        {/* Warning Icon and Title */}
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-red-500/20 rounded-full">
            <TrashIcon className="w-6 h-6 text-red-500" />
          </div>
          <h3 className="text-lg font-semibold text-white">
            {rowCount === 1
              ? t("rowMenu.deleteRow", "Delete Row")
              : t("rowMenu.deleteRowsTitle", "Delete Rows")}
          </h3>
        </div>

        {/* Confirmation Message */}
        <p className="text-gray-400 mb-4">
          {rowCount === 1
            ? t("rowMenu.deleteRowConfirm", "Are you sure you want to delete this row?")
            : t("rowMenu.deleteRowsConfirm", "Are you sure you want to delete {{count}} rows from {{table}}?", { count: rowCount, table: tableName })}
        </p>

        {/* Row Data Preview */}
        <div className="mb-4 p-3 bg-gray-900 rounded text-sm overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-700">
                {displayColumns.map((col, i) => (
                  <th key={i} className="py-1 pr-3 text-gray-500 font-medium whitespace-nowrap text-xs">
                    {col}
                  </th>
                ))}
                {columns.length > 4 && (
                  <th className="py-1 text-gray-500 text-xs">...</th>
                )}
              </tr>
            </thead>
            <tbody>
              {displayRows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-b border-gray-800 last:border-0">
                  {displayColumns.map((_, colIndex) => (
                    <td key={colIndex} className="py-1 pr-3 text-gray-300 font-mono text-xs">
                      {row[colIndex] === null ? (
                        <span className="text-gray-500 italic">NULL</span>
                      ) : (
                        formatCellValue(row[colIndex])
                      )}
                    </td>
                  ))}
                  {columns.length > 4 && (
                    <td className="py-1 text-gray-500 text-xs">...</td>
                  )}
                </tr>
              ))}
              {rowCount > 3 && (
                <tr>
                  <td colSpan={displayColumns.length + (columns.length > 4 ? 1 : 0)} className="py-1 text-gray-500 italic text-xs">
                    ... {t("rowMenu.andMoreRows", "and {{count}} more rows", { count: rowCount - 3 })}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Warning */}
        <div className="mb-6 p-3 bg-red-900/20 border border-red-800/50 rounded text-sm text-red-400">
          {t("rowMenu.deleteWarning", "This action cannot be undone. The rows will be permanently deleted from the database.")}
        </div>

        {/* Buttons */}
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-gray-300 hover:text-white hover:bg-gray-700 rounded transition"
          >
            {t("common.cancel", "Cancel")}
          </button>
          <button
            ref={deleteButtonRef}
            onClick={onConfirm}
            className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded transition"
          >
            {rowCount === 1
              ? t("rowMenu.deleteRow", "Delete Row")
              : t("rowMenu.deleteRowsButton", "Delete {{count}} Rows", { count: rowCount })}
          </button>
        </div>
      </div>
    </Modal>
  );
}
