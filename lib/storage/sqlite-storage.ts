import type { StorageAdapter } from "./storage";

export function createSqliteStorage(): StorageAdapter {
  throw new Error(
    "SQLite adapter is reserved for the next MVP step. Use local JSON storage for now.",
  );
}
