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
          <button onClick={onCancel} className="btn-secondary">
            {cancelLabel || t("common.cancel")}
          </button>
          <button
            onClick={handleConfirm}
            disabled={isConfirmDisabled}
            className={danger ? "btn-danger" : "btn-primary"}
          >
            {confirmLabel || t("common.confirm")}
          </button>
        </>
      }
    >
      <div className="px-6 py-4" onKeyDown={handleKeyDown}>
        <p className="text-ink text-sm whitespace-pre-wrap">{message}</p>

        {requireConfirmation && (
          <div className="mt-4">
            <label className="block text-sm text-ink-muted mb-2">
              {t("tableMenu.typeTableName")}
            </label>
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={confirmationText}
              className="w-full px-3 py-2 bg-surface-0 border border-line-strong rounded-md text-ink-strong text-sm focus:outline-none focus:border-blue-500"
            />
          </div>
        )}
      </div>
    </Modal>
  );
}
