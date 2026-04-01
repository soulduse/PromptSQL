import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { languages } from "../../i18n";
import { LLMProvider } from "../../stores/aiStore";
import { CloseIcon, CheckIcon, MinusIcon, PlusIcon, SunIcon, MoonIcon, LockIcon, SpinnerIcon } from "../common/Icons";

const FONT_SIZE_KEY = "promptsql-font-size";
const THEME_KEY = "promptsql-theme";
const DEFAULT_FONT_SIZE = 16;
const MIN_FONT_SIZE = 12;
const MAX_FONT_SIZE = 24;

type Theme = "light" | "dark";

const applyTheme = (theme: Theme) => {
  if (theme === "dark") {
    document.documentElement.classList.add("dark");
  } else {
    document.documentElement.classList.remove("dark");
  }
  localStorage.setItem(THEME_KEY, theme);
};

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultTab?: string;
}

type SettingsTab = "general" | "shortcuts" | "ai";

interface ProviderKeyState {
  value: string;
  isSaving: boolean;
  status: "idle" | "saved" | "error";
  hasStoredKey: boolean;
  isVerifying: boolean;
  verifyStatus: "idle" | "valid" | "invalid";
  isEditing: boolean;
}

// Shortcut definitions
const shortcuts = [
  { id: "queryRun", keys: ["⌘", "Enter"] },
  { id: "queryRunAlt", keys: ["⌘", "R"] },
  { id: "historyOpen", keys: ["⌘", "H"] },
  { id: "settingsOpen", keys: ["⌘", ","] },
  { id: "aiOpen", keys: ["⌘", "K"] },
];

// Provider configurations
const providers: { id: LLMProvider; label: string; needsApiKey: boolean; apiKeyUrl?: string }[] = [
  { id: "openai", label: "OpenAI", needsApiKey: true, apiKeyUrl: "https://platform.openai.com/api-keys" },
  { id: "anthropic", label: "Anthropic", needsApiKey: true, apiKeyUrl: "https://console.anthropic.com/settings/keys" },
  { id: "gemini", label: "Gemini", needsApiKey: true, apiKeyUrl: "https://aistudio.google.com/apikey" },
  { id: "ollama", label: "Ollama", needsApiKey: false },
];

