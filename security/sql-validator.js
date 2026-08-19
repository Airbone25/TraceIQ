import { z } from 'zod';

const BLOCKED_KEYWORDS = [
  /\bINSERT\b/i,
  /\bUPDATE\b/i,
  /\bDELETE\b/i,
  /\bDROP\b/i,
  /\bALTER\b/i,
  /\bTRUNCATE\b/i,
  /\bCREATE\b/i,
  /\bGRANT\b/i,
  /\bREVOKE\b/i,
  /\bREPLACE\b/i,
  /\bLOAD\b/i,
  /\bINTO\s+OUTFILE\b/i,
  /\bINTO\s+DUMPFILE\b/i,
  /\bEXEC\b/i,
  /\bEXECUTE\b/i,
  /\bCALL\b/i,
];

const BLOCKED_PATTERNS = [
  { pattern: /;\s*\w/i, description: 'Multiple statements detected' },
  { pattern: /\/\*[\s\S]*\*\//i, description: 'Block comments detected' },
  { pattern: /--\s/m, description: 'Line comments detected' },
  { pattern: /\bSLEEP\s*\(/i, description: 'SLEEP function blocked' },
  { pattern: /\bBENCHMARK\s*\(/i, description: 'BENCHMARK function blocked' },
  { pattern: /\bLOAD_FILE\s*\(/i, description: 'LOAD_FILE blocked' },
];

export function validateSql(sql) {
  const errors = [];

  if (!sql || typeof sql !== 'string') {
    return { valid: false, errors: ['SQL query is required'] };
  }

  const trimmed = sql.trim();
  if (trimmed.length === 0) {
    return { valid: false, errors: ['SQL query cannot be empty'] };
  }

  for (const keyword of BLOCKED_KEYWORDS) {
    if (keyword.test(trimmed)) {
      errors.push(`Blocked keyword/pattern detected: ${keyword.source}`);
    }
  }

  for (const { pattern, description } of BLOCKED_PATTERNS) {
    if (pattern.test(trimmed)) {
      errors.push(description);
    }
  }

  const firstKeyword = trimmed.split(/\s/)[0].toUpperCase();
  if (firstKeyword !== 'SELECT' && firstKeyword !== 'SHOW' && firstKeyword !== 'DESCRIBE' && firstKeyword !== 'EXPLAIN') {
    errors.push(`Query must start with SELECT, SHOW, DESCRIBE, or EXPLAIN. Found: ${firstKeyword}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    sanitized: trimmed,
  };
}
