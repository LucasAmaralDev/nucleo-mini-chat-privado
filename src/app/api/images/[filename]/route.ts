import fs from "node:fs";
import { getSessionFromRequest } from "@/lib/auth";
import { getImageMimeType, getImagePath } from "@/lib/uploads";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ filename: string }> },
) {
  if (!getSessionFromRequest(request)) {
    return new Response("Não autorizado", { status: 401 });
  }

  const { filename } = await context.params;
  const imagePath = getImagePath(filename);
  const mimeType = getImageMimeType(filename);

  if (!imagePath || !mimeType || !fs.existsSync(imagePath)) {
    return new Response("Imagem não encontrada", { status: 404 });
  }

  return new Response(fs.readFileSync(imagePath), {
    headers: {
      "Cache-Control": "private, max-age=86400",
      "Content-Type": mimeType,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
