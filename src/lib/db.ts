import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export type ChatMessage = {
  id: number;
  authorName: string;
  body: string;
  createdAt: number;
};

type GlobalWithDatabase = typeof globalThis & {
  __minichatDatabase?: Database.Database;
};

const globalWithDatabase = globalThis as GlobalWithDatabase;

function resolveDatabasePath() {
  const configuredPath = process.env.CHAT_DB_PATH || "./data/chat.db";
  return path.isAbsolute(configuredPath)
    ? configuredPath
    : path.resolve(/* turbopackIgnore: true */ configuredPath);
}

function initializeDatabase(database: Database.Database) {
  database.pragma("journal_mode = WAL");
  database.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      author_name TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_created_at
      ON messages (created_at, id);
  `);
  database.pragma("optimize");
}

function getDatabase() {
  if (!globalWithDatabase.__minichatDatabase) {
    const databasePath = resolveDatabasePath();
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    globalWithDatabase.__minichatDatabase = new Database(databasePath);
    initializeDatabase(globalWithDatabase.__minichatDatabase);
  }

  return globalWithDatabase.__minichatDatabase;
}

export function listMessages(limit = 100) {
  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 200);
  const rows = getDatabase()
    .prepare(
      `
        SELECT
          id,
          author_name AS authorName,
          body,
          created_at AS createdAt
        FROM messages
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      `
    )
    .all(safeLimit) as ChatMessage[];

  return rows.reverse();
}

export function createMessage(authorName: string, body: string) {
  const createdAt = Date.now();
  const result = getDatabase()
    .prepare(
      `
        INSERT INTO messages (author_name, body, created_at)
        VALUES (?, ?, ?)
      `
    )
    .run(authorName, body, createdAt);

  return {
    id: Number(result.lastInsertRowid),
    authorName,
    body,
    createdAt,
  } satisfies ChatMessage;
}
