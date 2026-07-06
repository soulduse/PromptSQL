import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useHistoryStore, QueryHistory } from "../../stores/historyStore";
import { useTabStore } from "../../stores/tabStore";
import { SearchIcon, SpinnerIcon, MoreVerticalIcon, EditIcon, TrashIcon, ChevronLeftIcon, ChevronRightIcon } from "../common/Icons";
import { Modal } from "../common/Modal";

interface HistorySearchModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type ViewMode = "history" | "groups" | "groupDetail";

export function HistorySearchModal({ isOpen, onClose }: HistorySearchModalProps) {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>("history");
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [editingNote, setEditingNote] = useState<{ id: string; note: string } | null>(null);
  const [newGroupName, setNewGroupName] = useState("");
  const [editingGroup, setEditingGroup] = useState<{ id: string; name: string } | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<{ id: string; name: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const {
    history,
    groups,
    searchResults,
    isSearching,
    loadHistory,
    loadGroups,
    searchHistory,
    clearSearchResults,
    updateHistory,
    deleteHistory,
    createGroup,
    updateGroup,
    deleteGroup,
  } = useHistoryStore();

  const { getActiveTab, updateTabQuery, setTableViewMode } = useTabStore();

  // Display items: search results or recent history
  const displayItems = searchQuery.trim() ? searchResults : history.slice(0, 50);

  // Load history and groups when modal opens
  useEffect(() => {
    if (isOpen) {
      loadHistory();
      loadGroups();
      setSearchQuery("");
      setSelectedIndex(0);
      setViewMode("history");
      setActiveMenu(null);
      setEditingNote(null);
      setNewGroupName("");
      setEditingGroup(null);
      setSelectedGroup(null);
      clearSearchResults();
      // 초기 포커스는 Modal의 initialFocusRef가 처리
    }
  }, [isOpen, loadHistory, loadGroups, clearSearchResults]);

  // Search when query changes
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchQuery.trim()) {
        searchHistory(searchQuery);
      } else {
        clearSearchResults();
      }
    }, 150);

    return () => clearTimeout(timer);
  }, [searchQuery, searchHistory, clearSearchResults]);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setActiveMenu(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Global ESC key handler — 레이어별(노트 편집→그룹 편집→메뉴→모달 닫기) 처리가
  // 필요해 Modal의 ESC(closeOnEsc)를 끄고 자체 리스너를 유지한다.
  useEffect(() => {
    if (!isOpen) return;

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (editingNote) {
          setEditingNote(null);
        } else if (editingGroup) {
          setEditingGroup(null);
        } else if (activeMenu) {
          setActiveMenu(null);
        } else {
          onClose();
        }
      }
    };

    document.addEventListener("keydown", handleGlobalKeyDown);
    return () => document.removeEventListener("keydown", handleGlobalKeyDown);
  }, [isOpen, editingNote, editingGroup, activeMenu, onClose]);

  // Get items for current view mode
  const getCurrentItems = useCallback(() => {
    if (viewMode === "groupDetail" && selectedGroup) {
      return history.filter((h) => h.group_id === selectedGroup.id);
    }
    return displayItems;
  }, [viewMode, selectedGroup, history, displayItems]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (editingNote || editingGroup) return; // Don't navigate while editing

      const currentItems = getCurrentItems();

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, currentItems.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter" && currentItems.length > 0 && !activeMenu) {
        e.preventDefault();
        if (viewMode === "history" || viewMode === "groupDetail") {
          handleSelectHistory(currentItems[selectedIndex]);
        }
      } else if (e.key === "Escape") {
        if (activeMenu) {
          setActiveMenu(null);
        } else if (editingNote) {
          setEditingNote(null);
        } else if (viewMode === "groupDetail") {
          setViewMode("groups");
          setSelectedGroup(null);
          setSelectedIndex(0);
        } else {
          onClose();
        }
      }
    },
    [getCurrentItems, selectedIndex, onClose, activeMenu, editingNote, editingGroup, viewMode]
  );

  // Scroll selected item into view
  useEffect(() => {
    const listElement = listRef.current;
    if (listElement && (viewMode === "history" || viewMode === "groupDetail")) {
      const selectedElement = listElement.children[selectedIndex] as HTMLElement;
      if (selectedElement) {
        selectedElement.scrollIntoView({ block: "nearest" });
      }
    }
  }, [selectedIndex, viewMode]);

  // Reset selection when search results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [searchResults]);

  const handleSelectHistory = (item: QueryHistory) => {
    const activeTab = getActiveTab();
    if (activeTab) {
      updateTabQuery(activeTab.id, item.query);
      // Switch to query tab after selecting history
      setTableViewMode(activeTab.id, 'query');
    }
    onClose();
  };

  const getGroupName = (groupId: string | null): string | null => {
    if (!groupId) return null;
    const group = groups.find((g) => g.id === groupId);
    return group?.name || null;
  };

  const formatTimestamp = (timestamp: number): string => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    // Less than 24 hours
    if (diff < 24 * 60 * 60 * 1000) {
      return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    // Less than 7 days
    if (diff < 7 * 24 * 60 * 60 * 1000) {
      const days = Math.floor(diff / (24 * 60 * 60 * 1000));
      return t("history.daysAgo", { count: days });
    }
    // Otherwise show date
    return date.toLocaleDateString();
  };

  const truncateQuery = (query: string, maxLength = 100): string => {
    const singleLine = query.replace(/\s+/g, " ").trim();
    if (singleLine.length <= maxLength) return singleLine;
    return singleLine.substring(0, maxLength) + "...";
  };

  const handleAssignGroup = async (historyId: string, groupId: string | null) => {
    await updateHistory(historyId, undefined, groupId);
    setActiveMenu(null);
  };

  const handleSaveNote = async () => {
    if (editingNote) {
      await updateHistory(editingNote.id, editingNote.note, undefined);
      setEditingNote(null);
    }
  };

  const handleDeleteHistory = async (id: string) => {
    await deleteHistory(id);
    setActiveMenu(null);
  };

  const handleCreateGroup = async () => {
    if (newGroupName.trim()) {
      await createGroup(newGroupName.trim());
      setNewGroupName("");
    }
  };

  const handleSaveGroupEdit = async () => {
    if (editingGroup && editingGroup.name.trim()) {
      await updateGroup(editingGroup.id, editingGroup.name.trim());
      setEditingGroup(null);
    }
  };

  const handleDeleteGroup = async (id: string) => {
    if (confirm(t("history.confirmDeleteGroup"))) {
      await deleteGroup(id);
    }
  };

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="2xl"
      closeOnEsc={false}
      initialFocusRef={inputRef}
      panelClassName="self-start mt-[15vh] overflow-hidden"
    >
      <div onKeyDown={handleKeyDown}>
        {/* Header with Tabs */}
        <div className="flex items-center border-b border-gray-700">
          <button
            onClick={() => setViewMode("history")}
            className={`flex-1 px-4 py-3 text-sm font-medium transition ${
              viewMode === "history"
                ? "text-white border-b-2 border-blue-500"
                : "text-gray-400 hover:text-white"
            }`}
          >
            {t("history.title")}
          </button>
          <button
            onClick={() => setViewMode("groups")}
            className={`flex-1 px-4 py-3 text-sm font-medium transition ${
              viewMode === "groups"
                ? "text-white border-b-2 border-blue-500"
                : "text-gray-400 hover:text-white"
            }`}
          >
            {t("history.groups")}
          </button>
        </div>

        {viewMode === "history" ? (
          <>
            {/* Search Input */}
            <div className="p-4 border-b border-gray-700">
              <div className="relative">
                <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  ref={inputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t("history.searchPlaceholder")}
                  className="w-full pl-10 pr-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 text-gray-500 text-xs">
                  <kbd className="px-1.5 py-0.5 bg-gray-600 rounded text-gray-300">Esc</kbd>
                  <span>{t("history.toClose")}</span>
                </div>
              </div>
            </div>

            {/* Results List */}
            <div ref={listRef} className="max-h-[50vh] overflow-y-auto">
              {isSearching ? (
                <div className="p-8 text-center text-gray-400">
                  <SpinnerIcon className="animate-spin h-6 w-6 mx-auto mb-2" />
                  {t("common.loading")}
                </div>
              ) : displayItems.length === 0 ? (
                <div className="p-8 text-center text-gray-400">
                  {searchQuery.trim() ? t("history.noResults") : t("history.noHistory")}
                </div>
              ) : (
                displayItems.map((item, index) => {
                  const groupName = getGroupName(item.group_id);
                  const isMenuOpen = activeMenu === item.id;
                  return (
                    <div
                      key={item.id}
                      className={`relative px-4 py-3 border-b border-gray-700/50 transition-colors ${
                        index === selectedIndex
                          ? "bg-blue-600/30"
                          : "hover:bg-gray-700/50"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        {/* Status Icon */}
                        <div
                          className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${
                            item.status === "success" ? "bg-green-500" : "bg-red-500"
                          }`}
                        />

                        {/* Query Content - Clickable */}
                        <div
                          className="flex-1 min-w-0 cursor-pointer"
                          onClick={() => handleSelectHistory(item)}
                        >
                          <div className="font-mono text-sm text-gray-200 mb-1">
                            {truncateQuery(item.query)}
                          </div>
                          <div className="flex items-center gap-3 text-xs text-gray-400">
                            <span>{formatTimestamp(item.timestamp)}</span>
                            {item.database && (
                              <span className="px-1.5 py-0.5 bg-gray-700 rounded">
                                {item.database}
                              </span>
                            )}
                            <span>{item.execution_time_ms}ms</span>
                            {item.row_count > 0 && (
                              <span>
                                {t("history.rowCount", { count: item.row_count })}
                              </span>
                            )}
                            {groupName && (
                              <span className="px-1.5 py-0.5 bg-blue-600/30 text-blue-300 rounded">
                                {groupName}
                              </span>
                            )}
                          </div>
                          {item.note && (
                            <div className="mt-1 text-xs text-gray-500 italic">
                              {item.note}
                            </div>
                          )}
                        </div>

                        {/* More Menu Button */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveMenu(isMenuOpen ? null : item.id);
                          }}
                          className="p-1 text-gray-400 hover:text-white hover:bg-gray-600 rounded transition flex-shrink-0"
                        >
                          <MoreVerticalIcon className="w-4 h-4" />
                        </button>

                        {/* Dropdown Menu */}
                        {isMenuOpen && (
                          <div
                            ref={menuRef}
                            className="absolute right-4 top-10 z-50 bg-gray-700 border border-gray-600 rounded-lg shadow-xl py-1 min-w-[180px]"
                          >
                            {/* Assign Group */}
                            <div className="px-3 py-1.5 text-xs text-gray-400 uppercase">
                              {t("history.assignGroup")}
                            </div>
                            <button
                              onClick={() => handleAssignGroup(item.id, null)}
                              className={`w-full px-3 py-2 text-left text-sm hover:bg-gray-600 transition ${
                                !item.group_id ? "text-blue-400" : "text-gray-300"
                              }`}
                            >
                              {t("history.noGroup")}
                            </button>
                            {groups.map((group) => (
                              <button
                                key={group.id}
                                onClick={() => handleAssignGroup(item.id, group.id)}
                                className={`w-full px-3 py-2 text-left text-sm hover:bg-gray-600 transition ${
                                  item.group_id === group.id ? "text-blue-400" : "text-gray-300"
                                }`}
                              >
                                {group.name}
                              </button>
                            ))}

                            <div className="border-t border-gray-600 my-1" />

                            {/* Edit Note */}
                            <button
                              onClick={() => {
                                setEditingNote({ id: item.id, note: item.note || "" });
                                setActiveMenu(null);
                              }}
                              className="w-full px-3 py-2 text-left text-sm text-gray-300 hover:bg-gray-600 transition flex items-center gap-2"
                            >
                              <EditIcon className="w-4 h-4" />
                              {t("history.editNote")}
                            </button>

                            {/* Delete */}
                            <button
                              onClick={() => handleDeleteHistory(item.id)}
                              className="w-full px-3 py-2 text-left text-sm text-red-400 hover:bg-gray-600 transition flex items-center gap-2"
                            >
                              <TrashIcon className="w-4 h-4" />
                              {t("common.delete")}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <div className="px-4 py-3 border-t border-gray-700 bg-gray-800/50 flex items-center justify-between text-xs text-gray-400">
              <div className="flex items-center gap-4">
                <span className="flex items-center gap-1">
                  <kbd className="px-1.5 py-0.5 bg-gray-700 rounded">↑</kbd>
                  <kbd className="px-1.5 py-0.5 bg-gray-700 rounded">↓</kbd>
                  {t("history.navigate")}
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="px-1.5 py-0.5 bg-gray-700 rounded">Enter</kbd>
                  {t("history.select")}
                </span>
              </div>
              <span>{t("history.totalCount", { count: displayItems.length })}</span>
            </div>
          </>
        ) : (
          /* Groups Management View */
          <div className="max-h-[60vh] overflow-y-auto">
            {/* Create New Group */}
            <div className="p-4 border-b border-gray-700">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleCreateGroup();
                    }
                  }}
                  placeholder={t("history.newGroupPlaceholder")}
                  className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 text-sm"
                />
                <button
                  onClick={handleCreateGroup}
                  disabled={!newGroupName.trim()}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm transition"
                >
                  {t("history.createGroup")}
                </button>
              </div>
            </div>

            {/* Groups List */}
            {groups.length === 0 ? (
              <div className="p-8 text-center text-gray-400">
                {t("history.noGroups")}
              </div>
            ) : (
              <div className="divide-y divide-gray-700/50">
                {groups.map((group) => {
                  const historyCount = history.filter((h) => h.group_id === group.id).length;
                  const isEditing = editingGroup?.id === group.id;

                  return (
                    <div key={group.id} className="px-4 py-3 hover:bg-gray-700/30 transition">
                      {isEditing ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={editingGroup.name}
                            onChange={(e) => setEditingGroup({ ...editingGroup, name: e.target.value })}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSaveGroupEdit();
                              if (e.key === "Escape") setEditingGroup(null);
                            }}
                            className="flex-1 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                            autoFocus
                          />
                          <button
                            onClick={handleSaveGroupEdit}
                            className="px-2 py-1 bg-green-600 hover:bg-green-700 rounded text-xs"
                          >
                            {t("common.save")}
                          </button>
                          <button
                            onClick={() => setEditingGroup(null)}
                            className="px-2 py-1 bg-gray-600 hover:bg-gray-500 rounded text-xs"
                          >
                            {t("common.cancel")}
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between">
                          <div
                            className="flex-1 cursor-pointer"
                            onClick={() => {
                              setSelectedGroup({ id: group.id, name: group.name });
                              setViewMode("groupDetail");
                              setSelectedIndex(0);
                            }}
                          >
                            <div className="text-sm text-white font-medium">{group.name}</div>
                            <div className="text-xs text-gray-400">
                              {t("history.queryCount", { count: historyCount })}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingGroup({ id: group.id, name: group.name });
                              }}
                              className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-600 rounded transition"
                              title={t("common.edit")}
                            >
                              <EditIcon className="w-4 h-4" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteGroup(group.id);
                              }}
                              className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-gray-600 rounded transition"
                              title={t("common.delete")}
                            >
                              <TrashIcon className="w-4 h-4" />
                            </button>
                            <ChevronRightIcon className="w-4 h-4 text-gray-500" />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Group Detail View */}
        {viewMode === "groupDetail" && selectedGroup && (
          <>
            {/* Header with Back Button */}
            <div className="p-4 border-b border-gray-700">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    setViewMode("groups");
                    setSelectedGroup(null);
                    setSelectedIndex(0);
                  }}
                  className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-600 rounded transition"
                >
                  <ChevronLeftIcon className="w-5 h-5" />
                </button>
                <div>
                  <div className="text-white font-medium">{selectedGroup.name}</div>
                  <div className="text-xs text-gray-400">
                    {t("history.queryCount", { count: history.filter((h) => h.group_id === selectedGroup.id).length })}
                  </div>
                </div>
              </div>
            </div>

            {/* Queries in Group */}
            <div ref={listRef} className="max-h-[50vh] overflow-y-auto">
              {(() => {
                const groupQueries = history.filter((h) => h.group_id === selectedGroup.id);

                if (groupQueries.length === 0) {
                  return (
                    <div className="p-8 text-center text-gray-400">
                      {t("history.emptyGroup")}
                    </div>
                  );
                }

                return groupQueries.map((item, index) => (
                  <div
                    key={item.id}
                    className={`relative px-4 py-3 border-b border-gray-700/50 transition-colors cursor-pointer ${
                      index === selectedIndex
                        ? "bg-blue-600/30"
                        : "hover:bg-gray-700/50"
                    }`}
                    onClick={() => handleSelectHistory(item)}
                  >
                    <div className="flex items-start gap-3">
                      {/* Status Icon */}
                      <div
                        className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${
                          item.status === "success" ? "bg-green-500" : "bg-red-500"
                        }`}
                      />

                      {/* Query Content */}
                      <div className="flex-1 min-w-0">
                        <div className="font-mono text-sm text-gray-200 mb-1">
                          {truncateQuery(item.query)}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-gray-400">
                          <span>{formatTimestamp(item.timestamp)}</span>
                          {item.database && (
                            <span className="px-1.5 py-0.5 bg-gray-700 rounded">
                              {item.database}
                            </span>
                          )}
                          {item.execution_time_ms > 0 && <span>{item.execution_time_ms}ms</span>}
                          {item.row_count > 0 && (
                            <span>
                              {t("history.rowCount", { count: item.row_count })}
                            </span>
                          )}
                        </div>
                        {item.note && (
                          <div className="mt-1 text-xs text-gray-500 italic">
                            {item.note}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ));
              })()}
            </div>

            {/* Footer */}
            <div className="px-4 py-3 border-t border-gray-700 bg-gray-800/50 flex items-center justify-between text-xs text-gray-400">
              <div className="flex items-center gap-4">
                <span className="flex items-center gap-1">
                  <kbd className="px-1.5 py-0.5 bg-gray-700 rounded">↑</kbd>
                  <kbd className="px-1.5 py-0.5 bg-gray-700 rounded">↓</kbd>
                  {t("history.navigate")}
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="px-1.5 py-0.5 bg-gray-700 rounded">Enter</kbd>
                  {t("history.select")}
                </span>
              </div>
              <span>{t("history.totalCount", { count: history.filter((h) => h.group_id === selectedGroup.id).length })}</span>
            </div>
          </>
        )}

        {/* Note Editing Modal */}
        {editingNote && (
          <Modal isOpen onClose={() => setEditingNote(null)} size="md">
            <div className="p-4">
              <h3 className="text-lg font-medium text-white mb-4">{t("history.editNote")}</h3>
              <textarea
                value={editingNote.note}
                onChange={(e) => setEditingNote({ ...editingNote, note: e.target.value })}
                placeholder={t("history.notePlaceholder")}
                className="w-full h-32 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 resize-none"
                autoFocus
              />
              <div className="flex justify-end gap-2 mt-4">
                <button
                  onClick={() => setEditingNote(null)}
                  className="px-4 py-2 bg-gray-600 hover:bg-gray-500 rounded-lg text-sm transition"
                >
                  {t("common.cancel")}
                </button>
                <button
                  onClick={handleSaveNote}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm transition"
                >
                  {t("common.save")}
                </button>
              </div>
            </div>
          </Modal>
        )}
      </div>
    </Modal>
  );
}
