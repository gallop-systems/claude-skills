# Server-Sent Events (SSE)

> **Example:** [sse-endpoint.ts](./examples/sse-endpoint.ts)

Real-time streaming without WebSockets. Good for long-running operations, AI streaming, job progress.

## Server-Side (Nitro)

```typescript
// server/api/stream/[id].get.ts
export default defineEventHandler(async (event) => {
  const { id } = getRouterParams(event);

  // Create the event stream
  const eventStream = createEventStream(event);

  let done = false;

  // Handle client disconnect
  eventStream.onClosed(async () => {
    console.log("Client disconnected");
    done = true;
    await eventStream.close();
  });

  // Async loop to push events
  (async () => {
    while (!done) {
      const data = await getNextChunk(id);

      if (data) {
        await eventStream.push(JSON.stringify(data));

        if (data.type === "done" || data.type === "error") {
          done = true;
        }
      } else {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    await eventStream.close();
  })();

  return eventStream.send();
});
```

### Heartbeat Pattern

Keep connections alive:

```typescript
const heartbeatInterval = setInterval(async () => {
  await eventStream.push(JSON.stringify({ type: "heartbeat" }));
}, 30000);

eventStream.onClosed(() => {
  clearInterval(heartbeatInterval);
});
```

## Client-Side Option 1: VueUse (Recommended)

```typescript
import { useEventSource } from "@vueuse/core";

const { status, data, error, close } = useEventSource(
  `/api/stream/${sessionId}`,
  [],  // Event names (empty = default "message")
  {
    autoReconnect: {
      retries: 3,
      delay: 1000,
      onFailed() {
        console.error("Failed to reconnect");
      },
    },
  }
);

watch(data, (newData) => {
  if (newData) {
    const parsed = JSON.parse(newData);
    // Handle the event...
  }
});

onUnmounted(close);
```

## Client-Side Option 2: Custom Composable

For more control:

```typescript
// composables/useSSE.ts
export function useSSE() {
  const eventSource = ref<EventSource | null>(null);
  const data = ref<any>(null);
  const error = ref<string | null>(null);
  const status = ref<"connecting" | "connected" | "closed">("connecting");

  const connect = (url: string) => {
    stop();

    eventSource.value = new EventSource(url);

    eventSource.value.onopen = () => {
      status.value = "connected";
    };

    eventSource.value.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        data.value = parsed;

        if (parsed.type === "done" || parsed.type === "error") {
          stop();
        }
      } catch (e) {
        console.error("Parse error:", e);
      }
    };

    eventSource.value.onerror = () => {
      error.value = "Connection error";
      status.value = "closed";

      // Auto-reconnect
      setTimeout(() => {
        if (status.value === "closed") {
          connect(url);
        }
      }, 2000);
    };
  };

  const stop = () => {
    if (eventSource.value) {
      eventSource.value.close();
      eventSource.value = null;
    }
    status.value = "closed";
  };

  onUnmounted(stop);

  return { connect, stop, data, error, status };
}
```

## Usage in Component

```typescript
const { connect, stop, data, status } = useSSE();

const startAnalysis = async () => {
  const { sessionId } = await $fetch("/api/analysis/start", { method: "POST" });
  connect(`/api/analysis/${sessionId}/stream`);
};

watch(data, (newData) => {
  if (newData?.type === "chunk") {
    output.value += newData.text;
  } else if (newData?.type === "done") {
    isComplete.value = true;
  }
});

onUnmounted(stop);
```

## Position-Based Resumption

Resume from where client left off:

```typescript
// Client tracks position
const position = ref(0);

eventSource.value.onmessage = (event) => {
  position.value++;
  // handle data...
};

const reconnect = () => {
  connect(`/api/stream/${id}?position=${position.value}`);
};
```

```typescript
// Server reads position
const { position } = await getValidatedQuery(event, schema);
const chunks = await getChunksFromPosition(id, position);
```

## Fallback to Polling

When SSE isn't available:

```typescript
// Server returns non-SSE response
if (!redisAvailable) {
  return { type: "pending", message: "Use polling" };
}

// Client detects and falls back
if (data.value?.type === "pending") {
  stopSSE();
  startPolling();
}
```

## Key Gotchas

1. **Always clean up** - Call `eventSource.close()` on unmount
2. **Parse JSON** - SSE data is always strings
3. **Handle reconnection** - Connections drop, plan for it
4. **Timeouts** - Long streams need heartbeats
5. **No binary data** - SSE is text-only, use base64 if needed
