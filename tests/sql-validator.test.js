import { describe, it, expect } from 'vitest';
import { validateSql } from '../security/sql-validator.js';

describe('SQL Validator', () => {
  it('should accept valid SELECT queries', () => {
    const result = validateSql('SELECT * FROM orders');
    expect(result.valid).toBe(true);
  });

  it('should accept SHOW queries', () => {
    const result = validateSql('SHOW TABLES');
    expect(result.valid).toBe(true);
  });

  it('should accept DESCRIBE queries', () => {
    const result = validateSql('DESCRIBE orders');
    expect(result.valid).toBe(true);
  });

  it('should accept EXPLAIN queries', () => {
    const result = validateSql('EXPLAIN SELECT * FROM orders');
    expect(result.valid).toBe(true);
  });

  it('should reject INSERT', () => {
    const result = validateSql('INSERT INTO orders VALUES (1)');
    expect(result.valid).toBe(false);
  });

  it('should reject UPDATE', () => {
    const result = validateSql('UPDATE orders SET status = "done"');
    expect(result.valid).toBe(false);
  });

  it('should reject DELETE', () => {
    const result = validateSql('DELETE FROM orders WHERE id = 1');
    expect(result.valid).toBe(false);
  });

  it('should reject DROP', () => {
    const result = validateSql('DROP TABLE orders');
    expect(result.valid).toBe(false);
  });

  it('should reject ALTER', () => {
    const result = validateSql('ALTER TABLE orders ADD COLUMN test INT');
    expect(result.valid).toBe(false);
  });

  it('should reject TRUNCATE', () => {
    const result = validateSql('TRUNCATE TABLE orders');
    expect(result.valid).toBe(false);
  });

  it('should reject multiple statements', () => {
    const result = validateSql('SELECT * FROM orders; DROP TABLE orders');
    expect(result.valid).toBe(false);
  });

  it('should reject SLEEP injection', () => {
    const result = validateSql('SELECT SLEEP(5)');
    expect(result.valid).toBe(false);
  });

  it('should reject empty queries', () => {
    const result = validateSql('');
    expect(result.valid).toBe(false);
  });

  it('should reject null input', () => {
    const result = validateSql(null);
    expect(result.valid).toBe(false);
  });
});
