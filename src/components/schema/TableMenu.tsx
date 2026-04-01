import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  CopyIcon,
  EditIcon,
  DuplicateIcon,
  TrashIcon,
  CloseIcon,
  BookmarkIcon,
  ExpandIcon,
  UploadIcon,
  ChevronRightIcon,
  DocumentIcon,
  DatabaseIcon,
  CodeIcon
} from "../common/Icons";

interface TableMenuProps {
  tableName: string;
  database: string;
  connectionId: string;
  isPinned: boolean;
  onCopyName: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onTruncate: () => void;
  onDelete: () => void;
  onTogglePin: () => void;
  onOpenInNewTab: () => void;
  onExportCsv: () => void;
  onExportJson: () => void;
  onExportSql: () => void;
  onShowCreateTable: () => void;
  onCopyCreateTable: () => void;
  onClose: () => void;
}

export function TableMenu({
  isPinned,
  onCopyName,
  onRename,
  onDuplicate,
  onTruncate,
  onDelete,
  onTogglePin,
  onOpenInNewTab,
  onExportCsv,
  onExportJson,
  onExportSql,
  onShowCreateTable,
  onCopyCreateTable,
  onClose,
}: TableMenuProps) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const [showExportSubmenu, setShowExportSubmenu] = useState(false);

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

  const MenuItem = ({
    onClick,
    children,
    danger = false,
    onMouseEnter,
    onMouseLeave,
  }: {
    onClick: () => void;
    children: React.ReactNode;
    danger?: boolean;
    onMouseEnter?: () => void;
    onMouseLeave?: () => void;
  }) => (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
        onClose();
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={`w-full text-left px-3 py-1.5 text-sm hover:bg-gray-700 flex items-center gap-2 ${
        danger ? "text-red-400 hover:text-red-300" : "text-gray-300"
      }`}
    >
      {children}
    </button>
  );

  const Divider = () => <div className="border-t border-gray-700 my-1" />;

  return (
    <div
      ref={menuRef}
      className="absolute right-0 top-full mt-1 w-56 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50 py-1 overflow-hidden"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Copy/Edit Group */}
      <MenuItem onClick={onCopyName}>
        <CopyIcon className="w-4 h-4" />
        {t("tableMenu.copyTableName")}
      </MenuItem>

      <MenuItem onClick={onRename}>
        <EditIcon className="w-4 h-4" />
        {t("tableMenu.renameTable")}
      </MenuItem>

      <MenuItem onClick={onDuplicate}>
        <DuplicateIcon className="w-4 h-4" />
        {t("tableMenu.duplicateTable")}
      </MenuItem>

      <Divider />

      {/* Danger Group */}
      <MenuItem onClick={onTruncate} danger>
        <TrashIcon className="w-4 h-4" />
        {t("tableMenu.truncateTable")}
      </MenuItem>

      <MenuItem onClick={onDelete} danger>
        <CloseIcon className="w-4 h-4" />
        {t("tableMenu.deleteTable")}
      </MenuItem>

      <Divider />

      {/* Navigation Group */}
      <MenuItem onClick={onTogglePin}>
        <BookmarkIcon className="w-4 h-4" style={{ fill: isPinned ? "currentColor" : "none", stroke: "currentColor" }} />
        {isPinned ? t("tableMenu.unpinTable") : t("tableMenu.pinTable")}
      </MenuItem>

      <MenuItem onClick={onOpenInNewTab}>
        <ExpandIcon className="w-4 h-4" />
        {t("tableMenu.openInNewTab")}
      </MenuItem>

      <Divider />

      {/* Export Group */}
      <div
        className="relative"
        onMouseEnter={() => setShowExportSubmenu(true)}
        onMouseLeave={() => setShowExportSubmenu(false)}
      >
        <button
          className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-700 flex items-center gap-2 text-gray-300 justify-between"
          onClick={(e) => e.stopPropagation()}
        >
          <span className="flex items-center gap-2">
            <UploadIcon className="w-4 h-4" />
            {t("tableMenu.export")}
          </span>
          <ChevronRightIcon className="w-4 h-4" />
        </button>

        {showExportSubmenu && (
          <div className="absolute left-full top-0 ml-1 w-44 bg-gray-800 border border-gray-700 rounded-lg shadow-xl py-1">
            <MenuItem onClick={onExportCsv}>
              <DocumentIcon className="w-4 h-4" />
              {t("tableMenu.exportCsv")}
            </MenuItem>
            <MenuItem onClick={onExportJson}>
              <DocumentIcon className="w-4 h-4" />
              {t("tableMenu.exportJson")}
            </MenuItem>
            <MenuItem onClick={onExportSql}>
              <DatabaseIcon className="w-4 h-4" />
              {t("tableMenu.exportSql")}
            </MenuItem>
          </div>
        )}
      </div>

      <Divider />

      {/* Create Table Syntax Group */}
      <MenuItem onClick={onShowCreateTable}>
        <CodeIcon className="w-4 h-4" />
        {t("tableMenu.showCreateTable")}
      </MenuItem>

      <MenuItem onClick={onCopyCreateTable}>
        <CopyIcon className="w-4 h-4" />
        {t("tableMenu.copyCreateTable")}
      </MenuItem>
    </div>
  );
}
