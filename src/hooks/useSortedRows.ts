import { useMemo } from 'react';

export type SortDirection = 'asc' | 'desc' | null;

export interface SortState {
  column: string;
  columnIndex: number;
  direction: SortDirection;
}

type CellValue = string | number | boolean | null;
type Row = CellValue[];

interface UseSortedRowsOptions {
  rows: Row[];
  columnTypes?: string[];
  sortColumnIndex: number | null;
  sortDirection: SortDirection;
}

interface UseSortedRowsResult {
  sortedRows: Row[];
  originalIndices: number[];
}

/**
 * Hook for frontend sorting of table rows.
 * Returns sorted rows and a mapping from sorted index to original index.
 */
export function useSortedRows({
  rows,
  columnTypes,
  sortColumnIndex,
  sortDirection,
}: UseSortedRowsOptions): UseSortedRowsResult {
  return useMemo(() => {
    // No sorting if no column selected or no direction
    if (sortColumnIndex === null || sortDirection === null) {
      return {
        sortedRows: rows,
        originalIndices: rows.map((_, i) => i),
      };
    }

    // Create indexed array for sorting
    const indexed = rows.map((row, index) => ({ row, originalIndex: index }));

    // Determine column type for appropriate comparison
    const columnType = columnTypes?.[sortColumnIndex]?.toLowerCase() || '';
    const isNumericType = /int|float|double|decimal|numeric|real|bit/i.test(columnType);
    const isDateType = /date|time|timestamp|year/i.test(columnType);

    indexed.sort((a, b) => {
      const valA = a.row[sortColumnIndex];
      const valB = b.row[sortColumnIndex];

      // NULL handling: NULL values always go to the end
      if (valA === null && valB === null) return 0;
      if (valA === null) return 1;
      if (valB === null) return -1;

      let comparison = 0;

      if (isNumericType) {
        // Numeric comparison
        const numA = typeof valA === 'number' ? valA : parseFloat(String(valA));
        const numB = typeof valB === 'number' ? valB : parseFloat(String(valB));
        comparison = numA - numB;
      } else if (isDateType) {
        // Date comparison
        const dateA = new Date(String(valA)).getTime();
        const dateB = new Date(String(valB)).getTime();
        comparison = dateA - dateB;
      } else {
        // String comparison with natural sorting
        comparison = String(valA).localeCompare(String(valB), undefined, {
          numeric: true,
          sensitivity: 'base',
        });
      }

      // Apply sort direction
      return sortDirection === 'desc' ? -comparison : comparison;
    });

    return {
      sortedRows: indexed.map(item => item.row),
      originalIndices: indexed.map(item => item.originalIndex),
    };
  }, [rows, columnTypes, sortColumnIndex, sortDirection]);
}
