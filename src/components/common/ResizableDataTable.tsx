import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useSortedRows, SortState, SortDirection } from "../../hooks/useSortedRows";
import { ChevronUpIcon, ChevronDownIcon } from "./Icons";
import { RowContextMenu } from "../table/RowContextMenu";
import { DeleteRowsConfirmModal } from "../table/DeleteRowsConfirmModal";
import { Row } from "../../utils/copyUtils";

const MAX_DISPLAY_CHARS = 200;
const ROW_HEIGHT = 36; // Fixed row height for virtualization
const DEFAULT_COLUMN_WIDTH = 150;
const MIN_COLUMN_WIDTH = 80;
const MAX_COLUMN_WIDTH = 500;

export interface ResizableDataTableProps {
  columns: string[];
  columnTypes?: string[];
  columnTables?: string[];
  rows: (string | number | boolean | null)[][];
  showColumnTypes?: boolean;
  onCellUpdate?: (
    rowIndex: number,
    columnIndex: number,
    newValue: string | null,
    originalRow: (string | number | boolean | null)[]
  ) => Promise<{ success: boolean; error?: string }>;
  onDeleteRows?: (
    rows: (string | number | boolean | null)[][]
  ) => Promise<{ success: boolean; error?: string }>;
}

interface EditingCell {
  rowIndex: number;
  cellIndex: number;
  value: string;
  originalRow: (string | number | boolean | null)[];
  originalRowIndex: number; // Index in original unsorted data
}

