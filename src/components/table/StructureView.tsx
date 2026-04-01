import React, { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { ColumnInfo, IndexInfo } from "../../stores/tabStore";
import { ColumnEditModal } from "./ColumnEditModal";
import { AddIndexModal } from "./AddIndexModal";
import { ColumnErrorModal } from "./ColumnErrorModal";
import { PencilIcon, PlusIcon, MinusIcon, RefreshIcon } from "../common/Icons";
import { CustomSelect } from "../common/CustomSelect";

const DEFAULT_COLUMN_WIDTH = 120;
const MIN_COLUMN_WIDTH = 60;
const MAX_COLUMN_WIDTH = 400;

// Parse column type into base type, length, and attributes
function parseColumnType(columnType: string): {
  baseType: string;
  length: string;
  unsigned: boolean;
  zerofill: boolean;
  binary: boolean;
} {
  const lower = columnType.toLowerCase();
  const unsigned = lower.includes('unsigned');
  const zerofill = lower.includes('zerofill');
  const binary = lower.includes(' binary');

  // Remove attributes to get clean type
  const cleanType = columnType
    .replace(/\s*unsigned\s*/gi, '')
    .replace(/\s*zerofill\s*/gi, '')
    .replace(/\s+binary\s*/gi, '')
    .trim();

  const match = cleanType.match(/^(\w+)(?:\((.+)\))?$/);
  if (match) {
    return {
      baseType: match[1].toUpperCase(),
      length: match[2] || "",
      unsigned,
      zerofill,
      binary
    };
  }
  return { baseType: cleanType.toUpperCase(), length: "", unsigned, zerofill, binary };
}

interface StructureViewProps {
  structure: ColumnInfo[] | null;
  indexes: IndexInfo[] | null;
  loading: boolean;
  loadingIndexes: boolean;
  connectionId?: string;
  database?: string;
  table?: string;
  onRefresh?: () => void;
  onRefreshIndexes?: () => void;
  onExecuteQuery?: (query: string) => Promise<{ success: boolean; error?: string }>;
}

// Column header definitions with default widths (13 fields for full structure)
const COLUMN_HEADERS = [
  { key: 'field', labelKey: 'tableView.field', width: 140 },
  { key: 'type', labelKey: 'tableView.type', width: 100 },
  { key: 'length', labelKey: 'tableView.length', width: 70 },
  { key: 'unsigned', labelKey: 'tableView.unsigned', width: 70, type: 'checkbox' },
  { key: 'zerofill', labelKey: 'tableView.zerofill', width: 70, type: 'checkbox' },
  { key: 'binary', labelKey: 'tableView.binary', width: 60, type: 'checkbox' },
  { key: 'nullable', labelKey: 'tableView.nullable', width: 70, type: 'checkbox' },
  { key: 'key', labelKey: 'tableView.key', width: 50 },
  { key: 'default', labelKey: 'tableView.default', width: 90 },
  { key: 'extra', labelKey: 'tableView.extra', width: 100 },
  { key: 'encoding', labelKey: 'tableView.encoding', width: 90 },
  { key: 'collation', labelKey: 'tableView.collation', width: 120 },
  { key: 'comment', labelKey: 'tableView.comment', width: 150 },
];

const INDEX_HEADERS = [
  { key: 'unique', label: 'Unique', width: 70 },
  { key: 'keyName', labelKey: 'tableView.keyName', width: 150 },
  { key: 'seqInIndex', labelKey: 'tableView.seqInIndex', width: 60 },
  { key: 'columnName', labelKey: 'tableView.columnName', width: 150 },
  { key: 'collation', labelKey: 'tableView.collation', width: 80 },
  { key: 'cardinality', labelKey: 'tableView.cardinality', width: 100 },
];

export function StructureView({
  structure,
  indexes,
  loading,
  loadingIndexes,
  connectionId,
  database,
  table,
  onRefresh,
  onRefreshIndexes,
  onExecuteQuery,
}: StructureViewProps) {
  const { t } = useTranslation();

  // Column edit modal state
  const [editingColumn, setEditingColumn] = useState<ColumnInfo | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  // Selection state (multi-selection for columns)
  const [selectedColumns, setSelectedColumns] = useState<Set<number>>(new Set());
  const [lastClickedColumn, setLastClickedColumn] = useState<number | null>(null);
  const [selectedIndexKey, setSelectedIndexKey] = useState<string | null>(null);

  // Add index modal state
  const [isAddIndexModalOpen, setIsAddIndexModalOpen] = useState(false);

  // Column error modal state
  const [columnError, setColumnError] = useState<string | null>(null);
  const [isColumnErrorModalOpen, setIsColumnErrorModalOpen] = useState(false);

  // Column resize state
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [indexColumnWidths, setIndexColumnWidths] = useState<Record<string, number>>({});
  const [resizingColumn, setResizingColumn] = useState<string | null>(null);
  const [resizingIndexColumn, setResizingIndexColumn] = useState<string | null>(null);
  const resizeStartRef = useRef({ x: 0, width: 0 });

  // Index section resize state
  const STORAGE_KEY = 'promptsql-structure-index-height';
  const MIN_INDEX_HEIGHT = 100;
  const MAX_INDEX_HEIGHT = 400;
  const DEFAULT_INDEX_HEIGHT = 192;
  const [indexSectionHeight, setIndexSectionHeight] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? parseInt(saved, 10) : DEFAULT_INDEX_HEIGHT;
  });
  const [isResizingIndex, setIsResizingIndex] = useState(false);
  const indexResizeStartRef = useRef({ y: 0, height: 0 });

  // Index context menu state
  const [indexContextMenu, setIndexContextMenu] = useState<{
    x: number;
    y: number;
    index: IndexInfo;
  } | null>(null);

  // Column context menu state
  const [columnContextMenu, setColumnContextMenu] = useState<{
    x: number;
    y: number;
    column: ColumnInfo;
    columnIndex: number;
  } | null>(null);

  // Mouse-based drag and drop state for column reordering (RecyclerView style)
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [targetIndex, setTargetIndex] = useState<number | null>(null);
  const [isReordering, setIsReordering] = useState(false);
  const [dragOffset, setDragOffset] = useState(0); // Y offset for dragged row visual
  const tbodyRef = useRef<HTMLTableSectionElement>(null);
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const rowHeightsRef = useRef<number[]>([]);
  const dragStartYRef = useRef(0);
  const initialScrollTopRef = useRef(0);

  // Inline column add state
  const [isAddingColumn, setIsAddingColumn] = useState(false);
  const [newColumnData, setNewColumnData] = useState({
    field: "",
    type: "VARCHAR",
    length: "255",
    unsigned: false,
    zerofill: false,
    binary: false,
    nullable: true,
    key: "",
    defaultValue: "",
    extra: "",
    encoding: "",
    collation: "",
    comment: "",
  });
  const [isSavingColumn, setIsSavingColumn] = useState(false);
  const newColumnFieldRef = useRef<HTMLInputElement>(null);
  const inlineAddRowRef = useRef<HTMLTableRowElement>(null);

  const canEdit = connectionId && database && table;

  // Column resize handlers
  const handleColumnResizeStart = useCallback((e: React.MouseEvent, columnKey: string, isIndex = false) => {
    e.preventDefault();
    e.stopPropagation();
    const widths = isIndex ? indexColumnWidths : columnWidths;
    const headers = isIndex ? INDEX_HEADERS : COLUMN_HEADERS;
    const header = headers.find(h => h.key === columnKey);
    const currentWidth = widths[columnKey] || header?.width || DEFAULT_COLUMN_WIDTH;

    if (isIndex) {
      setResizingIndexColumn(columnKey);
    } else {
      setResizingColumn(columnKey);
    }
    resizeStartRef.current = { x: e.clientX, width: currentWidth };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [columnWidths, indexColumnWidths]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const activeColumn = resizingColumn || resizingIndexColumn;
      if (!activeColumn) return;

      const delta = e.clientX - resizeStartRef.current.x;
      const newWidth = Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, resizeStartRef.current.width + delta));

      if (resizingColumn) {
        setColumnWidths(prev => ({ ...prev, [activeColumn]: newWidth }));
      } else {
        setIndexColumnWidths(prev => ({ ...prev, [activeColumn]: newWidth }));
      }
    };

    const handleMouseUp = () => {
      if (resizingColumn || resizingIndexColumn) {
        setResizingColumn(null);
        setResizingIndexColumn(null);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };

    if (resizingColumn || resizingIndexColumn) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizingColumn, resizingIndexColumn]);

  // Index section resize handler
  const handleIndexSectionResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizingIndex(true);
    indexResizeStartRef.current = { y: e.clientY, height: indexSectionHeight };
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }, [indexSectionHeight]);

  useEffect(() => {
    if (!isResizingIndex) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = indexResizeStartRef.current.y - e.clientY; // Negative because dragging up increases height
      const newHeight = Math.max(MIN_INDEX_HEIGHT, Math.min(MAX_INDEX_HEIGHT, indexResizeStartRef.current.height + delta));
      setIndexSectionHeight(newHeight);
    };

    const handleMouseUp = () => {
      setIsResizingIndex(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      // Save to localStorage
      localStorage.setItem(STORAGE_KEY, indexSectionHeight.toString());
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingIndex, indexSectionHeight]);

  // Click outside handler for inline add row
  useEffect(() => {
    if (!isAddingColumn || isSavingColumn) return;

    const handleClickOutside = (e: MouseEvent) => {
      // Check if click is outside the inline add row
      if (
        inlineAddRowRef.current &&
        !inlineAddRowRef.current.contains(e.target as Node)
      ) {
        // Only save if field name is not empty
        if (newColumnData.field.trim()) {
          handleSaveNewColumn();
        } else {
          // Cancel if field name is empty
          handleCancelAddColumn();
        }
      }
    };

    // Use setTimeout to avoid immediate trigger on the same click that opened the row
    const timeoutId = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 100);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isAddingColumn, isSavingColumn, newColumnData.field]);

  const handleEditColumn = (column: ColumnInfo) => {
    setEditingColumn(column);
    setIsEditModalOpen(true);
  };

  const handleEditClose = () => {
    setEditingColumn(null);
    setIsEditModalOpen(false);
  };

  const handleEditSave = () => {
    onRefresh?.();
  };

  const handleAddColumn = () => {
    // Reset new column data and enter inline add mode
    setNewColumnData({
      field: "",
      type: "VARCHAR",
      length: "255",
      unsigned: false,
      zerofill: false,
      binary: false,
      nullable: true,
      key: "",
      defaultValue: "",
      extra: "",
      encoding: "",
      collation: "",
      comment: "",
    });
    setIsAddingColumn(true);
    // Focus the field input after render
    setTimeout(() => newColumnFieldRef.current?.focus(), 100);
  };

  const handleCancelAddColumn = () => {
    setIsAddingColumn(false);
    setNewColumnData({
      field: "",
      type: "VARCHAR",
      length: "255",
      unsigned: false,
      zerofill: false,
      binary: false,
      nullable: true,
      key: "",
      defaultValue: "",
      extra: "",
      encoding: "",
      collation: "",
      comment: "",
    });
  };

  const handleSaveNewColumn = async () => {
    if (!canEdit || !onExecuteQuery || !newColumnData.field.trim()) return;

    setIsSavingColumn(true);

    // Build column type
    let columnType = newColumnData.type;
    if (newColumnData.length) {
      columnType += `(${newColumnData.length})`;
    }
    if (newColumnData.unsigned) {
      columnType += " UNSIGNED";
    }
    if (newColumnData.zerofill) {
      columnType += " ZEROFILL";
    }
    if (newColumnData.binary) {
      columnType += " BINARY";
    }

    // Build nullable
    const nullClause = newColumnData.nullable ? "NULL" : "NOT NULL";

    // Build default
    let defaultClause = "";
    if (newColumnData.defaultValue) {
      const upperVal = newColumnData.defaultValue.toUpperCase();
      if (upperVal === "NULL" || upperVal === "CURRENT_TIMESTAMP" || upperVal.startsWith("CURRENT_TIMESTAMP") || newColumnData.defaultValue.startsWith("(")) {
        defaultClause = ` DEFAULT ${newColumnData.defaultValue}`;
      } else {
        defaultClause = ` DEFAULT '${newColumnData.defaultValue.replace(/'/g, "''")}'`;
      }
    }

    // Build extra
    let extraClause = "";
    if (newColumnData.extra) {
      extraClause = ` ${newColumnData.extra}`;
    }

    // Build charset/collation
    let charsetClause = "";
    if (newColumnData.encoding) {
      charsetClause = ` CHARACTER SET ${newColumnData.encoding}`;
    }
    if (newColumnData.collation) {
      charsetClause += ` COLLATE ${newColumnData.collation}`;
    }

    // Build comment
    let commentClause = "";
    if (newColumnData.comment) {
      commentClause = ` COMMENT '${newColumnData.comment.replace(/'/g, "''")}'`;
    }

    const query = `ALTER TABLE \`${table}\` ADD COLUMN \`${newColumnData.field}\` ${columnType} ${nullClause}${defaultClause}${extraClause}${charsetClause}${commentClause}`;

    const result = await onExecuteQuery(query);
    setIsSavingColumn(false);

    if (result.success) {
      setIsAddingColumn(false);
      setNewColumnData({
        field: "",
        type: "VARCHAR",
        length: "255",
        unsigned: false,
        zerofill: false,
        binary: false,
        nullable: true,
        key: "",
        defaultValue: "",
        extra: "",
        encoding: "",
        collation: "",
        comment: "",
      });
      onRefresh?.();
    } else {
      setColumnError(result.error || "Failed to add column");
      setIsColumnErrorModalOpen(true);
    }
  };

  const handleInlineKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      handleCancelAddColumn();
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSaveNewColumn();
    }
  };

  const handleDeleteColumn = async () => {
    if (selectedColumns.size === 0 || !structure || !canEdit || !onExecuteQuery) return;

    // Get the first selected column index
    const selectedIndex = Array.from(selectedColumns)[0];
    const column = structure[selectedIndex];
    const query = `ALTER TABLE \`${table}\` DROP COLUMN \`${column.field}\``;

    const result = await onExecuteQuery(query);
    if (result.success) {
      setSelectedColumns(new Set());
      onRefresh?.();
    } else {
      setColumnError(result.error || "Failed to delete column");
      setIsColumnErrorModalOpen(true);
    }
  };

  const handleAddIndex = () => {
    setIsAddIndexModalOpen(true);
  };

  const handleDeleteIndex = async () => {
    if (!selectedIndexKey || !canEdit || !onExecuteQuery) return;

    // PRIMARY key needs special handling
    const query = selectedIndexKey === "PRIMARY"
      ? `ALTER TABLE \`${table}\` DROP PRIMARY KEY`
      : `ALTER TABLE \`${table}\` DROP INDEX \`${selectedIndexKey}\``;

    const result = await onExecuteQuery(query);
    if (result.success) {
      setSelectedIndexKey(null);
      onRefreshIndexes?.();
    } else {
      setColumnError(result.error || "Failed to delete index");
      setIsColumnErrorModalOpen(true);
    }
  };

  const handleIndexSave = () => {
    onRefreshIndexes?.();
  };

  // Index context menu handlers
  const handleIndexContextMenu = (e: React.MouseEvent, idx: IndexInfo) => {
    e.preventDefault();
    setIndexContextMenu({ x: e.clientX, y: e.clientY, index: idx });
    setSelectedIndexKey(idx.key_name);
  };

  const handleCopyIndexName = () => {
    if (indexContextMenu) {
      navigator.clipboard.writeText(indexContextMenu.index.key_name);
      setIndexContextMenu(null);
    }
  };

  const handleCopyColumnName = () => {
    if (indexContextMenu) {
      navigator.clipboard.writeText(indexContextMenu.index.column_name);
      setIndexContextMenu(null);
    }
  };

  const handleCopyIndexRow = () => {
    if (indexContextMenu) {
      const idx = indexContextMenu.index;
      const text = `${idx.non_unique ? 'Non-unique' : 'Unique'}\t${idx.key_name}\t${idx.seq_in_index}\t${idx.column_name}\t${idx.collation || ''}\t${idx.cardinality || ''}`;
      navigator.clipboard.writeText(text);
      setIndexContextMenu(null);
    }
  };

  // Close context menu on click outside
  useEffect(() => {
    if (!indexContextMenu && !columnContextMenu) return;

    const handleClick = () => {
      setIndexContextMenu(null);
      setColumnContextMenu(null);
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [indexContextMenu, columnContextMenu]);

  // Column context menu handlers
  const handleColumnContextMenu = (e: React.MouseEvent, col: ColumnInfo, index: number) => {
    e.preventDefault();
    setColumnContextMenu({ x: e.clientX, y: e.clientY, column: col, columnIndex: index });
    setSelectedColumns(new Set([index]));
  };

  const handleDuplicateColumn = async () => {
    if (!columnContextMenu || !canEdit || !onExecuteQuery) return;

    const col = columnContextMenu.column;

    // Generate unique column name
    let newFieldName = `${col.field}_copy`;
    let counter = 1;
    while (structure?.some(c => c.field === newFieldName)) {
      newFieldName = `${col.field}_copy${counter}`;
      counter++;
    }

    // Build column definition
    let columnDef = `\`${newFieldName}\` ${col.column_type}`;

    // NULL constraint
    columnDef += col.is_nullable === 'YES' ? ' NULL' : ' NOT NULL';

    // Default value
    if (col.default_value !== null) {
      const upperVal = col.default_value.toUpperCase();
      if (upperVal === 'NULL' || upperVal === 'CURRENT_TIMESTAMP' || upperVal.startsWith('CURRENT_TIMESTAMP') || col.default_value.startsWith('(')) {
        columnDef += ` DEFAULT ${col.default_value}`;
      } else {
        columnDef += ` DEFAULT '${col.default_value.replace(/'/g, "''")}'`;
      }
    }

    // Extra (skip auto_increment for duplicate)
    if (col.extra && !col.extra.toLowerCase().includes('auto_increment')) {
      columnDef += ` ${col.extra}`;
    }

    // Character set and collation
    if (col.character_set) {
      columnDef += ` CHARACTER SET ${col.character_set}`;
    }
    if (col.collation) {
      columnDef += ` COLLATE ${col.collation}`;
    }

    // Comment
    if (col.column_comment) {
      columnDef += ` COMMENT '${col.column_comment.replace(/'/g, "''")}'`;
    }

    // Position after the original column
    const positionClause = `AFTER \`${col.field}\``;

    const query = `ALTER TABLE \`${table}\` ADD COLUMN ${columnDef} ${positionClause}`;

    setColumnContextMenu(null);

    const result = await onExecuteQuery(query);
    if (result.success) {
      onRefresh?.();
    } else {
      setColumnError(result.error || "Failed to duplicate column");
      setIsColumnErrorModalOpen(true);
    }
  };

  const handleDeleteColumnFromMenu = async () => {
    if (!columnContextMenu || !canEdit || !onExecuteQuery) return;

    const column = columnContextMenu.column;
    const query = `ALTER TABLE \`${table}\` DROP COLUMN \`${column.field}\``;

    setColumnContextMenu(null);

    const result = await onExecuteQuery(query);
    if (result.success) {
      setSelectedColumns(new Set());
      onRefresh?.();
    } else {
      setColumnError(result.error || "Failed to delete column");
      setIsColumnErrorModalOpen(true);
    }
  };

  const handleEmptyAreaDoubleClick = () => {
    if (canEdit) {
      handleAddColumn();
    }
  };

  // Column row click handler for multi-selection
  const handleColumnRowClick = useCallback((index: number, e: React.MouseEvent) => {
    const isCtrlOrCmd = e.ctrlKey || e.metaKey;
    const isShift = e.shiftKey;

    if (isShift && lastClickedColumn !== null) {
      const start = Math.min(lastClickedColumn, index);
      const end = Math.max(lastClickedColumn, index);
      const range = Array.from({ length: end - start + 1 }, (_, i) => start + i);
      if (isCtrlOrCmd) {
        setSelectedColumns(prev => new Set([...prev, ...range]));
      } else {
        setSelectedColumns(new Set(range));
      }
    } else if (isCtrlOrCmd) {
      setSelectedColumns(prev => {
        const next = new Set(prev);
        if (next.has(index)) {
          next.delete(index);
        } else {
          next.add(index);
        }
        return next;
      });
      setLastClickedColumn(index);
    } else {
      setSelectedColumns(new Set([index]));
      setLastClickedColumn(index);
    }

    // Focus the table container to enable keyboard shortcuts
    tableContainerRef.current?.focus();
  }, [lastClickedColumn]);

  // Keyboard handler for Cmd+A (select all columns)
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
        e.preventDefault();
        if (structure?.length) {
          setSelectedColumns(new Set(structure.map((_, i) => i)));
        }
      }
    },
    [structure?.length]
  );

  // Mouse-based drag and drop for column reordering (RecyclerView style)
  const handleRowMouseDown = useCallback((e: React.MouseEvent, index: number) => {
    if (!canEdit || isAddingColumn || isReordering) return;
    if (e.button !== 0) return; // Only left click

    // Prevent text selection
    e.preventDefault();

    // Capture row heights for calculations
    if (tbodyRef.current) {
      const rows = tbodyRef.current.querySelectorAll('tr[data-row-index]');
      rowHeightsRef.current = Array.from(rows).map(row => row.getBoundingClientRect().height);
    }

    // Get scroll container
    const scrollContainer = tbodyRef.current?.closest('.overflow-auto');
    initialScrollTopRef.current = scrollContainer?.scrollTop || 0;

    dragStartYRef.current = e.clientY;
    setDraggingIndex(index);
    setTargetIndex(index);
    setDragOffset(0);

    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
  }, [canEdit, isAddingColumn, isReordering]);

  // Calculate target index based on mouse position
  const calculateTargetIndex = useCallback((clientY: number) => {
    if (draggingIndex === null || !tbodyRef.current || !structure) return draggingIndex;

    const tbody = tbodyRef.current;
    const rows = tbody.querySelectorAll('tr[data-row-index]');
    if (rows.length === 0) return draggingIndex;

    const tbodyRect = tbody.getBoundingClientRect();
    const relativeY = clientY - tbodyRect.top;

    // Find which row the mouse is over
    let accumulatedHeight = 0;
    for (let i = 0; i < rows.length; i++) {
      const rowHeight = rowHeightsRef.current[i] || 32;
      const rowMiddle = accumulatedHeight + rowHeight / 2;

      if (relativeY < rowMiddle) {
        return i;
      }
      accumulatedHeight += rowHeight;
    }

    return structure.length; // After last row
  }, [draggingIndex, structure]);

  useEffect(() => {
    if (draggingIndex === null) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = e.clientY - dragStartYRef.current;
      setDragOffset(deltaY);

      const newTarget = calculateTargetIndex(e.clientY);
      if (newTarget !== null && newTarget !== targetIndex) {
        setTargetIndex(newTarget);
      }
    };

    const handleMouseUp = async () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';

      const fromIndex = draggingIndex;
      const toIndex = targetIndex;

      setDraggingIndex(null);
      setTargetIndex(null);
      setDragOffset(0);

      // Validate and execute reorder
      if (fromIndex === null || toIndex === null || !canEdit || !structure || !onExecuteQuery) {
        return;
      }

      // No change needed if same position or immediately after
      if (toIndex === fromIndex || toIndex === fromIndex + 1) {
        return;
      }

      const draggedColumn = structure[fromIndex];
      setIsReordering(true);

      // Build the MODIFY COLUMN query with full column definition
      const col = draggedColumn;
      let columnDef = `\`${col.field}\` ${col.column_type}`;

      // NULL constraint
      columnDef += col.is_nullable === 'YES' ? ' NULL' : ' NOT NULL';

      // Default value
      if (col.default_value !== null) {
        const upperVal = col.default_value.toUpperCase();
        if (upperVal === 'NULL' || upperVal === 'CURRENT_TIMESTAMP' || upperVal.startsWith('CURRENT_TIMESTAMP') || col.default_value.startsWith('(')) {
          columnDef += ` DEFAULT ${col.default_value}`;
        } else {
          columnDef += ` DEFAULT '${col.default_value.replace(/'/g, "''")}'`;
        }
      }

      // Extra (auto_increment, etc.)
      if (col.extra) {
        columnDef += ` ${col.extra}`;
      }

      // Character set and collation
      if (col.character_set) {
        columnDef += ` CHARACTER SET ${col.character_set}`;
      }
      if (col.collation) {
        columnDef += ` COLLATE ${col.collation}`;
      }

      // Comment
      if (col.column_comment) {
        columnDef += ` COMMENT '${col.column_comment.replace(/'/g, "''")}'`;
      }

      // Determine position clause
      let positionClause: string;
      if (toIndex === 0) {
        positionClause = 'FIRST';
      } else {
        // Calculate the correct "after" column
        // If moving down, account for the original position
        let afterColumnIndex = toIndex - 1;
        if (toIndex > fromIndex) {
          // Moving down: afterColumnIndex is correct as-is
        }
        // If moving up, afterColumnIndex is correct as-is
        const afterColumn = structure[afterColumnIndex];
        positionClause = `AFTER \`${afterColumn.field}\``;
      }

      const query = `ALTER TABLE \`${table}\` MODIFY COLUMN ${columnDef} ${positionClause}`;

      const result = await onExecuteQuery(query);
      setIsReordering(false);

      if (result.success) {
        onRefresh?.();
      } else {
        setColumnError(result.error || "Failed to reorder column");
        setIsColumnErrorModalOpen(true);
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingIndex, targetIndex, calculateTargetIndex, canEdit, structure, onExecuteQuery, table, onRefresh]);

  // Calculate visual offset for each row during drag
  const getRowTransform = useCallback((index: number): string => {
    if (draggingIndex === null || targetIndex === null) return '';
    if (index === draggingIndex) return ''; // Dragged row handled separately

    const rowHeight = rowHeightsRef.current[draggingIndex] || 32;

    // Rows between original and target positions need to shift
    if (draggingIndex < targetIndex) {
      // Moving down: rows between dragging and target-1 shift up
      if (index > draggingIndex && index < targetIndex) {
        return `translateY(-${rowHeight}px)`;
      }
    } else if (draggingIndex > targetIndex) {
      // Moving up: rows between target and dragging shift down
      if (index >= targetIndex && index < draggingIndex) {
        return `translateY(${rowHeight}px)`;
      }
    }

    return '';
  }, [draggingIndex, targetIndex]);

  const getColumnWidth = (key: string) => {
    const header = COLUMN_HEADERS.find(h => h.key === key);
    return columnWidths[key] || header?.width || DEFAULT_COLUMN_WIDTH;
  };

  const getIndexColumnWidth = (key: string) => {
    const header = INDEX_HEADERS.find(h => h.key === key);
    return indexColumnWidths[key] || header?.width || DEFAULT_COLUMN_WIDTH;
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500">
        {t("common.loading")}
      </div>
    );
  }

  if (!structure) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500">
        {t("tableView.noStructure")}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto flex flex-col relative">
      {/* Reordering overlay */}
      {isReordering && (
        <div className="absolute inset-0 bg-gray-900/50 flex items-center justify-center z-20">
          <div className="bg-gray-800 px-4 py-2 rounded-lg flex items-center gap-2">
            <RefreshIcon className="w-4 h-4 animate-spin text-blue-400" />
            <span className="text-sm text-gray-200">{t("tableView.reorderingColumn")}</span>
          </div>
        </div>
      )}
      {/* COLUMNS Section */}
      <div className="flex-1 flex flex-col min-h-0">
        {/* Columns Header with Toolbar */}
        <div className="px-4 py-2 bg-slate-100 dark:bg-slate-800/70 border-b border-slate-300 dark:border-slate-600 flex items-center justify-between flex-shrink-0">
          <span className="text-xs text-slate-600 dark:text-slate-300 uppercase tracking-wider font-semibold">
            {t("tableView.columns")}
          </span>
          {canEdit && (
            <div className="flex items-center gap-1">
              <button
                onClick={handleAddColumn}
                className="p-1 text-slate-500 dark:text-slate-400 hover:text-green-600 dark:hover:text-green-400 transition"
                title={t("common.add")}
              >
                <PlusIcon className="w-4 h-4" />
              </button>
              <button
                onClick={handleDeleteColumn}
                disabled={selectedColumns.size === 0}
                className="p-1 text-slate-500 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed transition"
                title={t("common.delete")}
              >
                <MinusIcon className="w-4 h-4" />
              </button>
              <button
                onClick={onRefresh}
                className="p-1 text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition"
                title={t("common.refresh")}
              >
                <RefreshIcon className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Columns Table */}
        <div
          ref={tableContainerRef}
          className="flex-1 overflow-auto outline-none"
          tabIndex={0}
          onKeyDown={handleKeyDown}
        >
          <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
            <thead className="sticky top-0 z-10 bg-gray-800">
              <tr className="border-b-2 border-gray-600">
                {COLUMN_HEADERS.map((header) => {
                  const width = getColumnWidth(header.key);
                  return (
                    <th
                      key={header.key}
                      className="relative text-left px-4 py-2 text-gray-400 font-medium whitespace-nowrap border-r border-gray-600 select-none"
                      style={{ width: `${width}px`, minWidth: `${MIN_COLUMN_WIDTH}px`, maxWidth: `${MAX_COLUMN_WIDTH}px` }}
                    >
                      <span className="truncate">{t(header.labelKey)}</span>
                      <div
                        className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 transition-colors ${
                          resizingColumn === header.key ? 'bg-blue-500' : ''
                        }`}
                        onMouseDown={(e) => handleColumnResizeStart(e, header.key)}
                      />
                    </th>
                  );
                })}
                {canEdit && (
                  <th className="text-center px-2 py-2 text-gray-400 font-medium w-12"></th>
                )}
              </tr>
            </thead>
            <tbody ref={tbodyRef}>
              {structure.map((col, index) => {
                const { baseType, length, unsigned, zerofill, binary } = parseColumnType(col.column_type);
                const isSelected = selectedColumns.has(index);
                const isDragging = draggingIndex === index;
                const rowTransform = getRowTransform(index);

                return (
                    <tr
                      key={index}
                      data-row-index={index}
                      onMouseDown={(e) => handleRowMouseDown(e, index)}
                      onClick={(e) => !isDragging && handleColumnRowClick(index, e)}
                      onContextMenu={(e) => canEdit && handleColumnContextMenu(e, col, index)}
                      className={`border-b border-gray-800 ${
                        isSelected && !isDragging ? 'bg-blue-600 text-white' : 'hover:bg-gray-800/50'
                      } ${isDragging ? 'bg-blue-500/80 text-white shadow-lg z-50 relative' : ''} ${
                        canEdit && !isAddingColumn && !isReordering ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
                      }`}
                      style={{
                        transform: isDragging ? `translateY(${dragOffset}px)` : rowTransform,
                        transition: isDragging ? 'none' : 'transform 150ms ease-out',
                        position: isDragging ? 'relative' : undefined,
                        zIndex: isDragging ? 100 : undefined,
                      }}
                    >
                    {/* Field */}
                    <td
                      className={`px-3 py-1.5 font-medium whitespace-nowrap overflow-hidden ${isSelected ? 'text-white' : 'text-gray-300'}`}
                      style={{ width: `${getColumnWidth('field')}px`, maxWidth: `${getColumnWidth('field')}px` }}
                      title={col.field}
                    >
                      {col.field}
                    </td>
                    {/* Type */}
                    <td
                      className={`px-3 py-1.5 whitespace-nowrap overflow-hidden ${isSelected ? 'text-blue-200' : 'text-blue-400'}`}
                      style={{ width: `${getColumnWidth('type')}px`, maxWidth: `${getColumnWidth('type')}px` }}
                      title={baseType}
                    >
                      {baseType}
                    </td>
                    {/* Length */}
                    <td
                      className={`px-3 py-1.5 whitespace-nowrap overflow-hidden ${isSelected ? 'text-gray-200' : 'text-gray-400'}`}
                      style={{ width: `${getColumnWidth('length')}px`, maxWidth: `${getColumnWidth('length')}px` }}
                    >
                      {length || "-"}
                    </td>
                    {/* Unsigned */}
                    <td
                      className="px-3 py-1.5 whitespace-nowrap text-center"
                      style={{ width: `${getColumnWidth('unsigned')}px`, maxWidth: `${getColumnWidth('unsigned')}px` }}
                    >
                      <input
                        type="checkbox"
                        checked={unsigned}
                        readOnly
                        className="w-3.5 h-3.5 rounded border-gray-500 bg-gray-700 text-blue-500 cursor-default"
                      />
                    </td>
                    {/* Zerofill */}
                    <td
                      className="px-3 py-1.5 whitespace-nowrap text-center"
                      style={{ width: `${getColumnWidth('zerofill')}px`, maxWidth: `${getColumnWidth('zerofill')}px` }}
                    >
                      <input
                        type="checkbox"
                        checked={zerofill}
                        readOnly
                        className="w-3.5 h-3.5 rounded border-gray-500 bg-gray-700 text-blue-500 cursor-default"
                      />
                    </td>
                    {/* Binary */}
                    <td
                      className="px-3 py-1.5 whitespace-nowrap text-center"
                      style={{ width: `${getColumnWidth('binary')}px`, maxWidth: `${getColumnWidth('binary')}px` }}
                    >
                      <input
                        type="checkbox"
                        checked={binary}
                        readOnly
                        className="w-3.5 h-3.5 rounded border-gray-500 bg-gray-700 text-blue-500 cursor-default"
                      />
                    </td>
                    {/* Allow NULL */}
                    <td
                      className="px-3 py-1.5 whitespace-nowrap text-center"
                      style={{ width: `${getColumnWidth('nullable')}px`, maxWidth: `${getColumnWidth('nullable')}px` }}
                    >
                      <input
                        type="checkbox"
                        checked={col.is_nullable === "YES"}
                        readOnly
                        className="w-3.5 h-3.5 rounded border-gray-500 bg-gray-700 text-blue-500 cursor-default"
                      />
                    </td>
                    {/* Key */}
                    <td
                      className="px-3 py-1.5 whitespace-nowrap overflow-hidden text-center"
                      style={{ width: `${getColumnWidth('key')}px`, maxWidth: `${getColumnWidth('key')}px` }}
                    >
                      {col.key === "PRI" ? (
                        <span className={isSelected ? 'text-yellow-200 font-medium' : 'text-yellow-400 font-medium'}>PRI</span>
                      ) : col.key === "UNI" ? (
                        <span className={isSelected ? 'text-purple-200' : 'text-purple-400'}>UNI</span>
                      ) : col.key === "MUL" ? (
                        <span className={isSelected ? 'text-cyan-200' : 'text-cyan-400'}>MUL</span>
                      ) : (
                        <span className={isSelected ? 'text-gray-300' : 'text-gray-500'}>-</span>
                      )}
                    </td>
                    {/* Default */}
                    <td
                      className={`px-3 py-1.5 whitespace-nowrap overflow-hidden ${isSelected ? 'text-gray-200' : 'text-gray-400'}`}
                      style={{ width: `${getColumnWidth('default')}px`, maxWidth: `${getColumnWidth('default')}px` }}
                      title={col.default_value === null ? "NULL" : col.default_value}
                    >
                      {col.default_value === null ? (
                        <span className={isSelected ? 'italic opacity-70' : 'text-gray-500 italic'}>NULL</span>
                      ) : (
                        col.default_value
                      )}
                    </td>
                    {/* Extra */}
                    <td
                      className={`px-3 py-1.5 whitespace-nowrap overflow-hidden ${isSelected ? 'text-gray-200' : 'text-gray-400'}`}
                      style={{ width: `${getColumnWidth('extra')}px`, maxWidth: `${getColumnWidth('extra')}px` }}
                      title={col.extra || undefined}
                    >
                      {col.extra || "-"}
                    </td>
                    {/* Encoding */}
                    <td
                      className={`px-3 py-1.5 whitespace-nowrap overflow-hidden ${isSelected ? 'text-gray-200' : 'text-gray-400'}`}
                      style={{ width: `${getColumnWidth('encoding')}px`, maxWidth: `${getColumnWidth('encoding')}px` }}
                      title={col.character_set || undefined}
                    >
                      {col.character_set || "-"}
                    </td>
                    {/* Collation */}
                    <td
                      className={`px-3 py-1.5 whitespace-nowrap overflow-hidden ${isSelected ? 'text-gray-200' : 'text-gray-400'}`}
                      style={{ width: `${getColumnWidth('collation')}px`, maxWidth: `${getColumnWidth('collation')}px` }}
                      title={col.collation || undefined}
                    >
                      {col.collation || "-"}
                    </td>
                    {/* Comment */}
                    <td
                      className={`px-3 py-1.5 whitespace-nowrap overflow-hidden ${isSelected ? 'text-gray-300' : 'text-gray-500'}`}
                      style={{ width: `${getColumnWidth('comment')}px`, maxWidth: `${getColumnWidth('comment')}px` }}
                      title={col.column_comment || undefined}
                    >
                      {col.column_comment || "-"}
                    </td>
                    {canEdit && (
                      <td className="px-2 py-1.5 text-center">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEditColumn(col);
                          }}
                          className={`p-1 transition ${isSelected ? 'text-white hover:text-blue-200' : 'text-gray-500 hover:text-blue-400'}`}
                          title={t("common.edit")}
                        >
                          <PencilIcon className="w-4 h-4" />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}

              {/* Inline add column row */}
              {isAddingColumn && canEdit && (
                <tr ref={inlineAddRowRef} className="bg-gray-700/50 border-b border-gray-600">
                  {/* Field */}
                  <td className="px-1 py-1" style={{ width: `${getColumnWidth('field')}px` }}>
                    <input
                      ref={newColumnFieldRef}
                      type="text"
                      value={newColumnData.field}
                      onChange={(e) => setNewColumnData(prev => ({ ...prev, field: e.target.value }))}
                      onKeyDown={handleInlineKeyDown}
                      placeholder="field_name"
                      className="w-full px-2 py-1 bg-gray-800 border border-gray-600 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                      disabled={isSavingColumn}
                    />
                  </td>
                  {/* Type */}
                  <td className="px-1 py-1" style={{ width: `${getColumnWidth('type')}px` }}>
                    <CustomSelect
                      value={newColumnData.type}
                      onChange={(value) => setNewColumnData(prev => ({ ...prev, type: value }))}
                      size="sm"
                      disabled={isSavingColumn}
                      options={[
                        {
                          label: "Numeric",
                          options: [
                            { value: "TINYINT", label: "TINYINT" },
                            { value: "SMALLINT", label: "SMALLINT" },
                            { value: "MEDIUMINT", label: "MEDIUMINT" },
                            { value: "INT", label: "INT" },
                            { value: "BIGINT", label: "BIGINT" },
                            { value: "DECIMAL", label: "DECIMAL" },
                            { value: "FLOAT", label: "FLOAT" },
                            { value: "DOUBLE", label: "DOUBLE" },
                          ],
                        },
                        {
                          label: "String",
                          options: [
                            { value: "CHAR", label: "CHAR" },
                            { value: "VARCHAR", label: "VARCHAR" },
                            { value: "TINYTEXT", label: "TINYTEXT" },
                            { value: "TEXT", label: "TEXT" },
                            { value: "MEDIUMTEXT", label: "MEDIUMTEXT" },
                            { value: "LONGTEXT", label: "LONGTEXT" },
                            { value: "JSON", label: "JSON" },
                          ],
                        },
                        {
                          label: "Binary",
                          options: [
                            { value: "BINARY", label: "BINARY" },
                            { value: "VARBINARY", label: "VARBINARY" },
                            { value: "BLOB", label: "BLOB" },
                          ],
                        },
                        {
                          label: "Date/Time",
                          options: [
                            { value: "DATE", label: "DATE" },
                            { value: "TIME", label: "TIME" },
                            { value: "DATETIME", label: "DATETIME" },
                            { value: "TIMESTAMP", label: "TIMESTAMP" },
                            { value: "YEAR", label: "YEAR" },
                          ],
                        },
                      ]}
                    />
                  </td>
                  {/* Length */}
                  <td className="px-1 py-1" style={{ width: `${getColumnWidth('length')}px` }}>
                    <input
                      type="text"
                      value={newColumnData.length}
                      onChange={(e) => setNewColumnData(prev => ({ ...prev, length: e.target.value }))}
                      onKeyDown={handleInlineKeyDown}
                      placeholder="255"
                      className="w-full px-2 py-1 bg-gray-800 border border-gray-600 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                      disabled={isSavingColumn}
                    />
                  </td>
                  {/* Unsigned */}
                  <td className="px-1 py-1 text-center" style={{ width: `${getColumnWidth('unsigned')}px` }}>
                    <input
                      type="checkbox"
                      checked={newColumnData.unsigned}
                      onChange={(e) => setNewColumnData(prev => ({ ...prev, unsigned: e.target.checked }))}
                      className="w-3.5 h-3.5 rounded border-gray-500 bg-gray-700 text-blue-500"
                      disabled={isSavingColumn}
                    />
                  </td>
                  {/* Zerofill */}
                  <td className="px-1 py-1 text-center" style={{ width: `${getColumnWidth('zerofill')}px` }}>
                    <input
                      type="checkbox"
                      checked={newColumnData.zerofill}
                      onChange={(e) => setNewColumnData(prev => ({ ...prev, zerofill: e.target.checked }))}
                      className="w-3.5 h-3.5 rounded border-gray-500 bg-gray-700 text-blue-500"
                      disabled={isSavingColumn}
                    />
                  </td>
                  {/* Binary */}
                  <td className="px-1 py-1 text-center" style={{ width: `${getColumnWidth('binary')}px` }}>
                    <input
                      type="checkbox"
                      checked={newColumnData.binary}
                      onChange={(e) => setNewColumnData(prev => ({ ...prev, binary: e.target.checked }))}
                      className="w-3.5 h-3.5 rounded border-gray-500 bg-gray-700 text-blue-500"
                      disabled={isSavingColumn}
                    />
                  </td>
                  {/* Allow NULL */}
                  <td className="px-1 py-1 text-center" style={{ width: `${getColumnWidth('nullable')}px` }}>
                    <input
                      type="checkbox"
                      checked={newColumnData.nullable}
                      onChange={(e) => setNewColumnData(prev => ({ ...prev, nullable: e.target.checked }))}
                      className="w-3.5 h-3.5 rounded border-gray-500 bg-gray-700 text-blue-500"
                      disabled={isSavingColumn}
                    />
                  </td>
                  {/* Key */}
                  <td className="px-1 py-1" style={{ width: `${getColumnWidth('key')}px` }}>
                    <CustomSelect
                      value={newColumnData.key}
                      onChange={(value) => setNewColumnData(prev => ({ ...prev, key: value }))}
                      size="sm"
                      disabled={isSavingColumn}
                      placeholder="-"
                      options={[
                        { value: "", label: "-" },
                        { value: "PRI", label: "PRI" },
                        { value: "UNI", label: "UNI" },
                        { value: "MUL", label: "MUL" },
                      ]}
                    />
                  </td>
                  {/* Default */}
                  <td className="px-1 py-1" style={{ width: `${getColumnWidth('default')}px` }}>
                    <input
                      type="text"
                      value={newColumnData.defaultValue}
                      onChange={(e) => setNewColumnData(prev => ({ ...prev, defaultValue: e.target.value }))}
                      onKeyDown={handleInlineKeyDown}
                      placeholder="NULL"
                      className="w-full px-2 py-1 bg-gray-800 border border-gray-600 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                      disabled={isSavingColumn}
                    />
                  </td>
                  {/* Extra */}
                  <td className="px-1 py-1" style={{ width: `${getColumnWidth('extra')}px` }}>
                    <CustomSelect
                      value={newColumnData.extra}
                      onChange={(value) => setNewColumnData(prev => ({ ...prev, extra: value }))}
                      size="sm"
                      disabled={isSavingColumn}
                      placeholder="-"
                      options={[
                        { value: "", label: "-" },
                        { value: "AUTO_INCREMENT", label: "AUTO_INCREMENT" },
                        { value: "ON UPDATE CURRENT_TIMESTAMP", label: "ON UPDATE CURRENT_TIMESTAMP" },
                      ]}
                    />
                  </td>
                  {/* Encoding */}
                  <td className="px-1 py-1" style={{ width: `${getColumnWidth('encoding')}px` }}>
                    <input
                      type="text"
                      value={newColumnData.encoding}
                      onChange={(e) => setNewColumnData(prev => ({ ...prev, encoding: e.target.value }))}
                      onKeyDown={handleInlineKeyDown}
                      placeholder="utf8mb4"
                      className="w-full px-2 py-1 bg-gray-800 border border-gray-600 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                      disabled={isSavingColumn}
                    />
                  </td>
                  {/* Collation */}
                  <td className="px-1 py-1" style={{ width: `${getColumnWidth('collation')}px` }}>
                    <input
                      type="text"
                      value={newColumnData.collation}
                      onChange={(e) => setNewColumnData(prev => ({ ...prev, collation: e.target.value }))}
                      onKeyDown={handleInlineKeyDown}
                      placeholder="utf8mb4_unicode_ci"
                      className="w-full px-2 py-1 bg-gray-800 border border-gray-600 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                      disabled={isSavingColumn}
                    />
                  </td>
                  {/* Comment */}
                  <td className="px-1 py-1" style={{ width: `${getColumnWidth('comment')}px` }}>
                    <input
                      type="text"
                      value={newColumnData.comment}
                      onChange={(e) => setNewColumnData(prev => ({ ...prev, comment: e.target.value }))}
                      onKeyDown={handleInlineKeyDown}
                      placeholder="comment"
                      className="w-full px-2 py-1 bg-gray-800 border border-gray-600 rounded text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                      disabled={isSavingColumn}
                    />
                  </td>
                  {/* Actions */}
                  <td className="px-2 py-1 text-center">
                    {isSavingColumn ? (
                      <span className="text-xs text-gray-400">...</span>
                    ) : (
                      <button
                        onClick={handleCancelAddColumn}
                        className="text-gray-400 hover:text-red-400 transition text-xs"
                        title="Cancel (ESC)"
                      >
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {/* Empty area for double-click to add column */}
          {canEdit && !isAddingColumn && (
            <div
              className="h-32 cursor-pointer hover:bg-gray-800/30 transition"
              onDoubleClick={handleEmptyAreaDoubleClick}
              title={t("tableView.doubleClickToAdd")}
            />
          )}
        </div>
      </div>

      {/* Resizer bar between Columns and Indexes */}
      <div
        className={`flex-shrink-0 h-1.5 cursor-row-resize transition-colors ${
          isResizingIndex ? 'bg-blue-500' : 'bg-gray-700 hover:bg-gray-600'
        }`}
        onMouseDown={handleIndexSectionResizeStart}
        title="Drag to resize index section"
      />

      {/* INDEXES Section */}
      <div className="flex-shrink-0">
        {/* Indexes Header with Toolbar */}
        <div className="px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800 flex items-center justify-between">
          <span className="text-xs text-amber-700 dark:text-amber-300 uppercase tracking-wider font-semibold">
            {t("tableView.indexes")}
          </span>
          {canEdit && (
            <div className="flex items-center gap-1">
              <button
                onClick={handleAddIndex}
                className="p-1 text-amber-600 dark:text-amber-400 hover:text-green-600 dark:hover:text-green-400 transition"
                title={t("common.add")}
              >
                <PlusIcon className="w-4 h-4" />
              </button>
              <button
                onClick={handleDeleteIndex}
                disabled={!selectedIndexKey}
                className="p-1 text-amber-600 dark:text-amber-400 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed transition"
                title={t("common.delete")}
              >
                <MinusIcon className="w-4 h-4" />
              </button>
              <button
                onClick={onRefreshIndexes}
                className="p-1 text-amber-600 dark:text-amber-400 hover:text-blue-600 dark:hover:text-blue-400 transition"
                title={t("common.refresh")}
              >
                <RefreshIcon className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {loadingIndexes ? (
          <div className="px-4 py-4 text-gray-500 text-sm">
            {t("common.loading")}
          </div>
        ) : indexes && indexes.length > 0 ? (
          <div className="overflow-auto" style={{ height: `${indexSectionHeight}px` }}>
            <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
              <thead className="sticky top-0 z-10 bg-gray-800">
                <tr className="border-b-2 border-gray-600">
                  {INDEX_HEADERS.map((header) => {
                    const width = getIndexColumnWidth(header.key);
                    return (
                      <th
                        key={header.key}
                        className="relative text-left px-4 py-2 text-gray-400 font-medium whitespace-nowrap border-r border-gray-600 select-none"
                        style={{ width: `${width}px`, minWidth: `${MIN_COLUMN_WIDTH}px`, maxWidth: `${MAX_COLUMN_WIDTH}px` }}
                      >
                        <span className="truncate">{header.label || t(header.labelKey!)}</span>
                        <div
                          className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-500 transition-colors ${
                            resizingIndexColumn === header.key ? 'bg-blue-500' : ''
                          }`}
                          onMouseDown={(e) => handleColumnResizeStart(e, header.key, true)}
                        />
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {indexes.map((idx, i) => {
                  const isSelected = selectedIndexKey === idx.key_name;
                  return (
                    <tr
                      key={i}
                      onClick={() => setSelectedIndexKey(idx.key_name)}
                      onContextMenu={(e) => handleIndexContextMenu(e, idx)}
                      className={`border-b border-gray-800 cursor-pointer ${
                        isSelected ? 'bg-blue-600 text-white' : 'hover:bg-gray-800/50'
                      }`}
                    >
                      <td
                        className="px-4 py-2 whitespace-nowrap"
                        style={{ width: `${getIndexColumnWidth('unique')}px`, maxWidth: `${getIndexColumnWidth('unique')}px` }}
                      >
                        <input
                          type="checkbox"
                          checked={!idx.non_unique}
                          readOnly
                          className="w-4 h-4 rounded border-gray-500 bg-gray-700 text-blue-500 cursor-default"
                          title={idx.non_unique ? "Non-unique" : "Unique"}
                        />
                      </td>
                      <td
                        className="px-4 py-2 whitespace-nowrap overflow-hidden"
                        style={{ width: `${getIndexColumnWidth('keyName')}px`, maxWidth: `${getIndexColumnWidth('keyName')}px` }}
                        title={idx.key_name}
                      >
                        {idx.key_name === "PRIMARY" ? (
                          <span className={isSelected ? 'text-yellow-200 font-medium' : 'text-yellow-400 font-medium'}>{idx.key_name}</span>
                        ) : (
                          <span className={isSelected ? 'text-cyan-200' : 'text-cyan-400'}>{idx.key_name}</span>
                        )}
                      </td>
                      <td
                        className={`px-4 py-2 whitespace-nowrap ${isSelected ? 'text-gray-200' : 'text-gray-400'}`}
                        style={{ width: `${getIndexColumnWidth('seqInIndex')}px`, maxWidth: `${getIndexColumnWidth('seqInIndex')}px` }}
                      >
                        {idx.seq_in_index}
                      </td>
                      <td
                        className={`px-4 py-2 whitespace-nowrap overflow-hidden ${isSelected ? 'text-white' : 'text-gray-300'}`}
                        style={{ width: `${getIndexColumnWidth('columnName')}px`, maxWidth: `${getIndexColumnWidth('columnName')}px` }}
                        title={idx.column_name}
                      >
                        {idx.column_name}
                      </td>
                      <td
                        className={`px-4 py-2 whitespace-nowrap ${isSelected ? 'text-gray-200' : 'text-gray-400'}`}
                        style={{ width: `${getIndexColumnWidth('collation')}px`, maxWidth: `${getIndexColumnWidth('collation')}px` }}
                      >
                        {idx.collation || "-"}
                      </td>
                      <td
                        className={`px-4 py-2 whitespace-nowrap ${isSelected ? 'text-gray-200' : 'text-gray-400'}`}
                        style={{ width: `${getIndexColumnWidth('cardinality')}px`, maxWidth: `${getIndexColumnWidth('cardinality')}px` }}
                      >
                        {idx.cardinality?.toLocaleString() || "-"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-4 py-4 text-gray-500 text-sm">
            {t("tableView.noIndexes")}
          </div>
        )}
      </div>

      {/* Column Edit Modal */}
      {canEdit && (
        <ColumnEditModal
          isOpen={isEditModalOpen}
          onClose={handleEditClose}
          column={editingColumn}
          connectionId={connectionId}
          database={database}
          table={table}
          onSave={handleEditSave}
        />
      )}

      {/* Add Index Modal */}
      {canEdit && structure && (
        <AddIndexModal
          isOpen={isAddIndexModalOpen}
          onClose={() => setIsAddIndexModalOpen(false)}
          columns={structure}
          connectionId={connectionId}
          database={database}
          table={table}
          onSave={handleIndexSave}
          onExecuteQuery={onExecuteQuery}
        />
      )}

      {/* Column Error Modal */}
      <ColumnErrorModal
        isOpen={isColumnErrorModalOpen}
        error={columnError || ""}
        onEdit={() => {
          setIsColumnErrorModalOpen(false);
          // Keep the edit modal open for retry
        }}
        onDiscard={() => {
          setIsColumnErrorModalOpen(false);
          setColumnError(null);
        }}
      />

      {/* Index Context Menu */}
      {indexContextMenu && (
        <div
          className="fixed z-50 bg-gray-800 border border-gray-600 rounded-lg shadow-xl py-1 min-w-[160px]"
          style={{ top: indexContextMenu.y, left: indexContextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={handleCopyIndexName}
            className="w-full px-4 py-2 text-left text-sm text-gray-200 hover:bg-gray-700 transition-colors"
          >
            {t("tableView.copyIndexName", "Copy Index Name")}
          </button>
          <button
            onClick={handleCopyColumnName}
            className="w-full px-4 py-2 text-left text-sm text-gray-200 hover:bg-gray-700 transition-colors"
          >
            {t("tableView.copyColumnName", "Copy Column Name")}
          </button>
          <div className="border-t border-gray-700 my-1" />
          <button
            onClick={handleCopyIndexRow}
            className="w-full px-4 py-2 text-left text-sm text-gray-200 hover:bg-gray-700 transition-colors"
          >
            {t("tableView.copyRow", "Copy Row")}
          </button>
        </div>
      )}

      {/* Column Context Menu */}
      {columnContextMenu && (
        <div
          className="fixed z-50 bg-gray-800 border border-gray-600 rounded-lg shadow-xl py-1 min-w-[180px]"
          style={{ top: columnContextMenu.y, left: columnContextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={handleDuplicateColumn}
            className="w-full px-4 py-2 text-left text-sm text-gray-200 hover:bg-gray-700 transition-colors"
          >
            {t("tableView.duplicateField", "Duplicate Field")}
          </button>
          <div className="border-t border-gray-700 my-1" />
          <button
            onClick={handleDeleteColumnFromMenu}
            className="w-full px-4 py-2 text-left text-sm text-red-400 hover:bg-gray-700 transition-colors"
          >
            {t("tableView.deleteField", "Delete Field")}
          </button>
        </div>
      )}
    </div>
  );
}
