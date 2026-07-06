import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { WarningIcon } from "../common/Icons";
import { Modal } from "../common/Modal";

interface RowErrorModalProps {
  isOpen: boolean;
  error: string;
  onEdit: () => void;
  onDiscard: () => void;
}

export function RowErrorModal({ isOpen, error, onEdit, onDiscard }: RowErrorModalProps) {
  const { t } = useTranslation();
  const editButtonRef = useRef<HTMLButtonElement>(null);

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onDiscard}
      size="md"
      initialFocusRef={editButtonRef}
    >
      <div className="p-6">
        {/* Error Icon */}
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-red-500/20 rounded-full">
            <WarningIcon className="w-6 h-6 text-red-500" />
          </div>
          <h3 className="text-lg font-semibold text-white">
            {t("tableView.unableToWriteRow")}
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
            {t("tableView.discardChanges")}
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
    </Modal>
  );
}
