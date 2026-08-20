import { NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth";
import { createMessage, listMessages, runChatMutation } from "@/lib/db";
import { publishMessage } from "@/lib/realtime";
import { deleteImage, saveImage, type StoredImage } from "@/lib/uploads";

export const runtime = "nodejs";

function unauthorized() {
  return NextResponse.json(
    { error: "Sua sessão não está autorizada." },
    { status: 401 },
  );
}

function sanitizeBody(value: unknown) {
  return typeof value === "string"
    ? value
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
        .replace(/\r\n?/g, "\n")
        .trim()
    : "";
}

function isFile(value: FormDataEntryValue | null): value is File {
  return value !== null && typeof value !== "string" && "arrayBuffer" in value;
}

export async function GET(request: Request) {
  const session = getSessionFromRequest(request);
  if (!session) return unauthorized();

  return NextResponse.json(
    { name: session.name, messages: await listMessages() },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const session = getSessionFromRequest(request);
  if (!session) return unauthorized();

  let uploadedImage: StoredImage | undefined;

  try {
    let bodyValue: unknown;
    let imageFile: File | null = null;

    if (request.headers.get("content-type")?.includes("application/json")) {
      const payload = (await request.json()) as { body?: unknown };
      bodyValue = payload.body;
    } else {
      const formData = await request.formData();
      bodyValue = formData.get("body");
      const imageValue = formData.get("image");

      if (imageValue !== null && !isFile(imageValue)) {
        return NextResponse.json(
          { error: "Não foi possível ler a imagem enviada." },
          { status: 400 },
        );
      }

      imageFile = imageValue;
    }

    const body = sanitizeBody(bodyValue);
    const hasImage = Boolean(imageFile && imageFile.size > 0);

    if (!body && !hasImage) {
      return NextResponse.json(
        { error: "Escreva uma mensagem ou escolha uma imagem." },
        { status: 400 },
      );
    }

    if (body.length > 2000) {
      return NextResponse.json(
        { error: "A mensagem pode ter no máximo 2.000 caracteres." },
        { status: 400 },
      );
    }

    const imageBytes =
      imageFile && hasImage
        ? new Uint8Array(await imageFile.arrayBuffer())
        : undefined;
    const message = await runChatMutation(async () => {
      if (imageFile && imageBytes) {
        uploadedImage = saveImage(imageBytes, imageFile.type);
      }

      return createMessage(session.name, body, uploadedImage);
    });
    publishMessage(message);
    return NextResponse.json({ message }, { status: 201 });
  } catch {
    if (uploadedImage) deleteImage(uploadedImage.filename);
    return NextResponse.json(
      { error: "Não foi possível enviar a mensagem." },
      { status: 400 },
    );
  }
}