export function ResizableDataTable({
  columns,
  columnTypes,
  columnTables,
  rows,
  showColumnTypes = false,
  onCellUpdate,
  onDeleteRows,
}: ResizableDataTableProps) {
  const { t } = useTranslation();

  // Editing state
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Multi-selection state
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [lastClickedRow, setLastClickedRow] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartRow, setDragStartRow] = useState<number | null>(null);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  // Delete confirmation modal state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [rowsToDelete, setRowsToDelete] = useState<Row[]>([]);

  // Sort state (frontend sorting)
  const [sortState, setSortState] = useState<SortState | null>(null);

  // Extract table name from column_tables (use single table name if all columns from same table)
  const tableName = useMemo(() => {
    if (!columnTables || columnTables.length === 0) return "table";
    const uniqueTables = [...new Set(columnTables.filter(t => t && t.length > 0))];
    return uniqueTables.length === 1 ? uniqueTables[0] : "table";
  }, [columnTables]);

  // Use sorted rows hook
  const { sortedRows, originalIndices } = useSortedRows({
    rows,
    columnTypes,
    sortColumnIndex: sortState?.columnIndex ?? null,
    sortDirection: sortState?.direction ?? null,
  });

  // Column resize state
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [resizingColumn, setResizingColumn] = useState<string | null>(null);
  const resizeStartRef = useRef({ x: 0, width: 0 });

  // Virtual scroll container ref
  const parentRef = useRef<HTMLDivElement>(null);

  // Virtual row renderer
  const rowVirtualizer = useVirtualizer({
    count: sortedRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10, // Render 10 extra rows above/below viewport
  });

  // Handle column header click for sorting
  const handleHeaderClick = useCallback((columnIndex: number, columnName: string) => {
    setSortState(prev => {
      // Different column clicked: start with ascending
      if (prev?.columnIndex !== columnIndex) {
        return { column: columnName, columnIndex, direction: 'asc' as SortDirection };
      }
      // Same column: toggle asc -> desc -> null
      if (prev.direction === 'asc') {
        return { column: columnName, columnIndex, direction: 'desc' as SortDirection };
      }
      if (prev.direction === 'desc') {
        return null; // Reset to original order
      }
      return { column: columnName, columnIndex, direction: 'asc' as SortDirection };
    });
  }, []);

  // Memoize total table width
  const totalWidth = useMemo(() => {
    return columns.reduce((acc, col) => acc + (columnWidths[col] || DEFAULT_COLUMN_WIDTH), 0);
  }, [columns, columnWidths]);

  // Focus input when editing starts
  useEffect(() => {
    if (editingCell && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingCell?.rowIndex, editingCell?.cellIndex]);

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

  // Save edited cell
  const handleSave = async () => {
    if (!editingCell || !onCellUpdate || isSaving) return;

    const originalValue = editingCell.originalRow[editingCell.cellIndex];
    const originalStr = originalValue === null ? "" : String(originalValue);

    if (editingCell.value === originalStr) {
      setEditingCell(null);
      return;
    }

    setIsSaving(true);
    const newValue = editingCell.value.trim() === "" ? null : editingCell.value;

    // Use originalRowIndex for backend update (unsorted index)
    const result = await onCellUpdate(
      editingCell.originalRowIndex,
      editingCell.cellIndex,
      newValue,
      editingCell.originalRow
    );

    setIsSaving(false);

    if (result.success) {
      setEditingCell(null);
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

  // Start editing a cell
  const handleCellDoubleClick = (
    rowIndex: number,
    cellIndex: number,
    cell: string | number | boolean | null,
    row: (string | number | boolean | null)[],
    originalRowIndex: number
  ) => {
    if (!onCellUpdate) return;

    setEditingCell({
      rowIndex,
      cellIndex,
      value: cell === null ? "" : String(cell),
      originalRow: [...row],
      originalRowIndex,
    });
  };

  // Multi-selection helper functions
  const getRowRange = useCallback((start: number, end: number): number[] => {
    const min = Math.min(start, end);
    const max = Math.max(start, end);
    return Array.from({ length: max - min + 1 }, (_, i) => min + i);
  }, []);

  const getSelectedRowsData = useCallback((): Row[] => {
    return Array.from(selectedRows)
      .sort((a, b) => a - b)
      .filter((idx) => idx < sortedRows.length)
      .map((idx) => sortedRows[idx]);
  }, [sortedRows, selectedRows]);

  // Handle delete request from context menu
  const handleDeleteRequest = useCallback(() => {
    const rowsData = getSelectedRowsData();
    if (rowsData.length > 0) {
      setRowsToDelete(rowsData);
      setShowDeleteModal(true);
      setContextMenu(null);
    }
  }, [getSelectedRowsData]);

  // Handle delete confirmation
  const handleDeleteConfirm = useCallback(async () => {
    if (onDeleteRows && rowsToDelete.length > 0) {
      const result = await onDeleteRows(rowsToDelete);
      if (result.success) {
        setSelectedRows(new Set());
      }
    }
    setShowDeleteModal(false);
    setRowsToDelete([]);
  }, [onDeleteRows, rowsToDelete]);

  // Handle delete cancel
  const handleDeleteCancel = useCallback(() => {
    setShowDeleteModal(false);
    setRowsToDelete([]);
  }, []);

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

  // Row click handler - supports multi-selection
  const handleRowClick = useCallback(
    (rowIndex: number, e: React.MouseEvent) => {
      // Close context menu
      setContextMenu(null);

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
    [lastClickedRow, getRowRange]
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
        if (sortedRows.length) {
          setSelectedRows(new Set(sortedRows.map((_, i) => i)));
        }
      }
    },
    [sortedRows.length]
  );

  if (rows.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500 py-8">
        {t("query.emptyResults")}
      </div>
    );
  }

  return (
    <>
      <div
        ref={parentRef}
        tabIndex={0}
        onKeyDown={handleTableKeyDown}
        className="overflow-auto h-full outline-none"
        style={{ contain: 'strict' }}
      >
        <div style={{ width: `${totalWidth}px`, minWidth: '100%' }}>
          {/* Fixed Header */}
          <div className="sticky top-0 z-10 bg-gray-800 border-b-2 border-gray-600">
            <div className="flex">
              {columns.map((col, i) => {
                const width = columnWidths[col] || DEFAULT_COLUMN_WIDTH;
                const isSorted = sortState?.columnIndex === i;
                return (
                  <div
                    key={i}
                    className="relative text-left px-4 py-2 font-medium whitespace-nowrap border-r border-gray-600 select-none text-sm flex-shrink-0 cursor-pointer hover:bg-gray-700/30 transition-colors"
                    style={{ width: `${width}px`, minWidth: `${MIN_COLUMN_WIDTH}px`, maxWidth: `${MAX_COLUMN_WIDTH}px` }}
                    onClick={() => handleHeaderClick(i, col)}
                  >
                    <div className="flex items-center gap-1.5 pr-2">
                      <span className="text-gray-200 truncate">{col}</span>
                      {showColumnTypes && columnTypes && columnTypes[i] && (
                        <span className="text-[10px] text-gray-500 font-normal uppercase flex-shrink-0">
                          {columnTypes[i]}
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
              height: `${rowVirtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const sortedRowIndex = virtualRow.index;
              const row = sortedRows[sortedRowIndex];
              const originalRowIndex = originalIndices[sortedRowIndex];
              const isSelected = selectedRows.has(sortedRowIndex);

              return (
                <div
                  key={virtualRow.key}
                  data-index={sortedRowIndex}
                  onClick={(e) => handleRowClick(sortedRowIndex, e)}
                  onMouseDown={(e) => handleRowMouseDown(sortedRowIndex, e)}
                  onMouseEnter={() => handleRowMouseEnter(sortedRowIndex)}
                  onContextMenu={(e) => handleContextMenu(e, sortedRowIndex)}
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
                      editingCell?.rowIndex === sortedRowIndex &&
                      editingCell?.cellIndex === cellIndex;
                    const colName = columns[cellIndex];
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
                        onDoubleClick={() => handleCellDoubleClick(sortedRowIndex, cellIndex, cell, row, originalRowIndex)}
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
          </div>
        </div>
      </div>

      {/* Row Context Menu - outside contain:strict div */}
      {contextMenu && (
        <RowContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          selectedRows={getSelectedRowsData()}
          columns={columns}
          tableName={tableName}
          onClose={() => setContextMenu(null)}
          onDelete={handleDeleteRequest}
          canDelete={!!onDeleteRows && tableName !== "table"}
        />
      )}

      {/* Delete Rows Confirmation Modal */}
      <DeleteRowsConfirmModal
        isOpen={showDeleteModal}
        rowCount={rowsToDelete.length}
        tableName={tableName}
        sampleRows={rowsToDelete}
        columns={columns}
        onConfirm={handleDeleteConfirm}
        onCancel={handleDeleteCancel}
      />
    </>
  );
}
