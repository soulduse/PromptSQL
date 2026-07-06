import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "./Modal";

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  requireConfirmation?: boolean;
  confirmationText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  isOpen,
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger = false,
  requireConfirmation = false,
  confirmationText = "",
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const { t } = useTranslation();
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setInputValue("");
    }
  }, [isOpen]);

  const isConfirmDisabled = requireConfirmation && inputValue !== confirmationText;

  const handleConfirm = () => {
    if (!isConfirmDisabled) {
      onConfirm();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !isConfirmDisabled) {
      handleConfirm();
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      title={title}
      tone={danger ? "danger" : "default"}
      initialFocusRef={requireConfirmation ? inputRef : undefined}
      footer={
        <>
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-gray-300 hover:text-white bg-gray-700 hover:bg-gray-600 rounded-md transition"
          >
            {cancelLabel || t("common.cancel")}
          </button>
          <button
            onClick={handleConfirm}
            disabled={isConfirmDisabled}
            className={`px-4 py-2 text-sm rounded-md transition ${
              danger
                ? "bg-red-600 hover:bg-red-500 text-white disabled:bg-red-600/50 disabled:text-white/50"
                : "bg-blue-600 hover:bg-blue-500 text-white disabled:bg-blue-600/50 disabled:text-white/50"
            } disabled:cursor-not-allowed`}
          >
            {confirmLabel || t("common.confirm")}
          </button>
        </>
      }
    >
      <div className="px-6 py-4" onKeyDown={handleKeyDown}>
        <p className="text-gray-300 text-sm whitespace-pre-wrap">{message}</p>

        {requireConfirmation && (
          <div className="mt-4">
            <label className="block text-sm text-gray-400 mb-2">
              {t("tableMenu.typeTableName")}
            </label>
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={confirmationText}
              className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded-md text-white text-sm focus:outline-none focus:border-blue-500"
            />
          </div>
        )}
      </div>
    </Modal>
  );
}
