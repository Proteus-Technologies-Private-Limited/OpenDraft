/**
 * Database adapter interface — abstracts SQLite and PostgreSQL behind a common API.
 *
 * All SQL should use `?` placeholders. The PostgreSQL adapter converts them to
 * `$1, $2, ...` automatically.
 */
export interface DBAdapter {
  /** Execute an INSERT / UPDATE / DELETE statement. */
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>;

  /** Execute a SELECT and return the first row (or undefined). */
  get<T = any>(sql: string, params?: unknown[]): Promise<T | undefined>;

  /** Execute a SELECT and return all matching rows. */
  all<T = any>(sql: string, params?: unknown[]): Promise<T[]>;

  /** Execute raw SQL (DDL, multi-statement scripts). */
  exec(sql: string): Promise<void>;

  /** Gracefully close all connections. */
  close(): Promise<void>;
}
