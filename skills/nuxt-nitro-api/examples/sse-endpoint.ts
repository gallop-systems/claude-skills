// server/api/stream/[id].get.ts
// Server-Sent Events endpoint for real-time streaming

export default defineEventHandler(async (event) => {
  const { id } = getRouterParams(event);

  // Create the event stream
  const eventStream = createEventStream(event);

  let done = false;

  // Handle client disconnect
  eventStream.onClosed(async () => {
    console.log(`Stream ${id}: Client disconnected`);
    done = true;
    await eventStream.close();
  });

  // Heartbeat to keep connection alive
  const heartbeat = setInterval(async () => {
    if (!done) {
      await eventStream.push(JSON.stringify({ type: "heartbeat" }));
    }
  }, 30000);

  // Stream data
  (async () => {
    try {
      while (!done) {
        // Get next chunk of data (your logic here)
        const data = await getNextChunk(id);

        if (data) {
          await eventStream.push(JSON.stringify(data));

          if (data.type === "done" || data.type === "error") {
            done = true;
          }
        } else {
          // No data yet, wait before checking again
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    } finally {
      clearInterval(heartbeat);
      await eventStream.close();
    }
  })();

  return eventStream.send();
});

// Helper - replace with your data source
async function getNextChunk(id: string) {
  // Example: fetch from Redis, database, or queue
  // return { type: "chunk", text: "Hello" }
  // return { type: "done" }
  return null;
}
