import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useVirtualizer } from "@tanstack/react-virtual";
import { QueryResult, ColumnInfo, ContentSortState } from "../../stores/tabStore";
import { RowErrorModal } from "./RowErrorModal";
import { DeleteRowModal } from "./DeleteRowModal";
import { DeleteRowsConfirmModal } from "./DeleteRowsConfirmModal";
import { CellDetailModal } from "./CellDetailModal";
import { RowContextMenu } from "./RowContextMenu";
import { ChevronDownIcon, ChevronUpIcon, CloseIcon, InboxIcon, PlusIcon, MinusIcon, RefreshIcon } from "../common/Icons";
import { Row } from "../../utils/copyUtils";

const MAX_DISPLAY_CHARS = 200;
const DEFAULT_COLUMN_WIDTH = 150;
const MIN_COLUMN_WIDTH = 80;
const MAX_COLUMN_WIDTH = 500;
const ROW_HEIGHT = 36; // Fixed row height for virtualization

type FilterOperator = '=' | '!=' | 'LIKE' | '>' | '<' | '>=' | '<=' | 'IS NULL' | 'IS NOT NULL';

interface FilterState {
  column: string;
  operator: FilterOperator;
  value: string;
}

interface ContentViewProps {
  content: QueryResult | null;
  loading: boolean;
  totalRows: number;
  tableName: string | null;
  tableStructure: ColumnInfo[] | null;
  onCellUpdate?: (
    columnIndex: number,
    newValue: string | null,
    originalRow: (string | number | boolean | null)[]
  ) => Promise<{ success: boolean; error?: string }>;
  onInsertRow?: (
    values: (string | null)[],
    columns: string[]
  ) => Promise<{ success: boolean; error?: string }>;
  onDeleteRow?: (
    rowData: (string | number | boolean | null)[],
    columns: string[]
  ) => Promise<{ success: boolean; error?: string }>;
  onBuildDeleteQuery?: (
    rowData: (string | number | boolean | null)[],
    columns: string[]
  ) => string | null;
  onRefresh?: () => void;
  onFilter?: (filter: FilterState | null) => void;
  // Sort props
  sortState?: ContentSortState | null;
  onSort?: (columnIndex: number, columnName: string) => void;
}

interface EditingCell {
  rowIndex: number;
  cellIndex: number;
  value: string;
  originalRow: (string | number | boolean | null)[];
}

interface NewRowState {
  values: (string | null)[];
  editingCellIndex: number | null;
}

function formatNumber(num: number): string {
  return num.toLocaleString();
}

const FILTER_OPERATORS: { value: FilterOperator; label: string }[] = [
  { value: '=', label: '=' },
  { value: '!=', label: '!=' },
  { value: 'LIKE', label: 'LIKE' },
  { value: '>', label: '>' },
  { value: '<', label: '<' },
  { value: '>=', label: '>=' },
  { value: '<=', label: '<=' },
  { value: 'IS NULL', label: 'IS NULL' },
  { value: 'IS NOT NULL', label: 'IS NOT NULL' },
];

