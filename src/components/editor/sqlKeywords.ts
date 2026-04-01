// SQL Keywords for autocomplete
export const SQL_KEYWORDS = [
  // DML
  'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'FROM', 'WHERE', 'AND', 'OR', 'NOT',
  'IN', 'LIKE', 'BETWEEN', 'IS', 'NULL', 'AS', 'DISTINCT', 'ALL',
  // Joins
  'JOIN', 'INNER', 'LEFT', 'RIGHT', 'OUTER', 'CROSS', 'ON', 'USING',
  // Clauses
  'ORDER', 'BY', 'ASC', 'DESC', 'GROUP', 'HAVING', 'LIMIT', 'OFFSET',
  // Aggregates
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX',
  // DDL
  'CREATE', 'ALTER', 'DROP', 'TABLE', 'INDEX', 'VIEW', 'DATABASE',
  // Others
  'SET', 'VALUES', 'INTO', 'UNION', 'EXCEPT', 'INTERSECT',
  'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'EXISTS',
  'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES', 'UNIQUE', 'DEFAULT',
  'AUTO_INCREMENT', 'NOT NULL', 'CASCADE',
  'TRUNCATE', 'RENAME', 'ADD', 'MODIFY', 'COLUMN',
  'IF', 'ELSE', 'WHILE', 'LOOP', 'BEGIN', 'COMMIT', 'ROLLBACK',
  'GRANT', 'REVOKE', 'SHOW', 'DESCRIBE', 'EXPLAIN', 'USE',
];

export const SQL_FUNCTIONS = [
  // Date/Time functions
  'NOW()', 'CURDATE()', 'CURTIME()', 'DATE()', 'TIME()',
  'YEAR()', 'MONTH()', 'DAY()', 'HOUR()', 'MINUTE()', 'SECOND()',
  'DATE_FORMAT()', 'DATE_ADD()', 'DATE_SUB()', 'DATEDIFF()', 'TIMESTAMPDIFF()',
  // String functions
  'CONCAT()', 'SUBSTRING()', 'LENGTH()', 'TRIM()', 'UPPER()', 'LOWER()',
  'LEFT()', 'RIGHT()', 'REPLACE()', 'REVERSE()', 'LPAD()', 'RPAD()',
  'LOCATE()', 'INSTR()', 'CHAR_LENGTH()',
  // Numeric functions
  'ROUND()', 'FLOOR()', 'CEIL()', 'ABS()', 'MOD()', 'POWER()', 'SQRT()',
  'RAND()', 'SIGN()', 'TRUNCATE()',
  // Conditional functions
  'IFNULL()', 'COALESCE()', 'IF()', 'NULLIF()', 'CASE()',
  // Aggregate functions
  'COUNT()', 'SUM()', 'AVG()', 'MIN()', 'MAX()', 'GROUP_CONCAT()',
  // Other functions
  'CAST()', 'CONVERT()', 'UUID()', 'VERSION()', 'DATABASE()', 'USER()',
];