export function SettingsModal({ isOpen, onClose, defaultTab }: SettingsModalProps) {
  const { t, i18n } = useTranslation();
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");

  // API key states for each provider
  const [apiKeys, setApiKeys] = useState<Record<LLMProvider, ProviderKeyState>>({
    openai: { value: "", isSaving: false, status: "idle", hasStoredKey: false, isVerifying: false, verifyStatus: "idle", isEditing: false },
    anthropic: { value: "", isSaving: false, status: "idle", hasStoredKey: false, isVerifying: false, verifyStatus: "idle", isEditing: false },
    gemini: { value: "", isSaving: false, status: "idle", hasStoredKey: false, isVerifying: false, verifyStatus: "idle", isEditing: false },
    ollama: { value: "", isSaving: false, status: "idle", hasStoredKey: false, isVerifying: false, verifyStatus: "idle", isEditing: false },
  });

  const [ollamaEndpoint, setOllamaEndpoint] = useState("http://localhost:11434");
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE);
  const [theme, setTheme] = useState<Theme>("dark");

  // Toast state
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const showToast = useCallback((message: string, type: "success" | "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  // Load font size and theme from localStorage on mount
  useEffect(() => {
    const savedSize = localStorage.getItem(FONT_SIZE_KEY);
    if (savedSize) {
      const size = parseInt(savedSize, 10);
      if (size >= MIN_FONT_SIZE && size <= MAX_FONT_SIZE) {
        setFontSize(size);
      }
    }

    const savedTheme = localStorage.getItem(THEME_KEY) as Theme | null;
    if (savedTheme === "light" || savedTheme === "dark") {
      setTheme(savedTheme);
    }
  }, []);

  const handleThemeChange = useCallback((newTheme: Theme) => {
    setTheme(newTheme);
    applyTheme(newTheme);
  }, []);

  const handleFontSizeChange = useCallback((newSize: number) => {
    const clampedSize = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, newSize));
    setFontSize(clampedSize);
    localStorage.setItem(FONT_SIZE_KEY, clampedSize.toString());
    document.documentElement.style.fontSize = `${clampedSize}px`;
  }, []);

  // Set active tab when defaultTab changes or modal opens
  useEffect(() => {
    if (isOpen && defaultTab) {
      if (defaultTab === "general" || defaultTab === "shortcuts" || defaultTab === "ai") {
        setActiveTab(defaultTab);
      }
    }
  }, [isOpen, defaultTab]);

  // Load stored API key status when modal opens (bulk check to minimize Keychain access)
  useEffect(() => {
    if (!isOpen) return;

    const loadStoredKeyStatus = async () => {
      try {
        // Single bulk call instead of multiple individual calls
        const keyStatus = await invoke<Record<string, boolean>>("get_all_api_key_status");

        setApiKeys(prev => ({
          ...prev,
          openai: {
            ...prev.openai,
            hasStoredKey: keyStatus.openai ?? false,
            status: keyStatus.openai ? "saved" : "idle"
          },
          anthropic: {
            ...prev.anthropic,
            hasStoredKey: keyStatus.anthropic ?? false,
            status: keyStatus.anthropic ? "saved" : "idle"
          },
          gemini: {
            ...prev.gemini,
            hasStoredKey: keyStatus.gemini ?? false,
            status: keyStatus.gemini ? "saved" : "idle"
          }
        }));
      } catch (e) {
        console.error("Failed to load API key status:", e);
      }
    };

    loadStoredKeyStatus();
  }, [isOpen]);

  // Close on ESC key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const handleLanguageChange = (langCode: string) => {
    i18n.changeLanguage(langCode);
  };

  const handleApiKeyChange = (provider: LLMProvider, value: string) => {
    setApiKeys((prev) => ({
      ...prev,
      [provider]: { ...prev[provider], value, status: "idle" },
    }));
  };

  const handleSaveApiKey = async (provider: LLMProvider) => {
    const keyState = apiKeys[provider];
    if (!keyState.value.trim()) return;

    setApiKeys((prev) => ({
      ...prev,
      [provider]: { ...prev[provider], isSaving: true, status: "idle" },
    }));

    try {
      await invoke("save_ai_api_key", { provider, apiKey: keyState.value.trim() });
      setApiKeys((prev) => ({
        ...prev,
        [provider]: {
          value: "",
          isSaving: false,
          status: "saved",
          hasStoredKey: true,
          isVerifying: false,
          verifyStatus: "idle",
          isEditing: false
        },
      }));
    } catch (e) {
      console.error(`Failed to save API key for ${provider}:`, e);
      setApiKeys((prev) => ({
        ...prev,
        [provider]: { ...prev[provider], isSaving: false, status: "error" },
      }));
    }
  };

  const handleVerifyApiKey = async (provider: LLMProvider) => {
    const keyState = apiKeys[provider];
    const apiKeyToVerify = keyState.value.trim() || null; // Use input value or null for stored key

    setApiKeys((prev) => ({
      ...prev,
      [provider]: { ...prev[provider], isVerifying: true, verifyStatus: "idle" },
    }));

    try {
      const isValid = await invoke<boolean>("verify_ai_api_key", {
        provider,
        apiKey: apiKeyToVerify
      });

      setApiKeys((prev) => ({
        ...prev,
        [provider]: {
          ...prev[provider],
          isVerifying: false,
          verifyStatus: isValid ? "valid" : "idle"
        },
      }));

      if (isValid) {
        showToast(t("ai.verifySuccess", "API key is valid"), "success");
        // Reset verify status after 3 seconds
        setTimeout(() => {
          setApiKeys((prev) => ({
            ...prev,
            [provider]: { ...prev[provider], verifyStatus: "idle" },
          }));
        }, 3000);
      } else {
        showToast(t("ai.verifyFailed", "API key is invalid"), "error");
      }
    } catch (e) {
      console.error(`Failed to verify API key for ${provider}:`, e);
      setApiKeys((prev) => ({
        ...prev,
        [provider]: { ...prev[provider], isVerifying: false, verifyStatus: "idle" },
      }));
      showToast(t("ai.verifyFailed", "API key is invalid"), "error");
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      {/* Toast notification */}
      {toast && (
        <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[60] animate-fade-in">
          <div className={`px-6 py-4 rounded-lg shadow-2xl flex items-center gap-3 ${
            toast.type === "success"
              ? "bg-green-600"
              : "bg-red-600"
          }`}>
            {toast.type === "success" ? (
              <CheckIcon className="w-6 h-6" />
            ) : (
              <CloseIcon className="w-6 h-6" />
            )}
            <span className="text-base font-medium">{toast.message}</span>
          </div>
        </div>
      )}

      <div className="bg-gray-800 rounded-lg shadow-xl w-full max-w-3xl mx-4 flex flex-col" style={{ height: '840px' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700 flex-shrink-0">
          <h2 className="text-xl font-semibold">{t("settings.title")}</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition"
          >
            <CloseIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-700 flex-shrink-0">
          <button
            onClick={() => setActiveTab("general")}
            className={`flex-1 px-4 py-3 text-base font-medium transition ${
              activeTab === "general"
                ? "text-white border-b-2 border-blue-500"
                : "text-gray-400 hover:text-white"
            }`}
          >
            {t("settings.tabs.general")}
          </button>
          <button
            onClick={() => setActiveTab("shortcuts")}
            className={`flex-1 px-4 py-3 text-base font-medium transition ${
              activeTab === "shortcuts"
                ? "text-white border-b-2 border-blue-500"
                : "text-gray-400 hover:text-white"
            }`}
          >
            {t("settings.tabs.shortcuts")}
          </button>
          <button
            onClick={() => setActiveTab("ai")}
            className={`flex-1 px-4 py-3 text-base font-medium transition ${
              activeTab === "ai"
                ? "text-white border-b-2 border-blue-500"
                : "text-gray-400 hover:text-white"
            }`}
          >
            {t("settings.tabs.ai")}
          </button>
        </div>

        {/* Content */}
        <div className="p-6 flex-1 overflow-y-auto">
          {activeTab === "general" && (
            <div className="space-y-6">
              {/* Language Setting */}
              <div>
                <label className="block text-base font-medium text-gray-300 mb-2">
                  {t("settings.language")}
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {languages.map((lang) => (
                    <button
                      key={lang.code}
                      onClick={() => handleLanguageChange(lang.code)}
                      className={`px-4 py-2.5 rounded-md text-base transition ${
                        i18n.language === lang.code
                          ? "bg-blue-600 text-white"
                          : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                      }`}
                    >
                      {lang.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Font Size Setting */}
              <div>
                <label className="block text-base font-medium text-gray-300 mb-3">
                  {t("settings.fontSize", "Font Size")}
                </label>
                <div className="flex items-center gap-4">
                  {/* Custom slider with tick marks */}
                  <div className="flex-1 relative">
                    {/* Slider track and input */}
                    <div className="relative h-2">
                      {/* Background track */}
                      <div className="absolute inset-0 bg-gray-700 rounded-lg" />
                      {/* Filled track */}
                      <div
                        className="absolute left-0 top-0 h-full bg-blue-500 rounded-lg"
                        style={{ width: `${((fontSize - MIN_FONT_SIZE) / (MAX_FONT_SIZE - MIN_FONT_SIZE)) * 100}%` }}
                      />
                      {/* Hidden range input for dragging */}
                      <input
                        type="range"
                        min={MIN_FONT_SIZE}
                        max={MAX_FONT_SIZE}
                        value={fontSize}
                        onChange={(e) => handleFontSizeChange(parseInt(e.target.value, 10))}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      />
                      {/* Thumb indicator */}
                      <div
                        className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full shadow-md border-2 border-blue-500 pointer-events-none"
                        style={{ left: `calc(${((fontSize - MIN_FONT_SIZE) / (MAX_FONT_SIZE - MIN_FONT_SIZE)) * 100}% - 8px)` }}
                      />
                    </div>
                    {/* Tick marks */}
                    <div className="relative mt-2 flex justify-between px-0">
                      {Array.from({ length: MAX_FONT_SIZE - MIN_FONT_SIZE + 1 }, (_, i) => MIN_FONT_SIZE + i).map((value) => (
                        <button
                          key={value}
                          onClick={() => handleFontSizeChange(value)}
                          className="flex flex-col items-center group"
                          style={{ width: '20px' }}
                        >
                          {/* Tick line */}
                          <div
                            className={`w-0.5 transition-all ${
                              value === fontSize
                                ? 'h-3 bg-blue-500'
                                : 'h-2 bg-gray-600 group-hover:bg-gray-400'
                            }`}
                          />
                          {/* Tick label - show only for specific values */}
                          {(value === MIN_FONT_SIZE || value === MAX_FONT_SIZE || value === 16 || value === 20) && (
                            <span
                              className={`text-xs mt-0.5 transition-colors ${
                                value === fontSize ? 'text-blue-400' : 'text-gray-500 group-hover:text-gray-400'
                              }`}
                            >
                              {value}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* Current value and +/- buttons */}
                  <div className="flex items-center gap-1 ml-2">
                    <button
                      onClick={() => handleFontSizeChange(fontSize - 1)}
                      disabled={fontSize <= MIN_FONT_SIZE}
                      className="w-8 h-8 flex items-center justify-center bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-md transition"
                    >
                      <MinusIcon className="w-4 h-4" />
                    </button>
                    <span className="w-12 text-center text-base text-gray-200">{fontSize}px</span>
                    <button
                      onClick={() => handleFontSizeChange(fontSize + 1)}
                      disabled={fontSize >= MAX_FONT_SIZE}
                      className="w-8 h-8 flex items-center justify-center bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-md transition"
                    >
                      <PlusIcon className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Theme Setting */}
              <div>
                <label className="block text-base font-medium text-gray-300 mb-2">
                  {t("settings.theme", "Theme")}
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => handleThemeChange("light")}
                    className={`flex items-center justify-center gap-2 px-4 py-3 rounded-md text-base transition ${
                      theme === "light"
                        ? "bg-blue-600 text-white"
                        : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                    }`}
                  >
                    <SunIcon className="w-5 h-5" />
                    {t("settings.themeLight", "Light")}
                  </button>
                  <button
                    onClick={() => handleThemeChange("dark")}
                    className={`flex items-center justify-center gap-2 px-4 py-3 rounded-md text-base transition ${
                      theme === "dark"
                        ? "bg-blue-600 text-white"
                        : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                    }`}
                  >
                    <MoonIcon className="w-5 h-5" />
                    {t("settings.themeDark", "Dark")}
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === "shortcuts" && (
            <div className="space-y-4">
              {/* Shortcuts List */}
              <div>
                <div className="rounded-lg border border-gray-700 overflow-hidden">
                  <table className="w-full">
                    <thead className="bg-gray-700/50">
                      <tr>
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-400 uppercase">
                          {t("settings.shortcuts.action")}
                        </th>
                        <th className="px-4 py-3 text-right text-sm font-medium text-gray-400 uppercase">
                          {t("settings.shortcuts.shortcut")}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-700">
                      {shortcuts.map((shortcut) => (
                        <tr key={shortcut.id} className="hover:bg-gray-700/30">
                          <td className="px-4 py-3.5 text-base text-gray-300">
                            {t(`settings.shortcuts.${shortcut.id}`)}
                          </td>
                          <td className="px-4 py-3.5 text-right">
                            <div className="flex items-center justify-end gap-1">
                              {shortcut.keys.map((key, idx) => (
                                <span key={idx}>
                                  <kbd className="px-2.5 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm text-gray-300">
                                    {key}
                                  </kbd>
                                  {idx < shortcut.keys.length - 1 && (
                                    <span className="mx-1 text-gray-500">+</span>
                                  )}
                                </span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {activeTab === "ai" && (
            <div className="space-y-6">
              {/* Security notice */}
              <div className="flex items-start gap-3 p-4 bg-blue-900/20 border border-blue-800/30 rounded-lg">
                <LockIcon className="w-5 h-5 text-blue-400 mt-0.5 flex-shrink-0" />
                <p className="text-base text-gray-300">
                  {t("ai.securityNotice", "API keys are encrypted and stored securely on your device. They are never sent externally.")}
                </p>
              </div>

              {/* API Key sections for all providers */}
              {providers.filter(p => p.needsApiKey).map((provider) => {
                const keyState = apiKeys[provider.id];
                const showMaskedValue = keyState.hasStoredKey && !keyState.isEditing && keyState.value === "";
                const displayValue = showMaskedValue ? "••••••••••••••••" : keyState.value;

                return (
                  <div key={provider.id} className="p-4 bg-gray-700/30 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <label className="block text-base font-medium text-gray-300">
                          {provider.label} {t("ai.apiKey")}
                        </label>
                        {provider.apiKeyUrl && (
                          <button
                            onClick={() => openUrl(provider.apiKeyUrl!)}
                            className="text-sm text-blue-400 hover:text-blue-300 underline"
                          >
                            {t("ai.getApiKey", "Get API Key")}
                          </button>
                        )}
                      </div>
                      {keyState.hasStoredKey && !keyState.isEditing && (
                        <span className="flex items-center gap-1.5 text-sm text-green-400">
                          <CheckIcon className="w-4 h-4" />
                          {t("ai.apiKeyStored", "Stored")}
                        </span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <div className="flex-1 relative">
                        <input
                          type={showMaskedValue ? "text" : "password"}
                          value={displayValue}
                          onChange={(e) => {
                            if (showMaskedValue) {
                              // 마스킹 상태에서 입력 시작하면 편집 모드로 전환하고 새 값만 입력
                              const newValue = e.target.value.replace(/•/g, "");
                              setApiKeys(prev => ({
                                ...prev,
                                [provider.id]: { ...prev[provider.id], isEditing: true, value: newValue }
                              }));
                            } else {
                              handleApiKeyChange(provider.id, e.target.value);
                            }
                          }}
                          onFocus={() => {
                            if (showMaskedValue) {
                              // 포커스 시 편집 모드로 전환하고 값 비우기
                              setApiKeys(prev => ({
                                ...prev,
                                [provider.id]: { ...prev[provider.id], isEditing: true, value: "" }
                              }));
                            }
                          }}
                          placeholder={!keyState.hasStoredKey ? t("ai.apiKeyPlaceholder") : ""}
                          className={`w-full bg-gray-700 border border-gray-600 rounded-md px-3 py-2.5 text-base text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500 ${showMaskedValue ? "text-gray-400" : ""}`}
                        />
                        {keyState.isEditing && keyState.hasStoredKey && (
                          <button
                            onClick={() => {
                              setApiKeys(prev => ({
                                ...prev,
                                [provider.id]: { ...prev[provider.id], isEditing: false, value: "" }
                              }));
                            }}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200"
                            title={t("common.cancel")}
                          >
                            <CloseIcon className="w-5 h-5" />
                          </button>
                        )}
                      </div>
                      <button
                        onClick={() => handleSaveApiKey(provider.id)}
                        disabled={!keyState.value.trim() || keyState.isSaving}
                        className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-md text-base transition"
                      >
                        {keyState.isSaving ? "..." : t("common.save")}
                      </button>
                      {(keyState.hasStoredKey || keyState.value.trim()) && (
                        <button
                          onClick={() => handleVerifyApiKey(provider.id)}
                          disabled={keyState.isVerifying}
                          className={`px-4 py-2.5 rounded-md text-base transition ${
                            keyState.verifyStatus === "valid"
                              ? "bg-green-600 hover:bg-green-500"
                              : "bg-gray-600 hover:bg-gray-500"
                          } disabled:cursor-not-allowed`}
                        >
                          {keyState.isVerifying ? (
                            <span className="flex items-center gap-1.5">
                              <SpinnerIcon className="animate-spin w-4 h-4" />
                            </span>
                          ) : keyState.verifyStatus === "valid" ? (
                            <span className="flex items-center gap-1.5">
                              <CheckIcon className="w-4 h-4" />
                              {t("ai.verified", "Verified")}
                            </span>
                          ) : (
                            t("ai.verify", "Verify")
                          )}
                        </button>
                      )}
                    </div>
                    {keyState.status === "error" && (
                      <p className="mt-2 text-base text-red-400">{t("ai.connectionFailed")}</p>
                    )}
                  </div>
                );
              })}

              {/* Ollama Endpoint */}
              <div className="p-4 bg-gray-700/30 rounded-lg">
                <label className="block text-base font-medium text-gray-300 mb-2">
                  {t("ai.ollamaEndpoint")}
                </label>
                <input
                  type="text"
                  value={ollamaEndpoint}
                  onChange={(e) => setOllamaEndpoint(e.target.value)}
                  placeholder={t("ai.ollamaEndpointPlaceholder")}
                  className="w-full bg-gray-700 border border-gray-600 rounded-md px-3 py-2.5 text-base text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <p className="mt-2 text-sm text-gray-500">
                  Ollama does not require an API key.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-700 flex-shrink-0">
          <button
            onClick={onClose}
            className="px-5 py-2.5 bg-gray-700 hover:bg-gray-600 rounded-md text-base transition"
          >
            {t("settings.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