export function ContentView({
  content,
  loading,
  totalRows,
  tableName,
  tableStructure: _tableStructure,
  onCellUpdate,
  onInsertRow,
  onDeleteRow,
  onBuildDeleteQuery,
  onRefresh,
  onFilter,
  sortState,
  onSort,
}: ContentViewProps) {
  const { t } = useTranslation();
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Multi-selection state
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [lastClickedRow, setLastClickedRow] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartRow, setDragStartRow] = useState<number | null>(null);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const newRowInputRef = useRef<HTMLInputElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  // Filter state
  const [filterColumn, setFilterColumn] = useState<string>("");
  const [filterOperator, setFilterOperator] = useState<FilterOperator>("=");
  const [filterValue, setFilterValue] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterState | null>(null);

  // New row state
  const [newRow, setNewRow] = useState<NewRowState | null>(null);
  const [isInserting, setIsInserting] = useState(false);

  // Error modal state
  const [errorModal, setErrorModal] = useState<{
    isOpen: boolean;
    error: string;
    type: 'update' | 'insert';
  }>({ isOpen: false, error: '', type: 'update' });

  // Delete modal state
  const [deleteModal, setDeleteModal] = useState<{
    isOpen: boolean;
    rowData: (string | number | boolean | null)[];
    deleteQuery: string;
  }>({ isOpen: false, rowData: [], deleteQuery: '' });

  // Multi-row delete modal state
  const [multiDeleteModal, setMultiDeleteModal] = useState<{
    isOpen: boolean;
    rowsToDelete: Row[];
  }>({ isOpen: false, rowsToDelete: [] });

  // Filter dropdown states
  const [isColumnDropdownOpen, setIsColumnDropdownOpen] = useState(false);
  const [isOperatorDropdownOpen, setIsOperatorDropdownOpen] = useState(false);

  // Column resize state
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [resizingColumn, setResizingColumn] = useState<string | null>(null);
  const resizeStartRef = useRef({ x: 0, width: 0 });

  // Virtual scroll container ref
  const parentRef = useRef<HTMLDivElement>(null);

  // Virtual row renderer
  const rowVirtualizer = useVirtualizer({
    count: content?.rows.length || 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  // Memoize total table width
  const totalWidth = useMemo(() => {
    if (!content) return 0;
    return content.columns.reduce((acc, col) => acc + (columnWidths[col] || DEFAULT_COLUMN_WIDTH), 0);
  }, [content?.columns, columnWidths]);

  // Cell detail modal state
  const [cellDetailModal, setCellDetailModal] = useState<{
    isOpen: boolean;
    columnName: string;
    columnType: string;
    value: string | number | boolean | null;
    rowIndex: number;
    cellIndex: number;
    originalRow: (string | number | boolean | null)[];
  } | null>(null);

  // Focus input when editing starts (only when cell position changes, not value)
  useEffect(() => {
    if (editingCell && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingCell?.rowIndex, editingCell?.cellIndex]);

  // Focus new row input when editing cell changes
  useEffect(() => {
    if (newRow?.editingCellIndex !== null && newRowInputRef.current) {
      newRowInputRef.current.focus();
    }
  }, [newRow?.editingCellIndex]);

  // Reset filter column when content changes
  useEffect(() => {
    if (content?.columns.length && !filterColumn) {
      setFilterColumn(content.columns[0]);
    }
  }, [content?.columns, filterColumn]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.filter-dropdown')) {
        setIsColumnDropdownOpen(false);
        setIsOperatorDropdownOpen(false);
      }
    };

    if (isColumnDropdownOpen || isOperatorDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isColumnDropdownOpen, isOperatorDropdownOpen]);

  // Handle click outside new row to trigger insert
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (newRow && tableRef.current && !tableRef.current.contains(e.target as Node)) {
        handleInsertNewRow();
      }
    };

    if (newRow) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newRow]);

  // Column resize handlers
  const handleResizeStart = useCallback((e: React.MouseEvent, columnName: string) => {
    e.preventDefault();
    e.stopPropagation();
    const currentWidth = columnWidths[columnName] || DEFAULT_COLUMN_WIDTH;
    setResizingColumn(columnName);
    resizeStartRef.current = { x: e.clientX, width: currentWidth };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [columnWidths]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!resizingColumn) return;
      const delta = e.clientX - resizeStartRef.current.x;
      const newWidth = Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, resizeStartRef.current.width + delta));
      setColumnWidths(prev => ({ ...prev, [resizingColumn]: newWidth }));
    };

    const handleMouseUp = () => {
      if (resizingColumn) {
        setResizingColumn(null);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };

    if (resizingColumn) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizingColumn]);

  // Truncate text based on column width
  const getTruncatedValue = useCallback((value: string | number | boolean | null, columnWidth: number): string => {
    if (value === null) return "";
    const str = String(value);
    // Approximate characters per pixel (monospace ~7px per char)
    const estimatedChars = Math.floor(columnWidth / 7);
    const limit = Math.min(estimatedChars, MAX_DISPLAY_CHARS);

    if (str.length <= limit) return str;
    return str.substring(0, limit);
  }, []);

  // Check if text is truncated
  const isTextTruncated = useCallback((value: string | number | boolean | null, columnWidth: number): boolean => {
    if (value === null) return false;
    const str = String(value);
    const estimatedChars = Math.floor(columnWidth / 7);
    const limit = Math.min(estimatedChars, MAX_DISPLAY_CHARS);
    return str.length > limit;
  }, []);

  // Open cell detail modal
  const handleCellDetailOpen = useCallback((
    rowIndex: number,
    cellIndex: number,
    cell: string | number | boolean | null,
    row: (string | number | boolean | null)[]
  ) => {
    if (!content) return;
    setCellDetailModal({
      isOpen: true,
      columnName: content.columns[cellIndex],
      columnType: content.column_types?.[cellIndex] || "unknown",
      value: cell,
      rowIndex,
      cellIndex,
      originalRow: [...row],
    });
  }, [content]);

  const handleSave = async () => {
    if (!editingCell || !onCellUpdate || isSaving) return;

    const originalValue = editingCell.originalRow[editingCell.cellIndex];
    const originalStr = originalValue === null ? "" : String(originalValue);

    // Skip if value hasn't changed
    if (editingCell.value === originalStr) {
      setEditingCell(null);
      return;
    }

    setIsSaving(true);
    const newValue = editingCell.value.trim() === "" ? null : editingCell.value;

    const result = await onCellUpdate(
      editingCell.cellIndex,
      newValue,
      editingCell.originalRow
    );

    setIsSaving(false);

    if (result.success) {
      setEditingCell(null);
    } else {
      // Show error modal
      setErrorModal({
        isOpen: true,
        error: result.error || "Update failed",
        type: 'update',
      });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSave();
    } else if (e.key === "Escape") {
      setEditingCell(null);
    }
  };

  const handleBlur = () => {
    if (!isSaving) {
      handleSave();
    }
  };

  // Filter handlers
  const handleApplyFilter = () => {
    if (!filterColumn) return;

    const filter: FilterState = {
      column: filterColumn,
      operator: filterOperator,
      value: filterValue,
    };

    setActiveFilter(filter);
    onFilter?.(filter);
  };

  const handleClearFilter = () => {
    setActiveFilter(null);
    setFilterValue("");
    onFilter?.(null);
  };

  // Multi-selection helper functions
  const getRowRange = useCallback((start: number, end: number): number[] => {
    const min = Math.min(start, end);
    const max = Math.max(start, end);
    return Array.from({ length: max - min + 1 }, (_, i) => min + i);
  }, []);

  const getSelectedRowsData = useCallback(() => {
    if (!content) return [];
    return Array.from(selectedRows)
      .sort((a, b) => a - b)
      .filter((idx) => idx < content.rows.length)
      .map((idx) => content.rows[idx]);
  }, [content, selectedRows]);

  // Drag selection - global mouse up handler
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (isDragging) {
        setIsDragging(false);
      }
    };

    document.addEventListener("mouseup", handleGlobalMouseUp);
    return () => document.removeEventListener("mouseup", handleGlobalMouseUp);
  }, [isDragging]);

  // New row handlers
  const handleAddRow = () => {
    if (newRow || !content) return;

    const emptyRow = content.columns.map(() => null);
    setNewRow({
      values: emptyRow,
      editingCellIndex: 0,
    });
    setSelectedRows(new Set());
  };

  const handleNewRowCellClick = (cellIndex: number) => {
    if (!newRow) return;
    setNewRow({
      ...newRow,
      editingCellIndex: cellIndex,
    });
  };

  const handleNewRowCellChange = (cellIndex: number, value: string) => {
    if (!newRow) return;
    const newValues = [...newRow.values];
    newValues[cellIndex] = value === "" ? null : value;
    setNewRow({
      ...newRow,
      values: newValues,
    });
  };

  const handleNewRowKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, cellIndex: number) => {
    if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      if (content && cellIndex < content.columns.length - 1) {
        // Move to next cell
        setNewRow({
          ...newRow!,
          editingCellIndex: cellIndex + 1,
        });
      } else {
        // Last cell - trigger insert
        handleInsertNewRow();
      }
    } else if (e.key === "Tab" && e.shiftKey) {
      e.preventDefault();
      if (cellIndex > 0) {
        setNewRow({
          ...newRow!,
          editingCellIndex: cellIndex - 1,
        });
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      handleInsertNewRow();
    } else if (e.key === "Escape") {
      setNewRow(null);
    }
  };

  const handleInsertNewRow = async () => {
    if (!newRow || !onInsertRow || !content || isInserting) return;

    // Check if all values are null/empty - skip insert
    const hasValue = newRow.values.some(v => v !== null && v !== "");
    if (!hasValue) {
      setNewRow(null);
      return;
    }

    setIsInserting(true);
    const result = await onInsertRow(newRow.values, content.columns);
    setIsInserting(false);

    if (result.success) {
      setNewRow(null);
    } else {
      setErrorModal({
        isOpen: true,
        error: result.error || "Insert failed",
        type: 'insert',
      });
    }
  };

  // Delete handlers (currently supports single row delete - first selected row)
  const handleDeleteClick = () => {
    if (selectedRows.size === 0 || !content || !onBuildDeleteQuery) return;

    // Get the first selected row for deletion
    const firstSelectedIndex = Array.from(selectedRows).sort((a, b) => a - b)[0];
    const rowData = content.rows[firstSelectedIndex];
    const deleteQuery = onBuildDeleteQuery(rowData, content.columns);

    if (!deleteQuery) return;

    setDeleteModal({
      isOpen: true,
      rowData,
      deleteQuery,
    });
  };

  const handleConfirmDelete = async () => {
    if (!onDeleteRow || !content) return;

    const result = await onDeleteRow(deleteModal.rowData, content.columns);

    if (result.success) {
      setDeleteModal({ isOpen: false, rowData: [], deleteQuery: '' });
      setSelectedRows(new Set());
    } else {
      setDeleteModal({ isOpen: false, rowData: [], deleteQuery: '' });
      setErrorModal({
        isOpen: true,
        error: result.error || "Delete failed",
        type: 'update',
      });
    }
  };

  // Multi-row delete handlers (from context menu)
  const handleMultiDeleteRequest = useCallback(() => {
    if (!content || selectedRows.size === 0) return;
    const rowsData = getSelectedRowsData();
    setMultiDeleteModal({ isOpen: true, rowsToDelete: rowsData });
    setContextMenu(null);
  }, [content, selectedRows, getSelectedRowsData]);

  const handleConfirmMultiDelete = async () => {
    if (!onDeleteRow || !content) return;

    let successCount = 0;
    let lastError = '';

    for (const rowData of multiDeleteModal.rowsToDelete) {
      const result = await onDeleteRow(rowData, content.columns);
      if (result.success) {
        successCount++;
      } else {
        lastError = result.error || "Delete failed";
      }
    }

    setMultiDeleteModal({ isOpen: false, rowsToDelete: [] });
    setSelectedRows(new Set());

    if (successCount < multiDeleteModal.rowsToDelete.length) {
      setErrorModal({
        isOpen: true,
        error: lastError || `Failed to delete some rows. ${successCount}/${multiDeleteModal.rowsToDelete.length} deleted.`,
        type: 'update',
      });
    }
  };

  // Row click handler - supports multi-selection
  const handleRowClick = useCallback(
    (rowIndex: number, e: React.MouseEvent) => {
      // Close context menu
      setContextMenu(null);

      // If new row exists, insert first
      if (newRow) {
        handleInsertNewRow();
      }

      const isCtrlOrCmd = e.ctrlKey || e.metaKey;
      const isShift = e.shiftKey;

      if (isShift && lastClickedRow !== null) {
        // Shift+Click: Select range from lastClickedRow to clicked row
        const rangeIndices = getRowRange(lastClickedRow, rowIndex);
        if (isCtrlOrCmd) {
          // Add to existing selection
          setSelectedRows((prev) => new Set([...prev, ...rangeIndices]));
        } else {
          // Replace selection with range
          setSelectedRows(new Set(rangeIndices));
        }
      } else if (isCtrlOrCmd) {
        // Ctrl/Cmd+Click: Toggle individual row
        setSelectedRows((prev) => {
          const next = new Set(prev);
          if (next.has(rowIndex)) {
            next.delete(rowIndex);
          } else {
            next.add(rowIndex);
          }
          return next;
        });
        setLastClickedRow(rowIndex);
      } else {
        // Normal click: Select single row
        setSelectedRows(new Set([rowIndex]));
        setLastClickedRow(rowIndex);
      }
    },
    [lastClickedRow, newRow, getRowRange]
  );

  // Row mouse down handler - for drag selection
  const handleRowMouseDown = useCallback(
    (rowIndex: number, e: React.MouseEvent) => {
      // Only left mouse button and not using modifiers
      if (e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        setIsDragging(true);
        setDragStartRow(rowIndex);
        setSelectedRows(new Set([rowIndex]));
        setLastClickedRow(rowIndex);
      }
    },
    []
  );

  // Row mouse enter handler - during drag
  const handleRowMouseEnter = useCallback(
    (rowIndex: number) => {
      if (isDragging && dragStartRow !== null) {
        const rangeIndices = getRowRange(dragStartRow, rowIndex);
        setSelectedRows(new Set(rangeIndices));
      }
    },
    [isDragging, dragStartRow, getRowRange]
  );

  // Context menu handler
  const handleContextMenu = useCallback(
    (e: React.MouseEvent, rowIndex: number) => {
      e.preventDefault();

      // If right-clicked row is not selected, select it alone
      if (!selectedRows.has(rowIndex)) {
        setSelectedRows(new Set([rowIndex]));
        setLastClickedRow(rowIndex);
      }

      setContextMenu({ x: e.clientX, y: e.clientY });
    },
    [selectedRows]
  );

  // Keyboard handler for Cmd+A (select all rows)
  const handleTableKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
        e.preventDefault();
        if (content?.rows.length) {
          setSelectedRows(new Set(content.rows.map((_, i) => i)));
        }
      }
    },
    [content?.rows.length]
  );

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500">
        {t("common.loading")}
      </div>
    );
  }

  if (!content) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500">
        {t("tableView.noContent")}
      </div>
    );
  }

  const displayedRows = content.rows.length;
  const rowStart = displayedRows > 0 ? 1 : 0;
  const rowEnd = displayedRows;
  const isEmpty = content.rows.length === 0 && !newRow;
  const needsValueInput = filterOperator !== 'IS NULL' && filterOperator !== 'IS NOT NULL';

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Filter Bar */}
      <div className="h-10 bg-gray-800 border-b border-gray-700 flex items-center px-4 gap-2 flex-shrink-0">
        {/* Column Select - Custom Dropdown */}
        <div className="relative filter-dropdown">
          <button
            onClick={() => {
              setIsColumnDropdownOpen(!isColumnDropdownOpen);
              setIsOperatorDropdownOpen(false);
            }}
            className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 border border-gray-600 rounded px-3 py-1.5 text-sm transition min-w-[140px]"
          >
            <span className="text-gray-200 truncate flex-1 text-left">
              {filterColumn || content.columns[0]}
            </span>
            <ChevronDownIcon className={`w-3 h-3 text-gray-400 transition flex-shrink-0 ${isColumnDropdownOpen ? "rotate-180" : ""}`} />
          </button>
          {isColumnDropdownOpen && (
            <div className="absolute z-50 mt-1 w-full bg-gray-800 border border-gray-600 rounded shadow-lg max-h-60 overflow-auto">
              {content.columns.map((col) => (
                <button
                  key={col}
                  onClick={() => {
                    setFilterColumn(col);
                    setIsColumnDropdownOpen(false);
                  }}
                  className={`w-full px-3 py-1.5 text-sm text-left hover:bg-gray-700 transition ${
                    filterColumn === col ? "bg-blue-600/20 text-blue-400" : "text-gray-300"
                  }`}
                >
                  {col}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Operator Select - Custom Dropdown */}
        <div className="relative filter-dropdown">
          <button
            onClick={() => {
              setIsOperatorDropdownOpen(!isOperatorDropdownOpen);
              setIsColumnDropdownOpen(false);
            }}
            className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 border border-gray-600 rounded px-3 py-1.5 text-sm transition min-w-[100px]"
          >
            <span className="text-gray-200 flex-1 text-left">
              {filterOperator}
            </span>
            <ChevronDownIcon className={`w-3 h-3 text-gray-400 transition flex-shrink-0 ${isOperatorDropdownOpen ? "rotate-180" : ""}`} />
          </button>
          {isOperatorDropdownOpen && (
            <div className="absolute z-50 mt-1 w-full bg-gray-800 border border-gray-600 rounded shadow-lg max-h-60 overflow-auto">
              {FILTER_OPERATORS.map((op) => (
                <button
                  key={op.value}
                  onClick={() => {
                    setFilterOperator(op.value);
                    setIsOperatorDropdownOpen(false);
                  }}
                  className={`w-full px-3 py-1.5 text-sm text-left hover:bg-gray-700 transition ${
                    filterOperator === op.value ? "bg-blue-600/20 text-blue-400" : "text-gray-300"
                  }`}
                >
                  {op.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Value Input */}
        {needsValueInput && (
          <input
            type="text"
            value={filterValue}
            onChange={(e) => setFilterValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleApplyFilter()}
            placeholder={t("tableView.filterValue")}
            className="h-[30px] w-40 px-3 bg-gray-700 border border-gray-600 rounded text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        )}

        {/* Filter Button */}
        <button
          onClick={handleApplyFilter}
          className="h-[30px] px-3 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded transition"
        >
          {t("tableView.filter")}
        </button>

        {/* Clear Filter */}
        {activeFilter && (
          <button
            onClick={handleClearFilter}
            className="h-[30px] px-2 text-gray-400 hover:text-white transition flex items-center gap-1"
          >
            <CloseIcon className="w-4 h-4" />
            <span className="text-xs">{t("tableView.clearFilter")}</span>
          </button>
        )}

        {/* Active Filter Indicator */}
        {activeFilter && (
          <span className="ml-2 text-xs text-blue-400">
            {activeFilter.column} {activeFilter.operator} {needsValueInput ? `'${activeFilter.value}'` : ''}
          </span>
        )}
      </div>

      {/* Data Table */}
      <div ref={tableRef} className="flex-1 flex flex-col overflow-hidden">
        {isEmpty ? (
          <div className="flex-1 flex flex-col items-center justify-center h-full text-gray-500 py-20">
            <InboxIcon className="w-16 h-16 mb-4 text-gray-600" />
            <p className="text-lg font-medium mb-1">{t("tableView.emptyTable")}</p>
            <p className="text-sm text-gray-600">{t("tableView.emptyTableDesc")}</p>
          </div>
        ) : (
          <div
            ref={parentRef}
            tabIndex={0}
            onKeyDown={handleTableKeyDown}
            className="flex-1 overflow-auto outline-none"
            style={{ contain: 'strict' }}
          >
            <div style={{ width: `${totalWidth}px`, minWidth: '100%' }}>
              {/* Fixed Header */}
              <div className="sticky top-0 z-10 bg-gray-800 border-b-2 border-gray-600">
                <div className="flex">
                  {content.columns.map((col, i) => {
                    const width = columnWidths[col] || DEFAULT_COLUMN_WIDTH;
                    const isSorted = sortState?.columnIndex === i;
                    return (
                      <div
                        key={i}
                        className="relative text-left px-4 py-2 font-medium whitespace-nowrap border-r border-gray-600 select-none text-sm flex-shrink-0 cursor-pointer hover:bg-gray-700/30 transition-colors"
                        style={{ width: `${width}px`, minWidth: `${MIN_COLUMN_WIDTH}px`, maxWidth: `${MAX_COLUMN_WIDTH}px` }}
                        onClick={() => onSort?.(i, col)}
                      >
                        <div className="flex items-center gap-1.5 pr-2">
                          <span className="text-gray-200 truncate">{col}</span>
                          {content.column_types?.[i] && (
                            <span className="text-[10px] text-gray-500 font-normal uppercase flex-shrink-0">
                              {content.column_types[i]}
                            </span>
                          )}
                          {/* Sort indicator */}
                          {isSorted && sortState?.direction && (
                            sortState.direction === 'asc'
                              ? <ChevronUpIcon className="w-3 h-3 text-blue-400 flex-shrink-0" />
                              : <ChevronDownIcon className="w-3 h-3 text-blue-400 flex-shrink-0" />
                          )}
                        </div>
                        {/* Resize handle */}
                        <div
                          className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 transition-colors ${
                            resizingColumn === col ? 'bg-blue-500' : ''
                          }`}
                          onMouseDown={(e) => handleResizeStart(e, col)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Virtualized Body */}
              <div
                className="select-none"
                style={{
                  height: `${rowVirtualizer.getTotalSize() + (newRow ? ROW_HEIGHT : 0)}px`,
                  width: '100%',
                  position: 'relative',
                }}
              >
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const rowIndex = virtualRow.index;
                  const row = content.rows[rowIndex];
                  const isSelected = selectedRows.has(rowIndex);

                  return (
                    <div
                      key={virtualRow.key}
                      data-index={rowIndex}
                      onClick={(e) => handleRowClick(rowIndex, e)}
                      onMouseDown={(e) => handleRowMouseDown(rowIndex, e)}
                      onMouseEnter={() => handleRowMouseEnter(rowIndex)}
                      onContextMenu={(e) => handleContextMenu(e, rowIndex)}
                      className={`flex border-b border-gray-800 cursor-pointer text-sm ${
                        isSelected
                          ? "bg-blue-600 text-white"
                          : "hover:bg-gray-800/50"
                      }`}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: `${virtualRow.size}px`,
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                    >
                      {row.map((cell, cellIndex) => {
                        const isEditing =
                          editingCell?.rowIndex === rowIndex &&
                          editingCell?.cellIndex === cellIndex;
                        const colName = content.columns[cellIndex];
                        const width = columnWidths[colName] || DEFAULT_COLUMN_WIDTH;
                        const truncated = isTextTruncated(cell, width);
                        const displayValue = getTruncatedValue(cell, width);

                        return (
                          <div
                            key={cellIndex}
                            className={`px-4 py-2 whitespace-nowrap border-r border-gray-800/50 flex-shrink-0 ${
                              isSelected ? "text-white" : "text-gray-300"
                            }`}
                            style={{
                              width: `${width}px`,
                              maxWidth: `${width}px`,
                              overflow: 'hidden',
                            }}
                            title={isEditing ? undefined : (cell === null ? "NULL" : String(cell))}
                            onDoubleClick={() => handleCellDetailOpen(rowIndex, cellIndex, cell, row)}
                          >
                            {isEditing ? (
                              <input
                                ref={inputRef}
                                type="text"
                                value={editingCell.value}
                                onChange={(e) =>
                                  setEditingCell({ ...editingCell, value: e.target.value })
                                }
                                onKeyDown={handleKeyDown}
                                onBlur={handleBlur}
                                disabled={isSaving}
                                className="w-full min-w-[100px] px-1 py-0.5 bg-gray-700 border border-blue-500 rounded text-gray-200 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                              />
                            ) : cell === null ? (
                              <span className={isSelected ? "italic opacity-70" : "text-gray-500 italic"}>NULL</span>
                            ) : (
                              <span>
                                {displayValue}
                                {truncated && <span className="text-gray-500">...</span>}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}

                {/* New Row - at the bottom */}
                {newRow && (
                  <div
                    className="flex border-b border-gray-800 bg-green-900/20 text-sm"
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: `${ROW_HEIGHT}px`,
                      transform: `translateY(${rowVirtualizer.getTotalSize()}px)`,
                    }}
                  >
                    {content.columns.map((col, cellIndex) => {
                      const isEditing = newRow.editingCellIndex === cellIndex;
                      const cellValue = newRow.values[cellIndex];
                      const width = columnWidths[col] || DEFAULT_COLUMN_WIDTH;

                      return (
                        <div
                          key={cellIndex}
                          className="px-4 py-2 whitespace-nowrap text-gray-300 flex-shrink-0"
                          style={{
                            width: `${width}px`,
                            maxWidth: `${width}px`,
                            overflow: 'hidden',
                          }}
                          onClick={() => handleNewRowCellClick(cellIndex)}
                        >
                          {isEditing ? (
                            <input
                              ref={newRowInputRef}
                              type="text"
                              value={cellValue ?? ""}
                              onChange={(e) => handleNewRowCellChange(cellIndex, e.target.value)}
                              onKeyDown={(e) => handleNewRowKeyDown(e, cellIndex)}
                              disabled={isInserting}
                              className="w-full min-w-[100px] px-1 py-0.5 bg-gray-700 border border-green-500 rounded text-gray-200 text-sm focus:outline-none focus:ring-1 focus:ring-green-500"
                              placeholder="NULL"
                            />
                          ) : cellValue === null ? (
                            <span className="text-gray-500 italic cursor-pointer">NULL</span>
                          ) : (
                            <span className="cursor-pointer">{cellValue}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Toolbar */}
      <div className="h-10 bg-gray-800 border-t border-gray-700 flex items-center px-4 gap-2 flex-shrink-0">
        {/* Add Row Button */}
        <button
          onClick={handleAddRow}
          disabled={!onInsertRow || newRow !== null}
          className="p-1.5 rounded hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
          title={t("tableView.addRow")}
        >
          <PlusIcon className="w-4 h-4 text-gray-400" />
        </button>

        {/* Delete Row Button */}
        <button
          onClick={handleDeleteClick}
          disabled={!onDeleteRow || selectedRows.size === 0 || newRow !== null}
          className="p-1.5 rounded hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
          title={t("tableView.deleteRow")}
        >
          <MinusIcon className="w-4 h-4 text-gray-400" />
        </button>

        {/* Refresh Button */}
        <button
          onClick={onRefresh}
          disabled={!onRefresh}
          className="p-1.5 rounded hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
          title={t("tableView.refresh")}
        >
          <RefreshIcon className="w-4 h-4 text-gray-400" />
        </button>

        {/* Row Count */}
        <span className="ml-auto text-xs text-gray-400">
          {t("tableView.rowsDisplay", {
            start: formatNumber(rowStart),
            end: formatNumber(rowEnd),
            total: formatNumber(totalRows),
            table: tableName || "",
          })}
        </span>
      </div>

      {/* Error Modal */}
      <RowErrorModal
        isOpen={errorModal.isOpen}
        error={errorModal.error}
        onEdit={() => setErrorModal({ ...errorModal, isOpen: false })}
        onDiscard={() => {
          setErrorModal({ ...errorModal, isOpen: false });
          if (errorModal.type === 'insert') {
            setNewRow(null);
          } else {
            setEditingCell(null);
          }
        }}
      />

      {/* Delete Confirmation Modal */}
      {content && (
        <DeleteRowModal
          isOpen={deleteModal.isOpen}
          rowData={deleteModal.rowData}
          columns={content.columns}
          deleteQuery={deleteModal.deleteQuery}
          onConfirm={handleConfirmDelete}
          onCancel={() => setDeleteModal({ isOpen: false, rowData: [], deleteQuery: '' })}
        />
      )}

      {/* Cell Detail Modal */}
      {cellDetailModal && (
        <CellDetailModal
          isOpen={cellDetailModal.isOpen}
          columnName={cellDetailModal.columnName}
          columnType={cellDetailModal.columnType}
          value={cellDetailModal.value}
          editable={!!onCellUpdate}
          onClose={() => setCellDetailModal(null)}
          onSave={async (newValue) => {
            if (onCellUpdate && cellDetailModal) {
              const result = await onCellUpdate(
                cellDetailModal.cellIndex,
                newValue,
                cellDetailModal.originalRow
              );
              if (result.success) {
                setCellDetailModal(null);
              } else {
                setErrorModal({
                  isOpen: true,
                  error: result.error || "Update failed",
                  type: 'update',
                });
              }
            }
          }}
        />
      )}

      {/* Row Context Menu */}
      {contextMenu && content && (
        <RowContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          selectedRows={getSelectedRowsData()}
          columns={content.columns}
          tableName={tableName || undefined}
          tableStructure={_tableStructure}
          onClose={() => setContextMenu(null)}
          onDelete={handleMultiDeleteRequest}
          canDelete={!!onDeleteRow}
        />
      )}

      {/* Multi-row Delete Confirmation Modal */}
      <DeleteRowsConfirmModal
        isOpen={multiDeleteModal.isOpen}
        rowCount={multiDeleteModal.rowsToDelete.length}
        tableName={tableName || "table"}
        sampleRows={multiDeleteModal.rowsToDelete}
        columns={content?.columns || []}
        onConfirm={handleConfirmMultiDelete}
        onCancel={() => setMultiDeleteModal({ isOpen: false, rowsToDelete: [] })}
      />
    </div>
  );
}
