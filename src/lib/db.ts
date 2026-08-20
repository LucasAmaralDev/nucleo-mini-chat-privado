import fs from "node:fs";
import path from "node:path";
import initSqlJs, { type Database } from "sql.js";

export type ChatMessage = {
  id: number;
  authorName: string;
  body: string;
  createdAt: number;
  imageUrl?: string;
  replyTo?: MessageReply;
};

export type MessageImage = {
  filename: string;
  mimeType: string;
};

export type MessageReply = {
  id: number;
  authorName: string;
  body: string;
  hasImage: boolean;
};

export class ReplyTargetNotFoundError extends Error {
  constructor() {
    super("A mensagem respondida não está mais disponível.");
  }
}

type DatabaseState = {
  database: Database;
  databasePath: string;
};

type GlobalWithDatabase = typeof globalThis & {
  __minichatDatabasePromise?: Promise<DatabaseState>;
  __minichatMutationTail?: Promise<void>;
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
      image_filename TEXT,
      image_mime TEXT,
      reply_to_id INTEGER,
      reply_to_author_name TEXT,
      reply_to_body TEXT,
      reply_to_has_image INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_created_at
      ON messages (created_at, id);
  `);

  const columns = database.exec("PRAGMA table_info(messages)")[0]?.values ?? [];
  const columnNames = new Set(columns.map((column) => String(column[1])));

  if (!columnNames.has("image_filename")) {
    database.run("ALTER TABLE messages ADD COLUMN image_filename TEXT");
  }

  if (!columnNames.has("image_mime")) {
    database.run("ALTER TABLE messages ADD COLUMN image_mime TEXT");
  }

  if (!columnNames.has("reply_to_id")) {
    database.run("ALTER TABLE messages ADD COLUMN reply_to_id INTEGER");
  }

  if (!columnNames.has("reply_to_author_name")) {
    database.run("ALTER TABLE messages ADD COLUMN reply_to_author_name TEXT");
  }

  if (!columnNames.has("reply_to_body")) {
    database.run("ALTER TABLE messages ADD COLUMN reply_to_body TEXT");
  }

  if (!columnNames.has("reply_to_has_image")) {
    database.run(
      "ALTER TABLE messages ADD COLUMN reply_to_has_image INTEGER NOT NULL DEFAULT 0",
    );
  }
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

export async function runChatMutation<T>(operation: () => Promise<T> | T) {
  const previousMutation = globalWithDatabase.__minichatMutationTail ?? Promise.resolve();
  let releaseMutation: (() => void) | undefined;
  const currentMutation = new Promise<void>((resolve) => {
    releaseMutation = resolve;
  });
  globalWithDatabase.__minichatMutationTail = previousMutation.then(
    () => currentMutation,
  );

  await previousMutation;

  try {
    return await operation();
  } finally {
    releaseMutation?.();
  }
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
        image_filename AS imageFilename,
        reply_to_id AS replyToId,
        reply_to_author_name AS replyToAuthorName,
        reply_to_body AS replyToBody,
        reply_to_has_image AS replyToHasImage,
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
      ([
        id,
        authorName,
        body,
        imageFilename,
        replyToId,
        replyToAuthorName,
        replyToBody,
        replyToHasImage,
        createdAt,
      ]) =>
        ({
          id: Number(id),
          authorName: String(authorName),
          body: String(body),
          createdAt: Number(createdAt),
          imageUrl:
            typeof imageFilename === "string"
              ? `/api/images/${encodeURIComponent(imageFilename)}`
              : undefined,
          replyTo:
            typeof replyToId === "number" &&
            typeof replyToAuthorName === "string" &&
            typeof replyToBody === "string"
              ? {
                  id: replyToId,
                  authorName: replyToAuthorName,
                  body: replyToBody,
                  hasImage: Number(replyToHasImage) === 1,
                }
              : undefined,
        }) satisfies ChatMessage,
    )
    .reverse();
}

export async function createMessage(
  authorName: string,
  body: string,
  image?: MessageImage,
  replyToId?: number,
) {
  const createdAt = Date.now();
  const databaseState = await getDatabase();
  const { database } = databaseState;
  let replyTo: MessageReply | undefined;

  if (replyToId !== undefined) {
    const replyRow = database.exec(
      `
        SELECT id, author_name, body, image_filename
        FROM messages
        WHERE id = ?
        LIMIT 1
      `,
      [replyToId],
    )[0]?.values[0];

    if (!replyRow) throw new ReplyTargetNotFoundError();

    replyTo = {
      id: Number(replyRow[0]),
      authorName: String(replyRow[1]),
      body: String(replyRow[2]),
      hasImage: typeof replyRow[3] === "string",
    };
  }

  database.run(
    `
      INSERT INTO messages (
        author_name,
        body,
        image_filename,
        image_mime,
        reply_to_id,
        reply_to_author_name,
        reply_to_body,
        reply_to_has_image,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      authorName,
      body,
      image?.filename ?? null,
      image?.mimeType ?? null,
      replyTo?.id ?? null,
      replyTo?.authorName ?? null,
      replyTo?.body ?? null,
      replyTo?.hasImage ? 1 : 0,
      createdAt,
    ],
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
    imageUrl: image
      ? `/api/images/${encodeURIComponent(image.filename)}`
      : undefined,
    replyTo,
  } satisfies ChatMessage;
}

export async function clearMessages() {
  const databaseState = await getDatabase();
  const { database } = databaseState;
  const messageCount = Number(
    database.exec("SELECT COUNT(*) AS total FROM messages")[0]?.values[0]?.[0] ?? 0,
  );

  database.run("DELETE FROM messages");
  database.run("DELETE FROM sqlite_sequence WHERE name = 'messages'");
  persistDatabase(databaseState);

  return messageCount;
}
