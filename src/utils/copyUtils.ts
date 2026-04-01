import { ColumnInfo } from "../stores/tabStore";

export type CellValue = string | number | boolean | null;
export type Row = CellValue[];

// Escape value for SQL
function escapeSqlValue(value: CellValue): string {
  if (value === null) return "NULL";
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "number") return String(value);
  // String: escape quotes
  return `'${String(value).replace(/'/g, "''")}'`;
}

// Escape value for CSV (RFC 4180)
function escapeCsvValue(value: CellValue): string {
  if (value === null) return "";
  const str = String(value);
  // If contains comma, newline, or quote, wrap in quotes and escape quotes
  if (str.includes(",") || str.includes("\n") || str.includes('"')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// Escape value for HTML
function escapeHtmlValue(value: CellValue): string {
  if (value === null) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Escape value for Markdown/Wiki (pipe character)
function escapeMarkdownValue(value: CellValue): string {
  if (value === null) return "";
  return String(value).replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}

/**
 * Copy as tab-separated values (TSV)
 */
export function formatAsTSV(rows: Row[]): string {
  return rows
    .map((row) => row.map((cell) => (cell === null ? "" : String(cell))).join("\t"))
    .join("\n");
}

/**
 * Copy with column headers (TSV with header row)
 */
export function formatWithHeaders(rows: Row[], columns: string[]): string {
  const header = columns.join("\t");
  const body = formatAsTSV(rows);
  return `${header}\n${body}`;
}

/**
 * Copy as SQL INSERT statements
 */
export function formatAsSqlInsert(
  rows: Row[],
  columns: string[],
  tableName: string
): string {
  if (rows.length === 0) return "";

  const columnList = columns.map((c) => `\`${c}\``).join(", ");

  return rows
    .map((row) => {
      const values = row.map(escapeSqlValue).join(", ");
      return `INSERT INTO \`${tableName}\` (${columnList}) VALUES (${values});`;
    })
    .join("\n");
}

/**
 * Copy as SQL INSERT without auto_increment columns
 */
export function formatAsSqlInsertNoAutoInc(
  rows: Row[],
  columns: string[],
  tableName: string,
  tableStructure: ColumnInfo[] | null
): string {
  if (rows.length === 0) return "";
  if (!tableStructure) return formatAsSqlInsert(rows, columns, tableName);

  // Find auto_increment columns
  const autoIncColumns = new Set(
    tableStructure
      .filter((col) => col.extra.toLowerCase().includes("auto_increment"))
      .map((col) => col.field)
  );

  // Filter out auto_increment columns
  const filteredIndices: number[] = [];
  const filteredColumns: string[] = [];

  columns.forEach((col, idx) => {
    if (!autoIncColumns.has(col)) {
      filteredIndices.push(idx);
      filteredColumns.push(col);
    }
  });

  if (filteredColumns.length === 0) return "";

  const columnList = filteredColumns.map((c) => `\`${c}\``).join(", ");

  return rows
    .map((row) => {
      const values = filteredIndices.map((idx) => escapeSqlValue(row[idx])).join(", ");
      return `INSERT INTO \`${tableName}\` (${columnList}) VALUES (${values});`;
    })
    .join("\n");
}

/**
 * Copy IDs (Primary Key values only)
 */
export function formatAsIDs(
  rows: Row[],
  columns: string[],
  tableStructure: ColumnInfo[] | null
): string {
  if (rows.length === 0) return "";

  // Find primary key column index
  let pkIndex = 0; // Default to first column if no PK found

  if (tableStructure) {
    const pkColumn = tableStructure.find((col) => col.key === "PRI");
    if (pkColumn) {
      const idx = columns.indexOf(pkColumn.field);
      if (idx !== -1) pkIndex = idx;
    }
  }

  return rows
    .map((row) => (row[pkIndex] === null ? "" : String(row[pkIndex])))
    .join("\n");
}

/**
 * Copy as CSV
 */
export function formatAsCSV(rows: Row[], columns: string[]): string {
  const header = columns.map(escapeCsvValue).join(",");
  const body = rows.map((row) => row.map(escapeCsvValue).join(",")).join("\n");
  return `${header}\n${body}`;
}

/**
 * Copy as HTML table
 */
export function formatAsHTML(rows: Row[], columns: string[]): string {
  const headerRow = `<tr>${columns.map((c) => `<th>${escapeHtmlValue(c)}</th>`).join("")}</tr>`;
  const bodyRows = rows
    .map(
      (row) =>
        `<tr>${row.map((cell) => `<td>${escapeHtmlValue(cell)}</td>`).join("")}</tr>`
    )
    .join("\n");

  return `<table>
<thead>
${headerRow}
</thead>
<tbody>
${bodyRows}
</tbody>
</table>`;
}

/**
 * Copy as JSON array of objects
 */
export function formatAsJSON(rows: Row[], columns: string[]): string {
  const objects = rows.map((row) => {
    const obj: Record<string, CellValue> = {};
    columns.forEach((col, idx) => {
      obj[col] = row[idx];
    });
    return obj;
  });
  return JSON.stringify(objects, null, 2);
}

/**
 * Copy as Markdown table
 */
export function formatAsMarkdown(rows: Row[], columns: string[]): string {
  const header = `| ${columns.map(escapeMarkdownValue).join(" | ")} |`;
  const separator = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows
    .map((row) => `| ${row.map(escapeMarkdownValue).join(" | ")} |`)
    .join("\n");

  return `${header}\n${separator}\n${body}`;
}

/**
 * Copy as Wiki table (MediaWiki format)
 */
export function formatAsWiki(rows: Row[], columns: string[]): string {
  const header = `{| class="wikitable"\n|-\n! ${columns.join(" !! ")}`;
  const body = rows
    .map((row) => {
      const cells = row.map((cell) => (cell === null ? "" : String(cell))).join(" || ");
      return `|-\n| ${cells}`;
    })
    .join("\n");

  return `${header}\n${body}\n|}`;
}

/**
 * Copy to clipboard
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    console.error("Failed to copy:", err);
    return false;
  }
}
