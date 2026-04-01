import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { CloseIcon, CheckIcon, CopyIcon } from "../common/Icons";

type ViewMode = 'text' | 'hex' | 'json';

interface CellDetailModalProps {
  isOpen: boolean;
  columnName: string;
  columnType: string;
  value: string | number | boolean | null;
  onClose: () => void;
  onSave?: (newValue: string | null) => void;
  editable?: boolean;
}

export function CellDetailModal({
  isOpen,
  columnName,
  columnType,
  value,
  onClose,
  onSave,
  editable = false,
}: CellDetailModalProps) {
  const { t } = useTranslation();
  const [viewMode, setViewMode] = useState<ViewMode>('text');
  const [editValue, setEditValue] = useState("");
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isOpen) {
      setEditValue(value === null ? "" : String(value));
      setViewMode('text');
      setCopied(false);
    }
  }, [isOpen, value]);

  // Escape key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleCopy = async () => {
    const textToCopy = value === null ? "" : String(value);
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const handleSave = () => {
    if (onSave) {
      onSave(editValue.trim() === "" ? null : editValue);
    }
  };

  // Try to format as JSON
  const getFormattedJson = (): string | null => {
    if (value === null) return null;
    try {
      const parsed = JSON.parse(String(value));
      return JSON.stringify(parsed, null, 2);
    } catch {
      return null;
    }
  };

  // Convert to hex
  const getHexValue = (): string => {
    if (value === null) return "";
    const str = String(value);
    return Array.from(str)
      .map(char => char.charCodeAt(0).toString(16).padStart(2, '0').toUpperCase())
      .join(' ');
  };

  const formattedJson = getFormattedJson();
  const isJsonValid = formattedJson !== null;
  const valueLength = value === null ? 0 : String(value).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-gray-800 rounded-lg shadow-xl border border-gray-700 w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between flex-shrink-0">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-400">{t("cellDetail.field")}:</span>
              <span className="text-sm font-medium text-white truncate">&quot;{columnName}&quot;</span>
              <span className="text-xs text-gray-500">- {columnType}</span>
            </div>
            {value !== null && (
              <div className="text-xs text-gray-500 mt-1">
                {valueLength.toLocaleString()} {t("cellDetail.characters")}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-white rounded hover:bg-gray-700 transition"
          >
            <CloseIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-700 px-2 flex-shrink-0">
          <button
            onClick={() => setViewMode('text')}
            className={`px-4 py-2 text-sm font-medium transition ${
              viewMode === 'text'
                ? 'text-blue-400 border-b-2 border-blue-400'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Text
          </button>
          <button
            onClick={() => setViewMode('hex')}
            className={`px-4 py-2 text-sm font-medium transition ${
              viewMode === 'hex'
                ? 'text-blue-400 border-b-2 border-blue-400'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Hex
          </button>
          {isJsonValid && (
            <button
              onClick={() => setViewMode('json')}
              className={`px-4 py-2 text-sm font-medium transition ${
                viewMode === 'json'
                  ? 'text-blue-400 border-b-2 border-blue-400'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              JSON
            </button>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4 min-h-[200px]">
          {value === null ? (
            <div className="flex items-center justify-center h-full">
              <span className="text-gray-500 italic text-lg">NULL</span>
            </div>
          ) : viewMode === 'text' ? (
            editable ? (
              <textarea
                ref={textareaRef}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                className="w-full h-full min-h-[200px] p-3 bg-gray-900 border border-gray-600 rounded text-gray-200 text-sm font-mono resize-none focus:outline-none focus:border-blue-500"
                placeholder="Enter value..."
              />
            ) : (
              <pre className="whitespace-pre-wrap text-gray-200 text-sm font-mono break-all">
                {String(value)}
              </pre>
            )
          ) : viewMode === 'hex' ? (
            <pre className="whitespace-pre-wrap text-gray-200 text-sm font-mono break-all leading-relaxed">
              {getHexValue()}
            </pre>
          ) : (
            <pre className="whitespace-pre-wrap text-gray-200 text-sm font-mono">
              {formattedJson}
            </pre>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-gray-700 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            {value !== null && (
              <span className="text-xs text-gray-500">
                {t("cellDetail.editAllFieldsCheckbox", { defaultValue: "Edit All Fields in Pop-up Sheet" })}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              disabled={value === null}
              className="px-4 py-1.5 text-sm text-gray-300 hover:text-white bg-gray-700 hover:bg-gray-600 rounded transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {copied ? (
                <>
                  <CheckIcon className="w-4 h-4 text-green-400" />
                  {t("common.copied")}
                </>
              ) : (
                <>
                  <CopyIcon className="w-4 h-4" />
                  {t("common.copy")}
                </>
              )}
            </button>
            {editable && onSave && viewMode === 'text' && (
              <button
                onClick={handleSave}
                className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded transition"
              >
                {t("common.save")}
              </button>
            )}
            <button
              onClick={onClose}
              className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded transition"
            >
              OK
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
