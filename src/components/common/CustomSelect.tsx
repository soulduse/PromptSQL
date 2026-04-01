import { useState, useRef, useEffect, useCallback } from "react";
import { ChevronDownIcon } from "./Icons";

interface SelectOption {
  value: string;
  label: string;
  description?: string;
}

interface SelectOptionGroup {
  label: string;
  options: SelectOption[];
}

interface CustomSelectProps {
  value: string;
  options: SelectOption[] | SelectOptionGroup[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  icon?: React.ReactNode;
  className?: string;
  size?: "sm" | "md";
  onKeyDown?: (e: React.KeyboardEvent) => void;
}

function isOptionGroup(item: SelectOption | SelectOptionGroup): item is SelectOptionGroup {
  return 'options' in item;
}

export function CustomSelect({
  value,
  options,
  onChange,
  placeholder = "Select...",
  disabled = false,
  icon,
  className = "",
  size = "md",
  onKeyDown,
}: CustomSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Flatten options for finding selected
  const allOptions: SelectOption[] = [];
  options.forEach((item) => {
    if (isOptionGroup(item)) {
      allOptions.push(...item.options);
    } else {
      allOptions.push(item);
    }
  });

  const selectedOption = allOptions.find((opt) => opt.value === value);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  // Close on ESC
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
        buttonRef.current?.focus();
      }
    };

    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  const handleSelect = useCallback((optionValue: string) => {
    onChange(optionValue);
    setIsOpen(false);
    buttonRef.current?.focus();
  }, [onChange]);

  const handleButtonKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setIsOpen(!isOpen);
    } else if (e.key === "ArrowDown" && !isOpen) {
      e.preventDefault();
      setIsOpen(true);
    } else if (onKeyDown) {
      onKeyDown(e);
    }
  };

  const sizeClasses = size === "sm"
    ? "px-2 py-1 text-sm"
    : "px-3 py-2 text-sm";

  const optionSizeClasses = size === "sm"
    ? "px-2 py-1.5 text-sm"
    : "px-3 py-2 text-sm";

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        onKeyDown={handleButtonKeyDown}
        disabled={disabled}
        className={`flex items-center gap-2 w-full bg-gray-700 hover:bg-gray-600 border border-gray-600 rounded text-white transition disabled:opacity-50 disabled:cursor-not-allowed ${sizeClasses}`}
      >
        {icon && <span className="text-gray-400">{icon}</span>}
        <span className={`truncate ${selectedOption ? "text-white" : "text-gray-400"}`}>
          {selectedOption?.label || placeholder}
        </span>
        <ChevronDownIcon className={`w-3 h-3 text-gray-400 ml-auto flex-shrink-0 transition ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {isOpen && allOptions.length > 0 && (
        <div className="absolute z-50 mt-1 w-full min-w-[120px] bg-gray-800 border border-gray-600 rounded shadow-lg max-h-60 overflow-auto">
          {options.map((item, index) => {
            if (isOptionGroup(item)) {
              return (
                <div key={`group-${index}-${item.label}`}>
                  <div className="px-2 py-1 text-xs text-gray-500 font-medium bg-gray-900/50 sticky top-0">
                    {item.label}
                  </div>
                  {item.options.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => handleSelect(option.value)}
                      className={`w-full text-left hover:bg-gray-700 transition ${optionSizeClasses} ${
                        value === option.value ? "bg-blue-600/20 text-blue-400" : "text-gray-300"
                      }`}
                    >
                      <div>{option.label}</div>
                      {option.description && (
                        <div className="text-xs text-gray-500 mt-0.5">{option.description}</div>
                      )}
                    </button>
                  ))}
                </div>
              );
            } else {
              return (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => handleSelect(item.value)}
                  className={`w-full text-left hover:bg-gray-700 transition ${optionSizeClasses} ${
                    value === item.value ? "bg-blue-600/20 text-blue-400" : "text-gray-300"
                  }`}
                >
                  <div>{item.label}</div>
                  {item.description && (
                    <div className="text-xs text-gray-500 mt-0.5">{item.description}</div>
                  )}
                </button>
              );
            }
          })}
        </div>
      )}

      {isOpen && allOptions.length === 0 && (
        <div className="absolute z-50 mt-1 w-full bg-gray-800 border border-gray-600 rounded shadow-lg p-3 text-sm text-gray-500 text-center">
          No options available
        </div>
      )}
    </div>
  );
}
