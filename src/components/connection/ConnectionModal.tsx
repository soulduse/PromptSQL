import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";

export interface ConnectionFormData {
  name: string;
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

interface ConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (connection: ConnectionFormData) => void;
  initialData?: ConnectionFormData | null;
  mode?: "create" | "edit";
}

interface ConnectionResult {
  success: boolean;
  message: string;
  connection_id: string | null;
}

const defaultFormData: ConnectionFormData = {
  name: "",
  host: "",
  port: 3306,
  user: "",
  password: "",
  database: "",
};

export function ConnectionModal({ isOpen, onClose, onSave, initialData, mode = "create" }: ConnectionModalProps) {
  const { t } = useTranslation();
  const [form, setForm] = useState<ConnectionFormData>(defaultFormData);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    if (isOpen) {
      if (initialData) {
        setForm(initialData);
      } else {
        setForm(defaultFormData);
      }
      setTestResult(null);
    }
  }, [isOpen, initialData]);

  if (!isOpen) return null;

  const handleChange = (field: keyof ConnectionFormData, value: string | number) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setTestResult(null);
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);

    try {
      const result = await invoke<ConnectionResult>("test_connection", {
        config: {
          host: form.host,
          port: form.port,
          user: form.user,
          password: form.password,
          database: form.database || null,
        },
      });
      setTestResult({ success: result.success, message: result.message });
    } catch (error) {
      setTestResult({ success: false, message: String(error) });
    }

    setTesting(false);
  };

  const handleSave = () => {
    if (!form.name.trim()) {
      setTestResult({ success: false, message: t("connection.nameRequired") });
      return;
    }
    onSave(form);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg w-full max-w-md p-6 shadow-xl">
        <h2 className="text-xl font-bold mb-6">
          {mode === "edit" ? t("connection.edit") : t("connection.new")}
        </h2>

        <div className="space-y-4">
          {/* Connection Name */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Connection Name</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => handleChange("name", e.target.value)}
              placeholder="My Database"
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Host & Port */}
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-sm text-gray-400 mb-1">Host</label>
              <input
                type="text"
                value={form.host}
                onChange={(e) => handleChange("host", e.target.value)}
                placeholder="localhost"
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="w-24">
              <label className="block text-sm text-gray-400 mb-1">Port</label>
              <input
                type="number"
                value={form.port}
                onChange={(e) => handleChange("port", parseInt(e.target.value) || 3306)}
                className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {/* Username */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Username</label>
            <input
              type="text"
              value={form.user}
              onChange={(e) => handleChange("user", e.target.value)}
              placeholder="root"
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Password */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Password</label>
            <input
              type="password"
              value={form.password}
              onChange={(e) => handleChange("password", e.target.value)}
              placeholder={
                mode === "edit"
                  ? t("connection.passwordKeepHint", "Leave blank to keep current password")
                  : "••••••••"
              }
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Database */}
          <div>
            <label className="block text-sm text-gray-400 mb-1">Database (optional)</label>
            <input
              type="text"
              value={form.database}
              onChange={(e) => handleChange("database", e.target.value)}
              placeholder="mydb"
              className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Test Result */}
          {testResult && (
            <div
              className={`p-3 rounded text-sm ${
                testResult.success
                  ? "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-400"
                  : "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-400"
              }`}
            >
              {testResult.message}
            </div>
          )}
        </div>

        {/* Buttons */}
        <div className="flex justify-between mt-6">
          <button
            onClick={handleTest}
            disabled={testing}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm transition disabled:opacity-50"
          >
            {testing ? "Testing..." : "Test Connection"}
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm transition"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm transition"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
