import fs from "node:fs";
import path from "node:path";
import initSqlJs, { type Database } from "sql.js";

export type ChatMessage = {
  id: number;
  authorName: string;
  body: string;
  createdAt: number;
};

type DatabaseState = {
  database: Database;
  databasePath: string;
};

type GlobalWithDatabase = typeof globalThis & {
  __minichatDatabasePromise?: Promise<DatabaseState>;
};

const globalWithDatabase = globalThis as GlobalWithDatabase;

function resolveDatabasePath() {
  const configuredPath = process.env.CHAT_DB_PATH || "./data/chat.db";
  return path.isAbsolute(configuredPath)
    ? configuredPath
    : path.resolve(/* turbopackIgnore: true */ configuredPath);
}

function initializeDatabase(database: Database) {
  database.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      author_name TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_created_at
      ON messages (created_at, id);
  `);
}

async function openDatabase(): Promise<DatabaseState> {
  const databasePath = resolveDatabasePath();
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });

  const walPath = `${databasePath}-wal`;
  if (fs.existsSync(walPath) && fs.statSync(walPath).size > 0) {
    throw new Error(
      `O banco SQLite ainda possui o arquivo WAL em ${walPath}. Execute o checkpoint indicado no README antes de iniciar esta versão.`,
    );
  }

  const databaseFile = fs.existsSync(databasePath)
    ? new Uint8Array(fs.readFileSync(databasePath))
    : undefined;
  const SQL = await initSqlJs();
  const database = new SQL.Database(databaseFile);

  initializeDatabase(database);
  return { database, databasePath };
}

function getDatabase() {
  if (!globalWithDatabase.__minichatDatabasePromise) {
    const databasePromise = openDatabase();
    globalWithDatabase.__minichatDatabasePromise = databasePromise;

    void databasePromise.catch(() => {
      if (globalWithDatabase.__minichatDatabasePromise === databasePromise) {
        delete globalWithDatabase.__minichatDatabasePromise;
      }
    });
  }

  return globalWithDatabase.__minichatDatabasePromise;
}

function persistDatabase({ database, databasePath }: DatabaseState) {
  const temporaryPath = `${databasePath}.tmp`;
  fs.writeFileSync(temporaryPath, Buffer.from(database.export()));
  fs.renameSync(temporaryPath, databasePath);
}

export async function listMessages(limit = 100) {
  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 200);
  const { database } = await getDatabase();
  const result = database.exec(
    `
      SELECT
        id,
        author_name AS authorName,
        body,
        created_at AS createdAt
      FROM messages
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `,
    [safeLimit],
  );
  const rows = result[0]?.values ?? [];

  return rows
    .map(
      ([id, authorName, body, createdAt]) =>
        ({
          id: Number(id),
          authorName: String(authorName),
          body: String(body),
          createdAt: Number(createdAt),
        }) satisfies ChatMessage,
    )
    .reverse();
}

export async function createMessage(authorName: string, body: string) {
  const createdAt = Date.now();
  const databaseState = await getDatabase();
  const { database } = databaseState;

  database.run(
    `
      INSERT INTO messages (author_name, body, created_at)
      VALUES (?, ?, ?)
    `,
    [authorName, body, createdAt],
  );

  const id = Number(
    database.exec("SELECT last_insert_rowid() AS id")[0]?.values[0]?.[0],
  );
  persistDatabase(databaseState);

  return {
    id,
    authorName,
    body,
    createdAt,
  } satisfies ChatMessage;
}
