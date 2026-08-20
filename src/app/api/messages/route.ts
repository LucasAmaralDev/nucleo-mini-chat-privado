import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { createMessage, listMessages } from "@/lib/db";
import { publishMessage } from "@/lib/realtime";

export const runtime = "nodejs";

function unauthorized() {
  return NextResponse.json(
    { error: "Sua sessão não está autorizada." },
    { status: 401 },
  );
}

export async function GET(request: Request) {
  const session = getSessionFromRequest(request);
  if (!session) return unauthorized();

  return NextResponse.json(
    { name: session.name, messages: listMessages() },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const session = getSessionFromRequest(request);
  if (!session) return unauthorized();

  try {
    const payload = (await request.json()) as { body?: unknown };
    const body =
      typeof payload.body === "string"
        ? payload.body
            .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
            .replace(/\r\n?/g, "\n")
            .trim()
        : "";

    if (!body) {
      return NextResponse.json(
        { error: "Escreva uma mensagem antes de enviar." },
        { status: 400 },
      );
    }

    if (body.length > 2000) {
      return NextResponse.json(
        { error: "A mensagem pode ter no máximo 2.000 caracteres." },
        { status: 400 },
      );
    }

    const message = createMessage(session.name, body);
    publishMessage(message);
    return NextResponse.json({ message }, { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Não foi possível enviar a mensagem." },
      { status: 400 },
    );
  }
}
