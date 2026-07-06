import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import Editor from "@monaco-editor/react";
import { CheckIcon, CopyIcon } from "../common/Icons";
import { Modal } from "../common/Modal";

interface CreateTableSyntaxModalProps {
  isOpen: boolean;
  tableName: string;
  connectionId: string;
  database: string;
  onClose: () => void;
}

export function CreateTableSyntaxModal({
  isOpen,
  tableName,
  connectionId,
  database,
  onClose,
}: CreateTableSyntaxModalProps) {
  const { t } = useTranslation();
  const [sql, setSql] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editorTheme, setEditorTheme] = useState<'vs-dark' | 'vs'>(() =>
    document.documentElement.classList.contains('dark') ? 'vs-dark' : 'vs'
  );

  // Observe theme changes
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setEditorTheme(document.documentElement.classList.contains('dark') ? 'vs-dark' : 'vs');
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (isOpen && tableName) {
      fetchCreateTable();
    }
  }, [isOpen, tableName]);

  const fetchCreateTable = async () => {
    setIsLoading(true);
    try {
      const result = await invoke<string>("get_create_table", {
        connectionId,
        database,
        table: tableName,
      });
      setSql(result);
    } catch (error) {
      console.error("Failed to fetch CREATE TABLE:", error);
      setSql(`-- Error fetching CREATE TABLE syntax\n-- ${error}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(sql);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="3xl"
      panelClassName="max-h-[80vh] flex flex-col"
    >
      <div className="px-6 py-4 border-b border-gray-700 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">
          {t("tableMenu.createTableTitle")} - {tableName}
        </h3>
        <button
          onClick={handleCopy}
          className="flex items-center gap-2 px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-md transition"
        >
          {copied ? (
            <>
              <CheckIcon className="w-4 h-4 text-green-400" />
              {t("common.copied")}
            </>
          ) : (
            <>
              <CopyIcon className="w-4 h-4" />
              {t("common.copy")}
            </>
          )}
        </button>
      </div>

      <div className="flex-1 min-h-[300px] overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-gray-500">
            <div className="inline-block animate-spin w-5 h-5 border-2 border-gray-500 border-t-transparent rounded-full mr-2" />
            {t("common.loading")}
          </div>
        ) : (
          <Editor
            height="100%"
            defaultLanguage="sql"
            value={sql}
            theme={editorTheme}
            options={{
              readOnly: true,
              minimap: { enabled: false },
              fontSize: 13,
              lineNumbers: "on",
              scrollBeyondLastLine: false,
              wordWrap: "on",
              padding: { top: 10, bottom: 10 },
            }}
          />
        )}
      </div>

      <div className="px-6 py-4 border-t border-gray-700 flex justify-end">
        <button
          onClick={onClose}
          className="px-4 py-2 text-sm text-gray-300 hover:text-white bg-gray-700 hover:bg-gray-600 rounded-md transition"
        >
          {t("common.close")}
        </button>
      </div>
    </Modal>
  );
}
