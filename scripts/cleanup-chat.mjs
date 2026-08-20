import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

const cleanupKey = process.env.CHAT_CLEANUP_KEY?.trim();
const internalUrl = (process.env.CHAT_INTERNAL_URL || "http://127.0.0.1:25000").replace(
  /\/$/,
  "",
);

if (!cleanupKey) {
  console.error("CHAT_CLEANUP_KEY não está definida.");
  process.exit(1);
}

const response = await fetch(`${internalUrl}/api/internal/cleanup`, {
  headers: { Authorization: `Bearer ${cleanupKey}` },
  method: "POST",
});
const payload = await response.json().catch(() => null);

if (!response.ok || !payload?.clearedAt) {
  console.error(payload?.error || `Falha na limpeza (HTTP ${response.status}).`);
  process.exit(1);
}

console.log(
  `[${payload.clearedAt}] limpeza concluída: ${payload.deletedMessages} mensagens e ${payload.deletedFiles} arquivos removidos.`,
);
