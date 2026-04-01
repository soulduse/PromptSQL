import { useTranslation } from "react-i18next";
import { CloseIcon } from "../common/Icons";

interface RAGCompletedModalProps {
  tableCount: number;
  onClose: () => void;
}

export function RAGCompletedModal({
  tableCount,
  onClose,
}: RAGCompletedModalProps) {
  const { t } = useTranslation();

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg p-6 max-w-md mx-4 border border-gray-700 shadow-xl">
        {/* Close button */}
        <div className="flex justify-end -mt-2 -mr-2 mb-2">
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-200 transition-colors p-1"
          >
            <CloseIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Success icon */}
        <div className="flex justify-center mb-4">
          <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center">
            <svg
              className="w-8 h-8 text-green-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
        </div>

        {/* Title */}
        <h2 className="text-lg font-semibold text-center text-white mb-2">
          {t("ai.ragCompletedTitle", "Schema Learning Complete!")}
        </h2>

        {/* Table count */}
        <p className="text-center text-gray-300 mb-4">
          {t("ai.ragCompletedCount", "{{count}} tables learned", {
            count: tableCount,
          })}
        </p>

        {/* Benefits */}
        <div className="bg-gray-700/50 rounded-lg p-4 mb-5">
          <h3 className="text-sm font-medium text-white mb-3">
            {t("ai.ragBenefitsTitle", "What you can do now:")}
          </h3>
          <ul className="text-sm text-gray-300 space-y-2">
            <li className="flex items-start gap-2">
              <span className="text-green-400 mt-0.5">&#10003;</span>
              <span>{t("ai.ragBenefit1", "AI understands your database structure")}</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-400 mt-0.5">&#10003;</span>
              <span>{t("ai.ragBenefit2", "More accurate SQL query suggestions")}</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-400 mt-0.5">&#10003;</span>
              <span>{t("ai.ragBenefit3", "Faster responses for complex queries")}</span>
            </li>
          </ul>
        </div>

        {/* Confirm button */}
        <button
          onClick={onClose}
          className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-lg transition-colors"
        >
          {t("common.confirm", "OK")}
        </button>
      </div>
    </div>
  );
}
