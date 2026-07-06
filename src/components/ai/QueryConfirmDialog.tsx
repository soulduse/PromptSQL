import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { WarningIcon, CopyIcon, CheckIcon } from "../common/Icons";
import { DangerLevel } from "../../utils/sqlUtils";
import { useTheme, highlightSQL } from "./CodeBlock";

interface QueryConfirmDialogProps {
  isOpen: boolean;
  query: string;
  dangerLevel: DangerLevel;
  queryType: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  /** 헤더 제목 커스터마이즈 (기본: 위험한 쿼리) */
  title?: string;
  /** 헤더 부제목 커스터마이즈 (기본: 쿼리 타입 설명) */
  description?: string;
  /** 경고 문구 커스터마이즈 — 지정 시 amber 톤으로 표시 (AUTO 승인 등 비파괴 확인용) */
  warningMessage?: string;
}

export function QueryConfirmDialog({
  isOpen,
  query,
  dangerLevel,
  queryType,
  onConfirm,
  onCancel,
  title,
  description,
  warningMessage,
}: QueryConfirmDialogProps) {
  const { t } = useTranslation();
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const [copied, setCopied] = useState(false);
  const isDark = useTheme();

  useEffect(() => {
    if (isOpen) {
      // Focus cancel button for safety
      setTimeout(() => cancelButtonRef.current?.focus(), 100);
    }
  }, [isOpen]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onCancel();
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(query);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  if (!isOpen) return null;

  const isDanger = dangerLevel === "danger";
  const borderColor = isDanger ? "border-red-500/30" : "border-amber-500/30";
  const iconBgColor = isDanger ? "bg-red-500/20" : "bg-amber-500/20";
  const iconColor = isDanger ? "text-red-500" : "text-amber-500";
  // Warning message uses red for destructive confirmations; custom messages
  // (e.g. AUTO-mode read-only approval) use amber
  const isCustomWarning = warningMessage != null;
  const warningBgColor = isCustomWarning
    ? isDark ? "bg-amber-500/10" : "bg-amber-50"
    : isDark ? "bg-red-500/10" : "bg-red-50";
  const warningBorderColor = isCustomWarning
    ? isDark ? "border-amber-500/30" : "border-amber-200"
    : isDark ? "border-red-500/30" : "border-red-200";
  const warningTextColor = isCustomWarning
    ? isDark ? "text-amber-400" : "text-amber-600"
    : isDark ? "text-red-400" : "text-red-600";
  const confirmBgColor = isDanger
    ? "bg-red-600 hover:bg-red-500"
    : "bg-amber-600 hover:bg-amber-500";

  // Theme-aware styles
  const modalBgColor = isDark ? "bg-gray-800" : "bg-white";
  const titleColor = isDark ? "text-white" : "text-gray-900";
  const descColor = isDark ? "text-gray-400" : "text-gray-600";
  const queryBgColor = isDark ? "bg-gray-900" : "bg-gray-50";
  const queryHeaderBgColor = isDark ? "bg-gray-900/50" : "bg-gray-100";
  const queryHeaderTextColor = isDark ? "text-gray-500" : "text-gray-400";
  const borderColorBase = isDark ? "border-gray-700" : "border-gray-200";
  const cancelBtnBgColor = isDark
    ? "bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white"
    : "bg-gray-200 hover:bg-gray-300 text-gray-700 hover:text-gray-900";
  const copyBtnColor = isDark
    ? "text-gray-400 hover:text-gray-200 hover:bg-gray-700"
    : "text-gray-600 hover:text-gray-900 hover:bg-gray-200";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onKeyDown={handleKeyDown}
    >
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onCancel}
      />

      <div
        className={`relative ${modalBgColor} rounded-lg shadow-xl w-full max-w-lg mx-4 border ${borderColor}`}
      >
        {/* Header */}
        <div className={`px-6 py-4 border-b ${borderColorBase} flex items-center gap-3`}>
          <div
            className={`w-10 h-10 rounded-full ${iconBgColor} flex items-center justify-center`}
          >
            <WarningIcon className={`w-5 h-5 ${iconColor}`} />
          </div>
          <div>
            <h3 className={`text-lg font-semibold ${titleColor}`}>
              {title ?? t("ai.dangerQueryTitle", "위험한 쿼리")}
            </h3>
            <p className={`text-sm ${descColor}`}>
              {description ??
                (queryType && t(`ai.${queryType.toLowerCase()}QueryDesc`, `${queryType} 쿼리입니다`))}
            </p>
          </div>
        </div>

        {/* Content */}
        <div className="px-6 py-4 space-y-4">
          {/* Query Preview */}
          <div className={`${queryBgColor} rounded-lg border ${borderColorBase} overflow-hidden`}>
            <div className={`px-3 py-2 border-b ${borderColorBase} ${queryHeaderBgColor} flex items-center justify-between`}>
              <span className={`text-xs ${queryHeaderTextColor} uppercase font-medium`}>
                {t("ai.queryToExecute", "실행할 쿼리")}
              </span>
              <button
                onClick={handleCopy}
                className={`p-1 rounded transition-colors ${copyBtnColor}`}
                title={t("common.copy", "복사")}
              >
                {copied ? (
                  <CheckIcon className="w-4 h-4 text-green-500" />
                ) : (
                  <CopyIcon className="w-4 h-4" />
                )}
              </button>
            </div>
            <pre className="p-3 overflow-x-auto max-h-48 overflow-y-auto">
              <code className="text-sm font-mono whitespace-pre-wrap break-all">
                {highlightSQL(query, isDark)}
              </code>
            </pre>
          </div>

          {/* Warning Message */}
          <div
            className={`${warningBgColor} border ${warningBorderColor} rounded-lg p-3`}
          >
            <p className={`${warningTextColor} text-sm`}>
              {warningMessage ??
                (isDanger
                  ? t("ai.dangerQueryWarning", "이 쿼리는 데이터를 영구적으로 삭제할 수 있습니다. 실행 전 반드시 확인하세요.")
                  : t("ai.warningQueryWarning", "이 쿼리는 데이터를 변경합니다. 실행하시겠습니까?"))}
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className={`px-6 py-4 border-t ${borderColorBase} flex justify-end gap-3`}>
          <button
            ref={cancelButtonRef}
            onClick={onCancel}
            className={`px-4 py-2 text-sm ${cancelBtnBgColor} rounded-md transition`}
          >
            {t("common.cancel", "취소")}
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 text-sm ${confirmBgColor} text-white rounded-md transition`}
          >
            {t("ai.executeQuery", "실행")}
          </button>
        </div>
      </div>
    </div>
  );
}
