import { pulseStore } from "@/lib/pulseStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const encoder = new TextEncoder();

  let onEvent: (event: unknown) => void;
  let heartbeat: ReturnType<typeof setInterval>;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

      send("snapshot", pulseStore.snapshot());

      onEvent = (event) => {
        const e = event as { type: string } & Record<string, unknown>;
        send(e.type, e);
      };
      pulseStore.emitter.on("event", onEvent);

      // keep intermediaries (proxies/load balancers) from closing the connection
      heartbeat = setInterval(() => send("ping", { t: Date.now() }), 25000);

      request.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        pulseStore.emitter.off("event", onEvent);
        controller.close();
      });
    },
    cancel() {
      clearInterval(heartbeat);
      pulseStore.emitter.off("event", onEvent);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
