import { NextResponse } from "next/server";
import { isCleanupRequestAuthorized } from "@/lib/auth";
import { clearMessages, runChatMutation } from "@/lib/db";
import { publishChatCleared } from "@/lib/realtime";
import { deleteAllImages } from "@/lib/uploads";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isCleanupRequestAuthorized(request)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  try {
    const result = await runChatMutation(async () => ({
      deletedFiles: deleteAllImages(),
      deletedMessages: await clearMessages(),
    }));

    publishChatCleared();
    return NextResponse.json(
      { ok: true, ...result, clearedAt: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Não foi possível limpar a conversa." },
      { status: 500 },
    );
  }
}
