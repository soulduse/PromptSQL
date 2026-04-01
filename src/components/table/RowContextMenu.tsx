import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { ColumnInfo } from "../../stores/tabStore";
import {
  CopyIcon,
  ChevronRightIcon,
  DatabaseIcon,
  DocumentIcon,
  CodeIcon,
  TrashIcon,
} from "../common/Icons";
import {
  formatAsTSV,
  formatWithHeaders,
  formatAsSqlInsert,
  formatAsSqlInsertNoAutoInc,
  formatAsIDs,
  formatAsCSV,
  formatAsHTML,
  formatAsJSON,
  formatAsMarkdown,
  formatAsWiki,
  copyToClipboard,
  type Row,
} from "../../utils/copyUtils";

interface RowContextMenuProps {
  x: number;
  y: number;
  selectedRows: Row[];
  columns: string[];
  tableName?: string;
  tableStructure?: ColumnInfo[] | null;
  onClose: () => void;
  onDelete?: () => void;
  canDelete?: boolean;
}

export function RowContextMenu({
  x,
  y,
  selectedRows,
  columns,
  tableName = "table",
  tableStructure,
  onClose,
  onDelete,
  canDelete = false,
}: RowContextMenuProps) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const [showBundlesSubmenu, setShowBundlesSubmenu] = useState(false);
  const [showCopySubmenu, setShowCopySubmenu] = useState(false);
  const [position, setPosition] = useState({ x, y });

  // Adjust position to keep menu within viewport
  useEffect(() => {
    if (menuRef.current) {
      const menuRect = menuRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let newX = x;
      let newY = y;

      // Adjust horizontal position
      if (x + menuRect.width > viewportWidth) {
        newX = viewportWidth - menuRect.width - 10;
      }

      // Adjust vertical position
      if (y + menuRect.height > viewportHeight) {
        newY = viewportHeight - menuRect.height - 10;
      }

      if (newX !== x || newY !== y) {
        setPosition({ x: newX, y: newY });
      }
    }
  }, [x, y]);

  // Close on click outside or ESC
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const handleCopy = useCallback(
    async (format: string) => {
      let text = "";

      switch (format) {
        case "tsv":
          text = formatAsTSV(selectedRows);
          break;
        case "withHeaders":
          text = formatWithHeaders(selectedRows, columns);
          break;
        case "sqlInsert":
          text = formatAsSqlInsert(selectedRows, columns, tableName);
          break;
        case "sqlInsertNoAutoInc":
          text = formatAsSqlInsertNoAutoInc(
            selectedRows,
            columns,
            tableName,
            tableStructure || null
          );
          break;
        case "ids":
          text = formatAsIDs(selectedRows, columns, tableStructure || null);
          break;
        case "csv":
          text = formatAsCSV(selectedRows, columns);
          break;
        case "html":
          text = formatAsHTML(selectedRows, columns);
          break;
        case "json":
          text = formatAsJSON(selectedRows, columns);
          break;
        case "markdown":
          text = formatAsMarkdown(selectedRows, columns);
          break;
        case "wiki":
          text = formatAsWiki(selectedRows, columns);
          break;
      }

      await copyToClipboard(text);
      onClose();
    },
    [selectedRows, columns, tableName, tableStructure, onClose]
  );

  const MenuItem = ({
    onClick,
    children,
    onMouseEnter,
    onMouseLeave,
  }: {
    onClick: () => void;
    children: React.ReactNode;
    onMouseEnter?: () => void;
    onMouseLeave?: () => void;
  }) => (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-700 flex items-center gap-2 text-gray-300"
    >
      {children}
    </button>
  );

  const Divider = () => <div className="border-t border-gray-700 my-1" />;

  return (
    <div
      ref={menuRef}
      className="fixed w-64 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-[100] py-1 overflow-visible"
      style={{ left: position.x, top: position.y }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Basic Copy */}
      <MenuItem onClick={() => handleCopy("tsv")}>
        <CopyIcon className="w-4 h-4" />
        {t("rowMenu.copy", "Copy")}
      </MenuItem>

      <MenuItem onClick={() => handleCopy("withHeaders")}>
        <CopyIcon className="w-4 h-4" />
        {t("rowMenu.copyWithHeaders", "Copy with Column Names")}
      </MenuItem>

      <MenuItem onClick={() => handleCopy("sqlInsert")}>
        <DatabaseIcon className="w-4 h-4" />
        {t("rowMenu.copyAsSqlInsert", "Copy as SQL INSERT")}
      </MenuItem>

      <MenuItem onClick={() => handleCopy("sqlInsertNoAutoInc")}>
        <DatabaseIcon className="w-4 h-4" />
        {t("rowMenu.copyAsSqlInsertNoAutoInc", "Copy as SQL INSERT (no auto_inc)")}
      </MenuItem>

      {/* Delete Row(s) */}
      {canDelete && onDelete && (
        <>
          <Divider />
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="w-full text-left px-3 py-1.5 text-sm hover:bg-red-900/50 flex items-center gap-2 text-red-400"
          >
            <TrashIcon className="w-4 h-4" />
            {selectedRows.length === 1
              ? t("rowMenu.deleteRow", "Delete Row")
              : t("rowMenu.deleteRows", "Delete {{count}} Rows", { count: selectedRows.length })}
          </button>
        </>
      )}

      <Divider />

      {/* Bundles Submenu */}
      <div
        className="relative"
        onMouseEnter={() => setShowBundlesSubmenu(true)}
        onMouseLeave={() => setShowBundlesSubmenu(false)}
      >
        <button
          className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-700 flex items-center gap-2 text-gray-300 justify-between"
          onClick={(e) => e.stopPropagation()}
        >
          <span className="flex items-center gap-2">
            <DocumentIcon className="w-4 h-4" />
            {t("rowMenu.bundles", "Bundles")}
          </span>
          <ChevronRightIcon className="w-4 h-4" />
        </button>

        {showBundlesSubmenu && (
          <div
            className="absolute left-full top-0 ml-1 w-48 bg-gray-800 border border-gray-700 rounded-lg shadow-xl py-1"
            onMouseEnter={() => setShowBundlesSubmenu(true)}
            onMouseLeave={() => setShowBundlesSubmenu(false)}
          >
            {/* Copy Submenu inside Bundles */}
            <div
              className="relative"
              onMouseEnter={() => setShowCopySubmenu(true)}
              onMouseLeave={() => setShowCopySubmenu(false)}
            >
              <button
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-700 flex items-center gap-2 text-gray-300 justify-between"
                onClick={(e) => e.stopPropagation()}
              >
                <span className="flex items-center gap-2">
                  <CopyIcon className="w-4 h-4" />
                  {t("rowMenu.copy", "Copy")}
                </span>
                <ChevronRightIcon className="w-4 h-4" />
              </button>

              {showCopySubmenu && (
                <div
                  className="absolute left-full top-0 ml-1 w-44 bg-gray-800 border border-gray-700 rounded-lg shadow-xl py-1"
                  onMouseEnter={() => setShowCopySubmenu(true)}
                  onMouseLeave={() => setShowCopySubmenu(false)}
                >
                  <MenuItem onClick={() => handleCopy("ids")}>
                    <CodeIcon className="w-4 h-4" />
                    {t("rowMenu.copyIDs", "Copy IDs")}
                  </MenuItem>
                  <MenuItem onClick={() => handleCopy("csv")}>
                    <DocumentIcon className="w-4 h-4" />
                    {t("rowMenu.copyAsCSV", "Copy as CSV")}
                  </MenuItem>
                  <MenuItem onClick={() => handleCopy("html")}>
                    <CodeIcon className="w-4 h-4" />
                    {t("rowMenu.copyAsHTML", "Copy as HTML")}
                  </MenuItem>
                  <MenuItem onClick={() => handleCopy("json")}>
                    <CodeIcon className="w-4 h-4" />
                    {t("rowMenu.copyAsJSON", "Copy as JSON")}
                  </MenuItem>
                  <MenuItem onClick={() => handleCopy("markdown")}>
                    <DocumentIcon className="w-4 h-4" />
                    {t("rowMenu.copyAsMarkdown", "Copy as Markdown")}
                  </MenuItem>
                  <MenuItem onClick={() => handleCopy("wiki")}>
                    <DocumentIcon className="w-4 h-4" />
                    {t("rowMenu.copyAsWiki", "Copy as Wiki")}
                  </MenuItem>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
