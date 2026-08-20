import { NextResponse } from "next/server";
import {
  createSessionToken,
  isAccessKeyValid,
  sanitizeName,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as { name?: unknown; key?: unknown };
    const name = sanitizeName(payload.name);

    if (name.length < 2) {
      return NextResponse.json(
        { error: "Digite um nome com pelo menos 2 caracteres." },
        { status: 400 },
      );
    }

    if (!isAccessKeyValid(payload.key)) {
      return NextResponse.json(
        { error: "A chave de acesso não é válida." },
        { status: 401 },
      );
    }

    const response = NextResponse.json({ ok: true, name });
    response.cookies.set(
      SESSION_COOKIE,
      createSessionToken(name),
      sessionCookieOptions(request),
    );
    return response;
  } catch {
    return NextResponse.json(
      { error: "Não foi possível validar o acesso." },
      { status: 400 },
    );
  }
}
