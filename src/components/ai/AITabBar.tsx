import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAIStore } from "../../stores/aiStore";
import { useTabStore } from "../../stores/tabStore";
import { CloseIcon, PlusIcon, HistoryIcon } from "../common/Icons";

interface AITabBarProps {
  onHistoryClick: () => void;
}

export default function AITabBar({ onHistoryClick }: AITabBarProps) {
  const { t } = useTranslation();
  const { openTabs, activeTabId, setActiveTab, closeTab, addTab } =
    useAIStore();

  // Get current connectionId from main tab store
  const currentConnectionId = useTabStore((state) => {
    const activeTab = state.tabs.find((t) => t.id === state.activeTabId);
    return activeTab?.connectionId;
  });

  // Filter tabs to show only those matching current connection
  const filteredTabs = useMemo(() => {
    return openTabs.filter((tab) => {
      // Show tabs that match current connection OR have no connection (new empty tabs)
      const tabConnectionId = tab.conversation?.connection_id;
      return tabConnectionId === currentConnectionId || !tabConnectionId;
    });
  }, [openTabs, currentConnectionId]);

  const handleNewTab = () => {
    addTab(null);
  };

  const handleCloseTab = (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation();
    closeTab(tabId);
  };

  return (
    <div className="flex items-center bg-gray-850 border-b border-gray-700 min-h-[32px]">
      {/* Tabs Container */}
      <div className="flex-1 flex items-center overflow-x-auto">
        {filteredTabs.map((tab) => {
          const isActive = activeTabId === tab.id;
          const title = tab.conversation?.title || t("ai.newChat", "New Chat");

          return (
            <div
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`group flex items-center gap-1.5 px-3 py-1.5 cursor-pointer border-r border-gray-700 min-w-[100px] max-w-[160px] transition-colors ${
                isActive
                  ? "bg-gray-800 text-white"
                  : "bg-gray-850 text-gray-400 hover:bg-gray-800 hover:text-gray-200"
              }`}
            >
              {/* Tab Title */}
              <span className="truncate text-xs flex-1">{title}</span>

              {/* Close Button */}
              <button
                onClick={(e) => handleCloseTab(e, tab.id)}
                className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-gray-600 rounded transition flex-shrink-0"
                title={t("ai.closeTab", "Close Tab")}
              >
                <CloseIcon className="w-3 h-3" />
              </button>
            </div>
          );
        })}
      </div>

      {/* Action Buttons */}
      <div className="flex items-center px-1 gap-0.5 flex-shrink-0">
        {/* New Tab Button */}
        <button
          onClick={handleNewTab}
          className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition"
          title={t("ai.newTab", "New Tab")}
        >
          <PlusIcon className="w-3.5 h-3.5" />
        </button>

        {/* History Button */}
        <button
          onClick={onHistoryClick}
          className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition"
          title={t("ai.history", "Chat History")}
        >
          <HistoryIcon className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
