import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useHistoryStore } from "../../stores/historyStore";
import { BookmarkOutlineIcon, BookmarkIcon, CheckIcon, PlusIcon } from "../common/Icons";

interface SelectionFloatingMenuProps {
  selectedText: string;
  position: { top: number; left: number };
  connectionId: string;
  database: string | null;
  onClose: () => void;
  onSaved?: () => void;
}

export function SelectionFloatingMenu({
  selectedText,
  position,
  connectionId,
  database,
  onClose,
  onSaved,
}: SelectionFloatingMenuProps) {
  const { t } = useTranslation();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { groups, loadGroups, createGroup, saveQueryToGroup } = useHistoryStore();

  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  // Focus input when creating group
  useEffect(() => {
    if (isCreatingGroup && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isCreatingGroup]);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  // Close on ESC
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isCreatingGroup) {
          setIsCreatingGroup(false);
          setNewGroupName("");
        } else if (isDropdownOpen) {
          setIsDropdownOpen(false);
        } else {
          onClose();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, isDropdownOpen, isCreatingGroup]);

  const handleSaveToGroup = async (groupId: string) => {
    setIsSaving(true);
    try {
      await saveQueryToGroup(selectedText, groupId, connectionId, database);
      onSaved?.();
      onClose();
    } catch (error) {
      console.error("Failed to save query to group:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) return;

    try {
      const newGroup = await createGroup(newGroupName.trim());
      if (newGroup) {
        await handleSaveToGroup(newGroup.id);
      }
    } catch (error) {
      console.error("Failed to create group:", error);
    }
  };

  const handleKeyDownInput = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && newGroupName.trim()) {
      e.preventDefault();
      handleCreateGroup();
    }
  };

  return (
    <div
      ref={menuRef}
      className="absolute z-50"
      style={{
        top: position.top,
        left: position.left + 20,
      }}
    >
      {!isDropdownOpen ? (
        // Floating Button
        <button
          onClick={() => setIsDropdownOpen(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded-md shadow-lg transition-all animate-in fade-in duration-150"
          title={t("editor.saveToGroup")}
        >
          <BookmarkOutlineIcon className="w-3.5 h-3.5" />
          <span>{t("editor.saveToGroup")}</span>
        </button>
      ) : (
        // Dropdown Menu
        <div className="bg-gray-800 border border-gray-600 rounded-lg shadow-xl min-w-[180px] overflow-hidden">
          {/* Header */}
          <div className="px-3 py-2 border-b border-gray-700 text-xs text-gray-400">
            {t("editor.selectGroup")}
          </div>

          {/* Group List */}
          <div className="max-h-48 overflow-y-auto">
            {groups.length === 0 && !isCreatingGroup ? (
              <div className="px-3 py-4 text-center text-xs text-gray-500">
                {t("history.noGroups")}
              </div>
            ) : (
              groups.map((group) => (
                <button
                  key={group.id}
                  onClick={() => handleSaveToGroup(group.id)}
                  disabled={isSaving}
                  className="w-full px-3 py-2 text-left text-sm text-gray-300 hover:bg-gray-700 transition flex items-center gap-2 disabled:opacity-50"
                >
                  <BookmarkIcon className="w-4 h-4 text-yellow-500" />
                  <span className="truncate">{group.name}</span>
                </button>
              ))
            )}
          </div>

          {/* Divider */}
          <div className="border-t border-gray-700" />

          {/* Create New Group */}
          {isCreatingGroup ? (
            <div className="p-2">
              <div className="flex gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  onKeyDown={handleKeyDownInput}
                  placeholder={t("history.newGroupPlaceholder")}
                  className="flex-1 px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                />
                <button
                  onClick={handleCreateGroup}
                  disabled={!newGroupName.trim() || isSaving}
                  className="px-2 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:opacity-50 text-white text-xs rounded transition"
                >
                  <CheckIcon className="w-4 h-4" />
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setIsCreatingGroup(true)}
              className="w-full px-3 py-2 text-left text-sm text-blue-400 hover:bg-gray-700 transition flex items-center gap-2"
            >
              <PlusIcon className="w-4 h-4" />
              <span>{t("editor.createNewGroup")}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
