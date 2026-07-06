import { useTranslation } from "react-i18next";
import { WarningIcon, CloseIcon } from "../common/Icons";

interface RagConsentModalProps {
  onConfirm: () => void;
  onDecline: () => void;
}

/**
 * RAG 최초 인덱싱 전 외부 전송 동의 모달.
 * 스키마(테이블/컬럼 구조)가 Google Gemini File Search로 업로드됨을
 * 명시적으로 고지하고 동의를 받는다. 동의는 localStorage에 영구 저장.
 */
export function RagConsentModal({ onConfirm, onDecline }: RagConsentModalProps) {
  const { t } = useTranslation();

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg p-6 max-w-md mx-4 border border-gray-700 shadow-xl">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-full bg-blue-500/10 flex items-center justify-center flex-shrink-0">
            <WarningIcon className="w-6 h-6 text-blue-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-medium text-gray-200 mb-2">
              {t("ai.ragConsent.title", "Upload schema to Google?")}
            </h3>
            <p className="text-sm text-gray-400 mb-2">
              {t(
                "ai.ragConsent.description",
                "To learn your database schema, table and column structures (names, types, comments) will be uploaded to Google Gemini File Search and stored there."
              )}
            </p>
            <p className="text-sm text-gray-400 mb-4">
              {t(
                "ai.ragConsent.note",
                "Table data (rows) is not uploaded. You can proceed without this — the AI will still work, with less accurate table selection."
              )}
            </p>
            <div className="flex gap-3">
              <button
                onClick={onConfirm}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {t("ai.ragConsent.agree", "Agree and start")}
              </button>
              <button
                onClick={onDecline}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm font-medium rounded-lg transition-colors"
              >
                {t("common.cancel", "Cancel")}
              </button>
            </div>
          </div>
          <button
            onClick={onDecline}
            className="text-gray-400 hover:text-gray-200 transition-colors"
          >
            <CloseIcon className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
