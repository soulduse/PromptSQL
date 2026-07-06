import { useState, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useTabStore } from "../../stores/tabStore";
import { CheckIcon, CopyIcon, EditIcon, PlayIcon } from "../common/Icons";
import { QueryConfirmDialog } from "./QueryConfirmDialog";
import { analyzeSqlDanger, getDangerButtonClasses } from "../../utils/sqlUtils";
import { SQL_KEYWORDS, SQL_FUNCTIONS } from "../editor/sqlKeywords";

// Keyword/function sets for SQL highlighting
const SQL_KEYWORD_SET = new Set(SQL_KEYWORDS.map(k => k.toUpperCase()));
const SQL_FUNCTION_SET = new Set(SQL_FUNCTIONS.map(f => f.replace(/\(\)$/, '').toUpperCase()));

// Theme-based colors (VS Code themes)
const THEME_COLORS = {
  dark: {
    string: 'text-[#ce9178]',
    identifier: 'text-[#9cdcfe]',
    comment: 'text-[#6a9955]',
    number: 'text-[#b5cea8]',
    keyword: 'text-[#569cd6]',
    function: 'text-[#dcdcaa]',
    operator: 'text-gray-300',
  },
  light: {
    string: 'text-[#a31515]',
    identifier: 'text-[#001080]',
    comment: 'text-[#008000]',
    number: 'text-[#098658]',
    keyword: 'text-[#0000ff]',
    function: 'text-[#795e26]',
    operator: 'text-gray-600',
  },
};

