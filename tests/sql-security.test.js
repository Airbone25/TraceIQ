import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateSql } from '../security/sql-validator.js';

describe('SQL Security Hardening', () => {
  describe('SQL query length limit', () => {
    it('should reject SQL exceeding max length', () => {
      const longSql = 'SELECT * FROM orders WHERE ' + 'id > 1 AND '.repeat(2000);
      const result = validateSql(longSql);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('maximum length');
    });

    it('should accept SQL within length limit', () => {
      const sql = 'SELECT * FROM orders WHERE id > 1';
      const result = validateSql(sql);
      expect(result.valid).toBe(true);
    });

    it('should accept SQL at exactly the max length', () => {
      const prefix = 'SELECT ';
      const suffix = ' FROM orders';
      const pad = 10000 - prefix.length - suffix.length;
      const sql = prefix + 'a'.repeat(pad) + suffix;
      expect(sql.length).toBe(10000);
      const result = validateSql(sql);
      expect(result.valid).toBe(true);
    });
  });

  describe('LIMIT enforcement', () => {
    it('should cap LIMIT above MAX_QUERY_ROWS', () => {
      const result = validateSql('SELECT * FROM orders LIMIT 10000', { maxRows: 500 });
      expect(result.valid).toBe(true);
      expect(result.sanitized).toBe('SELECT * FROM orders LIMIT 500');
    });

    it('should preserve LIMIT at or below MAX_QUERY_ROWS', () => {
      const result = validateSql('SELECT * FROM orders LIMIT 100', { maxRows: 500 });
      expect(result.valid).toBe(true);
      expect(result.sanitized).toBe('SELECT * FROM orders LIMIT 100');
    });

    it('should preserve LIMIT at exactly MAX_QUERY_ROWS', () => {
      const result = validateSql('SELECT * FROM orders LIMIT 500', { maxRows: 500 });
      expect(result.valid).toBe(true);
      expect(result.sanitized).toBe('SELECT * FROM orders LIMIT 500');
    });

    it('should not modify query with no LIMIT (append is done by sql tool)', () => {
      const result = validateSql('SELECT * FROM orders', { maxRows: 500 });
      expect(result.valid).toBe(true);
      expect(result.sanitized).toBe('SELECT * FROM orders');
    });

    it('should strip trailing semicolon and add no LIMIT (append done by sql tool)', () => {
      const result = validateSql('SELECT * FROM orders;', { maxRows: 500 });
      expect(result.valid).toBe(true);
      expect(result.sanitized).toBe('SELECT * FROM orders');
    });

    it('should strip trailing semicolon and cap LIMIT above max', () => {
      const result = validateSql('SELECT * FROM orders LIMIT 10000;', { maxRows: 500 });
      expect(result.valid).toBe(true);
      expect(result.sanitized).toBe('SELECT * FROM orders LIMIT 500');
    });

    it('should strip trailing semicolon and preserve LIMIT below max', () => {
      const result = validateSql('SELECT * FROM orders LIMIT 100;', { maxRows: 500 });
      expect(result.valid).toBe(true);
      expect(result.sanitized).toBe('SELECT * FROM orders LIMIT 100');
    });

    it('should strip trailing semicolon and preserve LIMIT at exact max', () => {
      const result = validateSql('SELECT * FROM orders LIMIT 500;', { maxRows: 500 });
      expect(result.valid).toBe(true);
      expect(result.sanitized).toBe('SELECT * FROM orders LIMIT 500');
    });

    it('should strip trailing whitespace and semicolon', () => {
      const result = validateSql('SELECT * FROM orders   ;  ', { maxRows: 500 });
      expect(result.valid).toBe(true);
      expect(result.sanitized).toBe('SELECT * FROM orders');
    });
  });

  describe('FOR UPDATE blocking', () => {
    it('should block SELECT ... FOR UPDATE', () => {
      const result = validateSql('SELECT * FROM orders WHERE id = 1 FOR UPDATE');
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('FOR UPDATE'))).toBe(true);
    });

    it('should block SELECT FOR UPDATE with extra whitespace', () => {
      const result = validateSql('SELECT * FROM orders WHERE id = 1  FOR  UPDATE');
      expect(result.valid).toBe(false);
    });

    it('should block SELECT FOR UPDATE NOWAIT', () => {
      const result = validateSql('SELECT * FROM orders FOR UPDATE NOWAIT');
      expect(result.valid).toBe(false);
    });
  });

  describe('LOCK IN SHARE MODE blocking', () => {
    it('should block LOCK IN SHARE MODE', () => {
      const result = validateSql('SELECT * FROM orders LOCK IN SHARE MODE');
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('LOCK IN SHARE MODE'))).toBe(true);
    });

    it('should block with case variations', () => {
      const result = validateSql('select * from orders lock in share mode');
      expect(result.valid).toBe(false);
    });
  });

  describe('Existing dangerous SQL patterns', () => {
    it('should block INSERT', () => {
      expect(validateSql('INSERT INTO orders VALUES (1)').valid).toBe(false);
    });

    it('should block UPDATE', () => {
      expect(validateSql('UPDATE orders SET status = "done"').valid).toBe(false);
    });

    it('should block DELETE', () => {
      expect(validateSql('DELETE FROM orders WHERE id = 1').valid).toBe(false);
    });

    it('should block DROP', () => {
      expect(validateSql('DROP TABLE orders').valid).toBe(false);
    });

    it('should block ALTER', () => {
      expect(validateSql('ALTER TABLE orders ADD COLUMN test INT').valid).toBe(false);
    });

    it('should block TRUNCATE', () => {
      expect(validateSql('TRUNCATE TABLE orders').valid).toBe(false);
    });

    it('should block CREATE', () => {
      expect(validateSql('CREATE TABLE evil (id INT)').valid).toBe(false);
    });

    it('should block GRANT', () => {
      expect(validateSql('GRANT ALL ON *.* TO evil').valid).toBe(false);
    });

    it('should block REVOKE', () => {
      expect(validateSql('REVOKE ALL ON *.* FROM root').valid).toBe(false);
    });

    it('should block multiple statements', () => {
      expect(validateSql('SELECT 1; DROP TABLE orders').valid).toBe(false);
    });

    it('should block SLEEP injection', () => {
      expect(validateSql('SELECT SLEEP(5)').valid).toBe(false);
    });

    it('should block BENCHMARK injection', () => {
      expect(validateSql('SELECT BENCHMARK(1000000, SHA1("test"))').valid).toBe(false);
    });

    it('should block LOAD_FILE', () => {
      expect(validateSql('SELECT LOAD_FILE("/etc/passwd")').valid).toBe(false);
    });

    it('should block INTO OUTFILE', () => {
      expect(validateSql('SELECT * INTO OUTFILE "/tmp/evil" FROM orders').valid).toBe(false);
    });

    it('should block CALL', () => {
      expect(validateSql('CALL evil_procedure()').valid).toBe(false);
    });

    it('should block EXEC', () => {
      expect(validateSql('EXEC evil_command').valid).toBe(false);
    });

    it('should block block comments', () => {
      expect(validateSql('SELECT /* comment */ * FROM orders').valid).toBe(false);
    });

    it('should block line comments', () => {
      expect(validateSql('SELECT * FROM orders -- comment').valid).toBe(false);
    });
  });

  describe('Valid queries', () => {
    it('should accept basic SELECT', () => {
      expect(validateSql('SELECT * FROM orders').valid).toBe(true);
    });

    it('should accept SELECT with WHERE', () => {
      expect(validateSql('SELECT * FROM orders WHERE id > 10').valid).toBe(true);
    });

    it('should accept SELECT with JOIN', () => {
      expect(validateSql('SELECT o.*, c.name FROM orders o JOIN customers c ON o.customer_id = c.id').valid).toBe(true);
    });

    it('should accept SHOW TABLES', () => {
      expect(validateSql('SHOW TABLES').valid).toBe(true);
    });

    it('should accept DESCRIBE', () => {
      expect(validateSql('DESCRIBE orders').valid).toBe(true);
    });

    it('should accept EXPLAIN', () => {
      expect(validateSql('EXPLAIN SELECT * FROM orders').valid).toBe(true);
    });

    it('should accept SELECT with parameterized placeholders', () => {
      expect(validateSql('SELECT * FROM orders WHERE id > ? AND status = ?').valid).toBe(true);
    });
  });

  describe('Empty and null inputs', () => {
    it('should reject empty string', () => {
      expect(validateSql('').valid).toBe(false);
    });

    it('should reject null', () => {
      expect(validateSql(null).valid).toBe(false);
    });

    it('should reject undefined', () => {
      expect(validateSql(undefined).valid).toBe(false);
    });

    it('should reject non-string', () => {
      expect(validateSql(123).valid).toBe(false);
    });

    it('should reject whitespace only', () => {
      expect(validateSql('   ').valid).toBe(false);
    });
  });
});
