import type { ChatMessage } from "@/lib/db";

type RealtimeClient = ReadableStreamDefaultController<Uint8Array>;

type GlobalWithRealtime = typeof globalThis & {
  __minichatRealtime?: {
    clients: Set<RealtimeClient>;
  };
};

const globalWithRealtime = globalThis as GlobalWithRealtime;
const encoder = new TextEncoder();

function getRealtime() {
  if (!globalWithRealtime.__minichatRealtime) {
    globalWithRealtime.__minichatRealtime = { clients: new Set() };
  }

  return globalWithRealtime.__minichatRealtime;
}

export function addRealtimeClient(client: RealtimeClient) {
  getRealtime().clients.add(client);
}

export function removeRealtimeClient(client: RealtimeClient) {
  getRealtime().clients.delete(client);
}

export function encodeServerEvent(event: string, data: unknown) {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function publishMessage(message: ChatMessage) {
  const chunk = encodeServerEvent("message", message);

  for (const client of getRealtime().clients) {
    try {
      client.enqueue(chunk);
    } catch {
      removeRealtimeClient(client);
    }
  }
}

export function publishChatCleared() {
  const chunk = encodeServerEvent("cleared", { at: Date.now() });

  for (const client of getRealtime().clients) {
    try {
      client.enqueue(chunk);
    } catch {
      removeRealtimeClient(client);
    }
  }
}
