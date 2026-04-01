import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { TrashIcon } from "../common/Icons";

interface DeleteRowModalProps {
  isOpen: boolean;
  rowData: (string | number | boolean | null)[];
  columns: string[];
  deleteQuery: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteRowModal({
  isOpen,
  rowData,
  columns,
  deleteQuery,
  onConfirm,
  onCancel,
}: DeleteRowModalProps) {
  const { t } = useTranslation();
  const deleteButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen && deleteButtonRef.current) {
      deleteButtonRef.current.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === "Escape") {
        onCancel();
      } else if (e.key === "Enter") {
        onConfirm();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onCancel, onConfirm]);

  if (!isOpen) return null;

  // Format cell value for display
  const formatCellValue = (value: string | number | boolean | null): string => {
    if (value === null) return "NULL";
    if (typeof value === "boolean") return value ? "true" : "false";
    const str = String(value);
    return str.length > 30 ? str.substring(0, 30) + "..." : str;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onCancel}
      />

      {/* Modal */}
      <div className="relative bg-gray-800 rounded-lg shadow-xl border border-gray-700 w-full max-w-lg mx-4 p-6">
        {/* Warning Icon and Title */}
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-red-500/20 rounded-full">
            <TrashIcon className="w-6 h-6 text-red-500" />
          </div>
          <h3 className="text-lg font-semibold text-white">
            {t("tableView.deleteRow")}
          </h3>
        </div>

        {/* Confirmation Message */}
        <p className="text-gray-400 mb-4">
          {t("tableView.deleteRowConfirm")}
        </p>

        {/* Row Data Preview */}
        <div className="mb-4 p-3 bg-gray-900 rounded text-sm overflow-x-auto">
          <table className="w-full text-left">
            <tbody>
              {columns.slice(0, 5).map((col, i) => (
                <tr key={i} className="border-b border-gray-800 last:border-0">
                  <td className="py-1 pr-3 text-gray-500 font-medium whitespace-nowrap">{col}</td>
                  <td className="py-1 text-gray-300 font-mono">
                    {rowData[i] === null ? (
                      <span className="text-gray-500 italic">NULL</span>
                    ) : (
                      formatCellValue(rowData[i])
                    )}
                  </td>
                </tr>
              ))}
              {columns.length > 5 && (
                <tr>
                  <td colSpan={2} className="py-1 text-gray-500 italic">
                    ... {columns.length - 5} more columns
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* DELETE Query Preview */}
        <div className="mb-6">
          <p className="text-sm text-gray-500 mb-1">{t("tableView.queryToExecute")}</p>
          <pre className="p-3 bg-gray-900 rounded text-xs text-amber-400 font-mono break-all max-h-24 overflow-y-auto whitespace-pre-wrap">
            {deleteQuery}
          </pre>
        </div>

        {/* Buttons */}
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-gray-300 hover:text-white hover:bg-gray-700 rounded transition"
          >
            {t("common.cancel")}
          </button>
          <button
            ref={deleteButtonRef}
            onClick={onConfirm}
            className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded transition"
          >
            {t("common.delete")}
          </button>
        </div>
      </div>
    </div>
  );
}
