import { useTranslation } from "react-i18next";
import { KeyIcon, CloseIcon } from "../common/Icons";
import { Modal } from "../common/Modal";

interface GeminiRequiredModalProps {
  onClose: () => void;
  onGoToSettings: () => void;
}

export function GeminiRequiredModal({
  onClose,
  onGoToSettings,
}: GeminiRequiredModalProps) {
  const { t } = useTranslation();

  return (
    <Modal isOpen onClose={onClose} size="md">
      <div className="p-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center flex-shrink-0">
            <KeyIcon className="w-6 h-6 text-amber-500" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-medium text-gray-200 mb-2">
              {t("ai.geminiRequired.title")}
            </h3>
            <p className="text-sm text-gray-400 mb-4">
              {t("ai.geminiRequired.description")}
            </p>
            <div className="flex gap-3">
              <button
                onClick={onGoToSettings}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {t("ai.geminiRequired.goToSettings")}
              </button>
              <button
                onClick={onClose}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm font-medium rounded-lg transition-colors"
              >
                {t("common.cancel")}
              </button>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-200 transition-colors"
            aria-label="Close"
          >
            <CloseIcon className="w-5 h-5" />
          </button>
        </div>
      </div>
    </Modal>
  );
}
