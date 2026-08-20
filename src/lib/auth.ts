import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export const SESSION_COOKIE = "minichat_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

type SessionPayload = {
  name: string;
  issuedAt: number;
  nonce: string;
};

function getAccessKey() {
  return process.env.CHAT_ACCESS_KEY?.trim() || "";
}

function getSessionSecret() {
  return process.env.CHAT_SESSION_SECRET?.trim() || getAccessKey();
}

function toBase64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function fromBase64Url(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(value: string) {
  return createHmac("sha256", getSessionSecret()).update(value).digest("base64url");
}

export function sanitizeName(value: unknown) {
  if (typeof value !== "string") return "";

  return value
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 32);
}

export function isAccessKeyValid(value: unknown) {
  const accessKey = getAccessKey();
  if (!accessKey || typeof value !== "string") return false;

  const expectedHash = createHash("sha256").update(accessKey).digest();
  const providedHash = createHash("sha256").update(value).digest();
  return timingSafeEqual(expectedHash, providedHash);
}

export function createSessionToken(name: string) {
  const payload: SessionPayload = {
    name,
    issuedAt: Date.now(),
    nonce: randomBytes(16).toString("hex"),
  };
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  return `${encodedPayload}.${sign(encodedPayload)}`;
}

export function readSessionToken(token: string | undefined) {
  if (!token || !getSessionSecret()) return null;

  const [encodedPayload, providedSignature] = token.split(".");
  if (!encodedPayload || !providedSignature) return null;

  const expectedSignature = sign(encodedPayload);
  const expectedBuffer = Buffer.from(expectedSignature);
  const providedBuffer = Buffer.from(providedSignature);
  if (
    expectedBuffer.length !== providedBuffer.length ||
    !timingSafeEqual(expectedBuffer, providedBuffer)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(fromBase64Url(encodedPayload)) as SessionPayload;
    const name = sanitizeName(payload.name);
    const issuedAt = Number(payload.issuedAt);
    if (!name || !Number.isFinite(issuedAt)) return null;
    if (Date.now() - issuedAt > SESSION_MAX_AGE * 1000) return null;
    if (issuedAt > Date.now() + 60_000) return null;
    return { name };
  } catch {
    return null;
  }
}

export function getSessionFromRequest(request: Request) {
  const cookieHeader = request.headers.get("cookie") || "";
  const token = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);

  return readSessionToken(token);
}

export function sessionCookieOptions(request?: Request) {
  const forwardedProtocol = request?.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    .trim();
  const requestProtocol = request ? new URL(request.url).protocol : "http:";
  const isHttps = forwardedProtocol === "https" || requestProtocol === "https:";

  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production" && isHttps,
    path: "/",
    maxAge: SESSION_MAX_AGE,
  };
}
