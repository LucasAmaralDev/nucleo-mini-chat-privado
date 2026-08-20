import { getSessionFromRequest } from "@/lib/auth";
import {
  addRealtimeClient,
  encodeServerEvent,
  removeRealtimeClient,
} from "@/lib/realtime";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!getSessionFromRequest(request)) {
    return new Response("Não autorizado", { status: 401 });
  }

  let cleanup = () => undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encodeServerEvent("ping", { at: Date.now() }));
        } catch {
          cleanup();
        }
      }, 25_000);

      addRealtimeClient(controller);
      controller.enqueue(encodeServerEvent("ready", { at: Date.now() }));

      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        removeRealtimeClient(controller);
      };

      request.signal.addEventListener("abort", cleanup, { once: true });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}