// Token patterns (without colors - colors are applied based on theme)
const SQL_TOKEN_PATTERNS = [
  { regex: /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/, type: 'string' },
  { regex: /`[^`]+`/, type: 'identifier' },
  { regex: /--[^\n]*|\/\*[\s\S]*?\*\//, type: 'comment' },
  { regex: /\b\d+\.?\d*\b/, type: 'number' },
  { regex: /\b[a-zA-Z_][a-zA-Z0-9_]*\b/, type: 'word' },
  { regex: /[<>!=]=?|[+\-*/%,;().]/, type: 'operator' },
];

const SQL_COMBINED_PATTERN = new RegExp(
  SQL_TOKEN_PATTERNS.map(p => `(${p.regex.source})`).join('|'),
  'gi'
);

export function getWordColor(word: string, colors: typeof THEME_COLORS.dark): string {
  const upper = word.toUpperCase();
  if (SQL_KEYWORD_SET.has(upper)) return colors.keyword;
  if (SQL_FUNCTION_SET.has(upper)) return colors.function;
  return colors.identifier;
}

// SQL Syntax highlighting function
export function highlightSQL(code: string, isDark: boolean): React.ReactNode[] {
  const colors = isDark ? THEME_COLORS.dark : THEME_COLORS.light;
  const result: React.ReactNode[] = [];
  let currentIndex = 0;
  let keyIndex = 0;

  let match;
  while ((match = SQL_COMBINED_PATTERN.exec(code)) !== null) {
    // Add any text before this match
    if (match.index > currentIndex) {
      result.push(<span key={keyIndex++}>{code.slice(currentIndex, match.index)}</span>);
    }

    // Find which group matched (index 1-based)
    const groupIndex = match.findIndex((g, i) => i > 0 && g !== undefined) - 1;
    const { type } = SQL_TOKEN_PATTERNS[groupIndex];
    const className = type === 'word'
      ? getWordColor(match[0], colors)
      : colors[type as keyof typeof colors];

    result.push(<span key={keyIndex++} className={className}>{match[0]}</span>);
    currentIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (currentIndex < code.length) {
    result.push(<span key={keyIndex}>{code.slice(currentIndex)}</span>);
  }

  return result;
}

// Hook to detect theme changes
export function useTheme() {
  const [isDark, setIsDark] = useState(() =>
    document.documentElement.classList.contains('dark')
  );

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains('dark'));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return isDark;
}

interface CodeBlockProps {
  code: string;
  language: string;
}

export default function CodeBlock({ code, language }: CodeBlockProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const isDark = useTheme();

  const activeTabId = useTabStore((state) => state.activeTabId);
  const tabs = useTabStore((state) => state.tabs);
  const appendToQuery = useTabStore((state) => state.appendToQuery);
  const executeQuery = useTabStore((state) => state.executeQuery);
  const addNewTab = useTabStore((state) => state.addNewTab);

  // Get current tab's connection state
  const currentTab = useMemo(() => {
    return tabs.find((t) => t.id === activeTabId);
  }, [tabs, activeTabId]);

  const hasConnection = currentTab?.connectionId && currentTab?.selectedDatabase;

  // Analyze SQL danger level
  const dangerInfo = useMemo(() => {
    if (language !== "sql") return null;
    return analyzeSqlDanger(code);
  }, [code, language]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const handleApplyToEditor = () => {
    if (activeTabId) {
      appendToQuery(activeTabId, code);
    }
  };

  const executeQueryDirectly = () => {
    if (activeTabId) {
      appendToQuery(activeTabId, code);
      executeQuery(activeTabId, code);
    }
  };

  const handleRun = () => {
    // Check connection
    if (!activeTabId || !hasConnection) {
      // Create new tab to guide user to select connection
      addNewTab();
      return;
    }

    // Check danger level
    if (dangerInfo && dangerInfo.level !== "safe") {
      setShowConfirmDialog(true);
      return;
    }

    // Safe query - execute directly
    executeQueryDirectly();
  };

  const handleConfirmExecute = () => {
    setShowConfirmDialog(false);
    executeQueryDirectly();
  };

  const handleCancelExecute = () => {
    setShowConfirmDialog(false);
  };

  // Determine run button color based on danger level
  const runButtonClasses =
    language === "sql" && dangerInfo
      ? getDangerButtonClasses(dangerInfo.level)
      : "text-green-400 hover:text-green-300 hover:bg-green-600/20";

  // Theme-aware container classes
  const containerClasses = isDark
    ? "bg-gray-950 border-gray-700"
    : "bg-gray-50 border-gray-300";

  const headerClasses = isDark
    ? "border-gray-700 bg-gray-900/50"
    : "border-gray-200 bg-gray-100/80";

  const buttonClasses = isDark
    ? "text-gray-400 hover:text-gray-200 hover:bg-gray-700"
    : "text-gray-500 hover:text-gray-700 hover:bg-gray-200";

  const codeTextClasses = isDark
    ? "text-gray-300"
    : "text-gray-800";

  return (
    <>
      <div className={`group relative rounded-lg border my-3 overflow-hidden ${containerClasses}`}>
        {/* Header */}
        <div className={`flex items-center justify-between px-3 py-2 border-b ${headerClasses}`}>
          <span className={`text-xs uppercase font-medium ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
            {language}
          </span>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {/* Copy button */}
            <button
              onClick={handleCopy}
              className={`p-1.5 rounded transition-colors ${buttonClasses}`}
              title={t("ai.copyCode", "코드 복사")}
            >
              {copied ? (
                <CheckIcon className="w-4 h-4 text-green-500" />
              ) : (
                <CopyIcon className="w-4 h-4" />
              )}
            </button>

            {/* Apply to Editor button */}
            <button
              onClick={handleApplyToEditor}
              className={`p-1.5 rounded transition-colors ${buttonClasses}`}
              title={t("ai.applyToEditor", "쿼리 에디터에 적용")}
            >
              <EditIcon className="w-4 h-4" />
            </button>

            {/* Run button (SQL only) */}
            {language === "sql" && (
              <button
                onClick={handleRun}
                className={`p-1.5 rounded transition-colors ${runButtonClasses}`}
                title={t("ai.runQuery", "쿼리 실행")}
              >
                <PlayIcon className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Code content */}
        <pre className="p-3 overflow-x-auto">
          <code className={`text-sm font-mono ${codeTextClasses}`}>
            {language === "sql" ? highlightSQL(code, isDark) : code}
          </code>
        </pre>
      </div>

      {/* Confirmation Dialog */}
      {dangerInfo && (
        <QueryConfirmDialog
          isOpen={showConfirmDialog}
          query={code}
          dangerLevel={dangerInfo.level}
          queryType={dangerInfo.type}
          onConfirm={handleConfirmExecute}
          onCancel={handleCancelExecute}
        />
      )}
    </>
  );
}
