import { useRef, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { TableIcon, DatabaseIcon } from "../common/Icons";

interface MentionOption {
  name: string;
  isSpecial: boolean;
}

interface MentionDropdownProps {
  tables: string[];
  selectedIndex: number;
  mentionQuery: string;
  onSelect: (tableName: string) => void;
}

export default function MentionDropdown({
  tables,
  selectedIndex,
  mentionQuery,
  onSelect,
}: MentionDropdownProps) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLDivElement>(null);

  // Build options list with @all at the top only if query matches "all"
  const options: MentionOption[] = useMemo(() => {
    const query = mentionQuery.toLowerCase();
    const allMatches = "all".includes(query);

    const tableOptions = tables.map((table) => ({ name: table, isSpecial: false }));

    if (allMatches) {
      return [{ name: "all", isSpecial: true }, ...tableOptions];
    }
    return tableOptions;
  }, [tables, mentionQuery]);

  // Scroll selected item into view
  useEffect(() => {
    const selectedElement = listRef.current?.children[selectedIndex] as HTMLElement;
    if (selectedElement) {
      selectedElement.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  const maxItems = Math.min(options.length, 6);

  return (
    <div
      className="absolute z-50 bg-gray-800 border border-gray-700 rounded-lg shadow-xl overflow-hidden"
      style={{
        bottom: "100%",
        left: 0,
        marginBottom: "8px",
        minWidth: "220px",
        maxWidth: "400px",
        width: "max-content",
      }}
    >
      <div className="px-3 py-2 text-xs text-gray-500 border-b border-gray-700">
        {t("ai.selectTable")}
      </div>
      <div
        ref={listRef}
        className="max-h-48 overflow-y-auto"
        style={{ maxHeight: maxItems * 36 }}
      >
        {options.slice(0, 11).map((option, index) => (
          <button
            key={option.name}
            className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 transition-colors ${
              index === selectedIndex
                ? option.isSpecial
                  ? "bg-amber-600/20 text-amber-400"
                  : "bg-blue-600/20 text-blue-400"
                : option.isSpecial
                  ? "text-amber-400 hover:bg-gray-700"
                  : "text-gray-300 hover:bg-gray-700"
            } ${option.isSpecial ? "border-b border-gray-700" : ""}`}
            onClick={() => onSelect(option.name)}
          >
            {option.isSpecial ? (
              <DatabaseIcon className="w-4 h-4 text-amber-500 flex-shrink-0" />
            ) : (
              <TableIcon className="w-4 h-4 text-gray-500 flex-shrink-0" strokeWidth={2} />
            )}
            <span className={`whitespace-nowrap ${option.isSpecial ? "font-medium" : ""}`}>
              {option.name}
            </span>
            {option.isSpecial && (
              <span className="ml-auto text-xs text-gray-500">
                {t("ai.mention.allTables")}
              </span>
            )}
          </button>
        ))}
      </div>
      {options.length > 11 && (
        <div className="px-3 py-2 text-xs text-gray-500 border-t border-gray-700">
          {t("ai.moreItems", { count: options.length - 11 })}
        </div>
      )}
    </div>
  );
}
