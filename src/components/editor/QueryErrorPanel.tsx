import { useState } from "react";
import { useTranslation } from "react-i18next";
import { QueryError } from "../../stores/tabStore";
import { ErrorIcon, ArrowRightIcon, CheckIcon, CopyIcon, CloseIcon } from "../common/Icons";

interface QueryErrorPanelProps {
  error: QueryError;
  onDismiss: () => void;
  onGoToLine?: (line: number) => void;
}

export function QueryErrorPanel({ error, onDismiss, onGoToLine }: QueryErrorPanelProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(error.message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const handleGoToLine = () => {
    if (error.lineNumber && onGoToLine) {
      onGoToLine(error.lineNumber);
    }
  };

  return (
    <div className="query-error-panel animate-slide-up bg-red-900/90 border-t border-red-700 px-4 py-3">
      <div className="flex items-start gap-3">
        {/* Error Icon */}
        <div className="flex-shrink-0 mt-0.5">
          <ErrorIcon className="w-5 h-5 text-red-400" />
        </div>

        {/* Error Content */}
        <div className="flex-1 min-w-0">
          {/* Error Code & State */}
          {(error.errorCode || error.sqlState) && (
            <div className="flex items-center gap-2 mb-1">
              {error.errorCode && (
                <span className="text-xs font-mono bg-red-800 text-red-200 px-1.5 py-0.5 rounded">
                  {t("queryError.code")}: {error.errorCode}
                </span>
              )}
              {error.sqlState && (
                <span className="text-xs font-mono bg-red-800 text-red-200 px-1.5 py-0.5 rounded">
                  SQLSTATE: {error.sqlState}
                </span>
              )}
            </div>
          )}

          {/* Error Message */}
          <p className="text-sm text-red-100 font-mono break-all whitespace-pre-wrap">
            {error.message}
          </p>

          {/* Line Info */}
          {error.lineNumber && (
            <div className="mt-2 text-xs text-red-300">
              {t("queryError.atLine")} {error.lineNumber}
              {error.nearText && (
                <span className="ml-2">
                  {t("queryError.near")} <code className="bg-red-800/50 px-1 rounded">'{error.nearText}'</code>
                </span>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Go to Line Button */}
          {error.lineNumber && onGoToLine && (
            <button
              onClick={handleGoToLine}
              className="p-1.5 text-red-300 hover:text-white hover:bg-red-800 rounded transition"
              title={t("queryError.goToLine")}
            >
              <ArrowRightIcon className="w-4 h-4" />
            </button>
          )}

          {/* Copy Button */}
          <button
            onClick={handleCopy}
            className="p-1.5 text-red-300 hover:text-white hover:bg-red-800 rounded transition"
            title={t("common.copy")}
          >
            {copied ? (
              <CheckIcon className="w-4 h-4 text-green-400" />
            ) : (
              <CopyIcon className="w-4 h-4" />
            )}
          </button>

          {/* Close Button */}
          <button
            onClick={onDismiss}
            className="p-1.5 text-red-300 hover:text-white hover:bg-red-800 rounded transition"
            title={t("common.close")}
          >
            <CloseIcon className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
