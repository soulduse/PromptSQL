/**
 * SQL 쿼리 위험도 분석 유틸리티
 */

export type DangerLevel = 'safe' | 'warning' | 'danger';

export interface SqlDangerInfo {
  level: DangerLevel;
  type: string | null;
  message: string;
}

/**
 * SQL 쿼리의 위험도를 분석합니다.
 *
 * - danger: DELETE, DROP, TRUNCATE (데이터 손실 가능)
 * - warning: UPDATE, INSERT, ALTER, CREATE (데이터 변경)
 * - safe: SELECT 등 (읽기 전용)
 */
export function analyzeSqlDanger(sql: string): SqlDangerInfo {
  // Remove comments and get actual SQL statement
  const normalized = sql
    .trim()
    .replace(/--[^\n]*\n?/g, '')  // Remove single-line comments
    .replace(/\/\*[\s\S]*?\*\//g, '')  // Remove multi-line comments
    .trim();
  const firstWord = normalized.split(/\s+/)[0]?.toUpperCase();

  // 위험 (데이터 손실 가능)
  const dangerKeywords = ['DELETE', 'DROP', 'TRUNCATE'];
  if (dangerKeywords.includes(firstWord)) {
    return {
      level: 'danger',
      type: firstWord,
      message: getDangerMessage(firstWord),
    };
  }

  // 경고 (데이터 변경)
  const warningKeywords = ['UPDATE', 'INSERT', 'ALTER', 'CREATE'];
  if (warningKeywords.includes(firstWord)) {
    return {
      level: 'warning',
      type: firstWord,
      message: getWarningMessage(firstWord),
    };
  }

  return {
    level: 'safe',
    type: null,
    message: '',
  };
}

function getDangerMessage(type: string): string {
  switch (type) {
    case 'DELETE':
      return 'deleteWarning';
    case 'DROP':
      return 'dropWarning';
    case 'TRUNCATE':
      return 'truncateWarning';
    default:
      return 'dangerWarning';
  }
}

function getWarningMessage(type: string): string {
  switch (type) {
    case 'UPDATE':
      return 'updateWarning';
    case 'INSERT':
      return 'insertWarning';
    case 'ALTER':
      return 'alterWarning';
    case 'CREATE':
      return 'createWarning';
    default:
      return 'modifyWarning';
  }
}

/**
 * 버튼 색상 클래스를 반환합니다.
 */
export function getDangerButtonClasses(level: DangerLevel): string {
  switch (level) {
    case 'danger':
      return 'text-red-400 hover:text-red-300 hover:bg-red-600/20';
    case 'warning':
      return 'text-amber-400 hover:text-amber-300 hover:bg-amber-600/20';
    case 'safe':
    default:
      return 'text-green-400 hover:text-green-300 hover:bg-green-600/20';
  }
}
