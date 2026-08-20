import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const MAX_IMAGE_SIZE = 4 * 1024 * 1024;

const imageTypes = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

type ImageMimeType = keyof typeof imageTypes;

export type StoredImage = {
  filename: string;
  mimeType: ImageMimeType;
};

function resolveUploadsPath() {
  const configuredPath = process.env.CHAT_UPLOADS_PATH || "./data/uploads";
  return path.isAbsolute(configuredPath)
    ? configuredPath
    : path.resolve(/* turbopackIgnore: true */ configuredPath);
}

function assertSafeUploadsPath(uploadsPath: string) {
  if (path.parse(uploadsPath).root === uploadsPath) {
    throw new Error("O diretório de uploads não pode ser a raiz do sistema.");
  }
}

function isImageMimeType(value: string): value is ImageMimeType {
  return value in imageTypes;
}

function hasValidSignature(bytes: Uint8Array, mimeType: ImageMimeType) {
  if (mimeType === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }

  if (mimeType === "image/png") {
    return (
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    );
  }

  return (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  );
}

export function saveImage(bytes: Uint8Array, mimeType: string): StoredImage {
  if (!isImageMimeType(mimeType)) {
    throw new Error("Envie uma imagem JPEG, PNG ou WebP.");
  }

  if (bytes.length === 0 || bytes.length > MAX_IMAGE_SIZE) {
    throw new Error("A imagem comprimida deve ter no máximo 4 MB.");
  }

  if (!hasValidSignature(bytes, mimeType)) {
    throw new Error("O arquivo enviado não corresponde a uma imagem válida.");
  }

  const filename = `${randomUUID()}.${imageTypes[mimeType]}`;
  const uploadsPath = resolveUploadsPath();
  const imagePath = path.join(/* turbopackIgnore: true */ uploadsPath, filename);
  const temporaryPath = `${imagePath}.tmp`;

  fs.mkdirSync(uploadsPath, { recursive: true });
  fs.writeFileSync(temporaryPath, bytes);
  fs.renameSync(temporaryPath, imagePath);

  return { filename, mimeType };
}

export function deleteImage(filename: string) {
  const imagePath = getImagePath(filename);
  if (imagePath && fs.existsSync(/* turbopackIgnore: true */ imagePath)) {
    fs.unlinkSync(imagePath);
  }
}

export function deleteAllImages() {
  const uploadsPath = resolveUploadsPath();
  assertSafeUploadsPath(uploadsPath);

  if (!fs.existsSync(/* turbopackIgnore: true */ uploadsPath)) return 0;

  const entries = fs.readdirSync(uploadsPath, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(/* turbopackIgnore: true */ uploadsPath, entry.name);
    fs.rmSync(/* turbopackIgnore: true */ entryPath, {
      force: true,
      recursive: entry.isDirectory(),
    });
  }

  return entries.length;
}

export function getImagePath(filename: string) {
  if (!isSafeImageFilename(filename)) return null;
  return path.join(resolveUploadsPath(), filename);
}

export function getImageMimeType(filename: string): ImageMimeType | null {
  const extension = path.extname(filename).toLowerCase().slice(1);
  const match = Object.entries(imageTypes).find(([, value]) => value === extension);
  return (match?.[0] as ImageMimeType | undefined) ?? null;
}

function isSafeImageFilename(filename: string) {
  return /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\.(?:jpg|png|webp)$/i.test(
    filename,
  );
}
