import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { WarningIcon } from "../common/Icons";

interface ColumnErrorModalProps {
  isOpen: boolean;
  error: string;
  onEdit: () => void;
  onDiscard: () => void;
}

export function ColumnErrorModal({ isOpen, error, onEdit, onDiscard }: ColumnErrorModalProps) {
  const { t } = useTranslation();
  const editButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen && editButtonRef.current) {
      editButtonRef.current.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === "Escape") {
        onDiscard();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onDiscard]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onDiscard}
      />

      {/* Modal */}
      <div className="relative bg-gray-800 rounded-lg shadow-xl border border-gray-700 w-full max-w-md mx-4 p-6">
        {/* Error Icon */}
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-red-500/20 rounded-full">
            <WarningIcon className="w-6 h-6 text-red-500" />
          </div>
          <h3 className="text-lg font-semibold text-white">
            {t("tableView.operationFailed")}
          </h3>
        </div>

        {/* Error Message */}
        <div className="mb-6">
          <p className="text-sm text-gray-400 mb-2">{t("tableView.mysqlSaid")}</p>
          <div className="p-3 bg-gray-900 rounded text-sm text-red-400 font-mono break-all max-h-32 overflow-y-auto">
            {error}
          </div>
        </div>

        {/* Buttons */}
        <div className="flex gap-3 justify-end">
          <button
            onClick={onDiscard}
            className="px-4 py-2 text-sm text-gray-300 hover:text-white hover:bg-gray-700 rounded transition"
          >
            {t("common.cancel")}
          </button>
          <button
            ref={editButtonRef}
            onClick={onEdit}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded transition"
          >
            {t("tableView.editRow")}
          </button>
        </div>
      </div>
    </div>
  );
}
