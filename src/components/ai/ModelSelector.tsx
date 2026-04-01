import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAIStore, LLMProvider, ModelInfo } from "../../stores/aiStore";
import { ChevronUpIcon, CheckIcon } from "../common/Icons";

interface ModelGroup {
  provider: LLMProvider;
  label: string;
  models: ModelInfo[];
}

const providerLabels: Record<LLMProvider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Gemini",
  ollama: "Ollama",
};

export default function ModelSelector() {
  const { t } = useTranslation();
  const { model, availableModels, setProviderAndModel, loadAvailableModels } = useAIStore();

  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Load models on mount
  useEffect(() => {
    if (availableModels.length === 0) {
      loadAvailableModels();
    }
  }, [availableModels.length, loadAvailableModels]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Group models by provider
  const providerOrder: LLMProvider[] = ["openai", "anthropic", "gemini", "ollama"];
  const modelGroups: ModelGroup[] = providerOrder
    .map((p) => ({
      provider: p,
      label: providerLabels[p],
      models: availableModels.filter((m) => m.provider === p),
    }))
    .filter((group) => group.models.length > 0);

  // Find current model info
  const currentModel = availableModels.find((m) => m.id === model);
  const displayName = currentModel?.name || model;

  const handleModelSelect = async (selectedModel: ModelInfo) => {
    await setProviderAndModel(selectedModel.provider, selectedModel.id);
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      {/* Dropdown trigger */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 px-2 py-1 text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-700/50 rounded transition-colors"
      >
        <ChevronUpIcon className={`w-3 h-3 transition-transform ${isOpen ? "rotate-180" : ""}`} />
        <span className="font-medium">{displayName}</span>
      </button>

      {/* Dropdown menu - opens upward */}
      {isOpen && (
        <div className="absolute bottom-full left-0 mb-1 w-56 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50 max-h-80 overflow-y-auto">
          {modelGroups.map((group, groupIndex) => (
            <div key={group.provider}>
              {/* Provider header */}
              <div className="px-3 py-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-850 sticky top-0">
                {group.label}
              </div>

              {/* Models */}
              {group.models.map((modelInfo) => (
                <button
                  key={modelInfo.id}
                  onClick={() => handleModelSelect(modelInfo)}
                  className={`w-full px-3 py-2 text-left text-sm transition-colors flex items-center justify-between ${
                    model === modelInfo.id
                      ? "bg-blue-600/20 text-blue-400"
                      : "text-gray-300 hover:bg-gray-700/50"
                  }`}
                >
                  <span>{modelInfo.name}</span>
                  {model === modelInfo.id && (
                    <CheckIcon className="w-4 h-4 text-blue-400" />
                  )}
                </button>
              ))}

              {/* Divider between groups */}
              {groupIndex < modelGroups.length - 1 && (
                <div className="border-t border-gray-700" />
              )}
            </div>
          ))}

          {modelGroups.length === 0 && (
            <div className="px-3 py-4 text-sm text-gray-500 text-center">
              {t("ai.selectModel", "모델을 불러오는 중...")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
