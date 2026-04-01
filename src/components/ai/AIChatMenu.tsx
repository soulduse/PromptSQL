import { useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAIStore } from "../../stores/aiStore";

interface AIChatMenuProps {
  onClose: () => void;
}

export function AIChatMenu({ onClose }: AIChatMenuProps) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const {
    closeCurrentTab,
    clearAllConversations,
    closeOtherTabs,
    exportCurrentConversation,
    openTabs,
    ragIndexingStatus,
    reindexRag,
    ragOutdated,
  } = useAIStore();

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
    shortcut,
    disabled = false,
  }: {
    onClick: () => void;
    children: React.ReactNode;
    shortcut?: string;
    disabled?: boolean;
  }) => (
    <button
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) {
          onClick();
          onClose();
        }
      }}
      disabled={disabled}
      className={`w-full text-left px-3 py-1.5 text-sm flex items-center justify-between gap-4 ${
        disabled
          ? "text-gray-500 cursor-not-allowed"
          : "text-gray-300 hover:bg-gray-700"
      }`}
    >
      <span>{children}</span>
      {shortcut && (
        <span className="text-xs text-gray-500">{shortcut}</span>
      )}
    </button>
  );

  const Divider = () => <div className="border-t border-gray-700 my-1" />;

  const handleCloseChat = () => {
    closeCurrentTab();
  };

  const handleClearAllChats = () => {
    if (window.confirm(t("ai.menu.confirmClearAll", "모든 대화 기록을 삭제하시겠습니까?"))) {
      clearAllConversations();
    }
  };

  const handleCloseOtherChats = () => {
    closeOtherTabs();
  };

  const handleExportChat = () => {
    exportCurrentConversation();
  };

  const hasMultipleTabs = openTabs.length > 1;
  const hasRagIndex = ragIndexingStatus === "completed";

  const handleRelearn = async () => {
    await reindexRag();
  };

  return (
    <div
      ref={menuRef}
      className="absolute right-0 top-full mt-1 w-52 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50 py-1 overflow-hidden"
      onClick={(e) => e.stopPropagation()}
    >
      <MenuItem onClick={handleCloseChat} shortcut="⌘W">
        {t("ai.menu.closeChat", "채팅 닫기")}
      </MenuItem>

      <Divider />

      <MenuItem onClick={handleClearAllChats}>
        {t("ai.menu.clearAllChats", "모든 채팅 삭제")}
      </MenuItem>
      <MenuItem onClick={handleCloseOtherChats} disabled={!hasMultipleTabs}>
        {t("ai.menu.closeOtherChats", "다른 채팅 닫기")}
      </MenuItem>

      <Divider />

      <MenuItem onClick={handleExportChat}>
        {t("ai.menu.exportChat", "채팅 내보내기")}
      </MenuItem>

      {(hasRagIndex || ragOutdated) && (
        <>
          <Divider />
          <MenuItem onClick={handleRelearn} disabled={!hasRagIndex && !ragOutdated}>
            {t("ai.menu.relearnSchema", "스키마 다시 학습")}
          </MenuItem>
        </>
      )}
    </div>
  );
}
