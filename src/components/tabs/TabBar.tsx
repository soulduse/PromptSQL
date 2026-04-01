import { useTranslation } from "react-i18next";
import { useTabStore } from "../../stores/tabStore";
import { useConnectionStore } from "../../stores/connectionStore";
import { useAIStore } from "../../stores/aiStore";
import { PlusIcon, CloseIcon, RobotDetailedIcon, HistoryIcon, SettingsIcon } from "../common/Icons";

interface TabBarProps {
  onOpenSettings: () => void;
  onOpenHistory: () => void;
}

export function TabBar({ onOpenSettings, onOpenHistory }: TabBarProps) {
  const { t } = useTranslation();
  const { tabs, activeTabId, setActiveTab, removeTab, addNewTab } = useTabStore();
  const { disconnectDatabase } = useConnectionStore();
  const { togglePanel: toggleAIPanel, isPanelOpen: isAIPanelOpen } = useAIStore();

  const handleCloseTab = async (
    e: React.MouseEvent,
    tabId: string,
    connectionId: string | null
  ) => {
    e.stopPropagation();
    if (connectionId) {
      await disconnectDatabase(connectionId);
    }
    removeTab(tabId);
  };

  const handleNewTab = () => {
    addNewTab();
  };

  return (
    <div className="h-10 bg-gray-700 flex items-end px-1 pt-2">
      {/* New Tab Button */}
      <button
        onClick={handleNewTab}
        className="h-7 w-8 mb-0.5 flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-600 rounded-full transition mr-1"
        title={t("tabs.newConnection")}
      >
        <PlusIcon className="w-4 h-4" />
      </button>

      {/* Tabs Container */}
      <div className="flex items-end flex-1 overflow-x-auto -space-x-1">
        {tabs.map((tab, index) => {
          const isActive = activeTabId === tab.id;
          return (
            <div
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{ zIndex: isActive ? 10 : tabs.length - index }}
              className={`relative cursor-pointer group transition-all duration-150 ${
                isActive
                  ? "h-8"
                  : "h-7 hover:h-[1.875rem]"
              }`}
            >
              {/* Tab Background Shape */}
              <div
                className={`absolute inset-0 transition-colors duration-150 ${
                  isActive
                    ? "bg-gray-900"
                    : "bg-gray-800 group-hover:bg-gray-750"
                }`}
                style={{
                  borderRadius: "8px 8px 0 0",
                  clipPath: "polygon(8px 0, calc(100% - 8px) 0, 100% 100%, 0 100%)",
                }}
              />

              {/* Tab Content */}
              <div className="relative z-10 flex items-center gap-2 px-4 h-full min-w-[140px] max-w-[200px]">
                {/* Status Indicator */}
                <span
                  className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    tab.isNewTab
                      ? "bg-gray-500"
                      : "bg-green-500"
                  }`}
                />

                {/* Tab Title */}
                <span
                  className={`truncate text-sm flex-1 ${
                    isActive ? "text-white" : "text-gray-400 group-hover:text-white"
                  }`}
                >
                  {tab.isNewTab ? t("tabs.newConnection") : tab.connectionName}
                </span>

                {/* Close Button */}
                <button
                  onClick={(e) => handleCloseTab(e, tab.id, tab.connectionId)}
                  className="opacity-0 group-hover:opacity-100 hover:bg-gray-600 rounded p-0.5 transition flex-shrink-0"
                >
                  <CloseIcon className="w-3 h-3 text-gray-400 hover:text-white" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* AI Button - Robot Icon */}
      <button
        onClick={toggleAIPanel}
        className={`h-8 w-9 mb-0.5 ml-2 flex items-center justify-center rounded-full transition ${
          isAIPanelOpen
            ? "text-blue-400 bg-blue-600/20"
            : "text-gray-400 hover:text-white hover:bg-gray-600"
        }`}
        title={`${t("ai.title", "AI Assistant")} (⌘K)`}
      >
        <RobotDetailedIcon className="w-6 h-6" />
      </button>

      {/* History Button */}
      <button
        onClick={onOpenHistory}
        className="h-8 w-9 mb-0.5 ml-2 flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-600 rounded-full transition"
        title={`${t("history.title")} (⌘H)`}
      >
        <HistoryIcon className="w-6 h-6" strokeWidth={1.5} />
      </button>

      {/* Settings Button */}
      <button
        onClick={onOpenSettings}
        className="h-8 w-9 mb-0.5 ml-2 mr-2 flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-600 rounded-full transition"
        title={`${t("settings.title")} (⌘,)`}
      >
        <SettingsIcon className="w-6 h-6" strokeWidth={1.5} />
      </button>
    </div>
  );
}
