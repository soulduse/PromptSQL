import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";

interface QueryProgressOverlayProps {
  isExecuting: boolean;
  startTime: number | null;
  onCancel?: () => void;
}

function formatElapsedTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  const pad = (n: number) => n.toString().padStart(2, "0");

  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes % 60)}:${pad(seconds % 60)}`;
  }
  return `${pad(minutes)}:${pad(seconds % 60)}`;
}

export function QueryProgressOverlay({
  isExecuting,
  startTime,
  onCancel,
}: QueryProgressOverlayProps) {
  const { t } = useTranslation();
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (!isExecuting || !startTime) {
      setElapsedMs(0);
      return;
    }

    // Update elapsed time every 100ms for smooth display
    const interval = setInterval(() => {
      setElapsedMs(Date.now() - startTime);
    }, 100);

    return () => clearInterval(interval);
  }, [isExecuting, startTime]);

  if (!isExecuting) return null;

  return (
    <div className="absolute inset-0 bg-gray-900/80 backdrop-blur-sm flex items-center justify-center z-30">
      <div className="bg-gray-800 rounded-lg shadow-xl border border-gray-700 p-6 flex flex-col items-center gap-4 min-w-[280px]">
        {/* Spinner */}
        <div className="relative">
          <div className="w-12 h-12 border-4 border-gray-600 border-t-blue-500 rounded-full animate-spin" />
        </div>

        {/* Text */}
        <div className="text-center">
          <p className="text-white font-medium">{t("query.runningQuery")}</p>
          <p className="text-gray-400 text-sm mt-1">{t("query.waitingForResults")}</p>
        </div>

        {/* Timer */}
        <div className="bg-gray-900 rounded-md px-4 py-2 font-mono text-xl text-white">
          {formatElapsedTime(elapsedMs)}
        </div>

        {/* Progress bar (animated) */}
        <div className="w-full h-1.5 bg-gray-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-blue-500 via-blue-400 to-blue-500 rounded-full animate-progress-indeterminate"
            style={{
              width: "40%",
            }}
          />
        </div>

        {/* Cancel button */}
        {onCancel && (
          <button
            onClick={onCancel}
            className="mt-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md text-sm font-medium transition flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            {t("query.stopQuery")}
          </button>
        )}
      </div>
    </div>
  );
}
