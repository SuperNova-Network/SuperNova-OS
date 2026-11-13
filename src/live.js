/*
 * The live channel (GET /api/live): one Server-Sent Events stream every open desktop (and the maintenance
 * page) listens to, so what admins change on the site reaches everyone at once instead of at the next check.
 *
 * Events (server -> page):
 *   hello         what is true right now: { announcement, maintenance }, sent on every (re)connection
 *   announcement  an admin posted, changed or took down the announcement
 *   maintenance   an admin turned maintenance mode on or off (or changed its message)
 *
 * It carries only what is already public (the announcement and the maintenance message), so it needs no
 * sign-in: it must keep working on the "back soon" page. A page that loses it reconnects by itself and gets
 * a fresh "hello", so nobody can miss a change.
 */

const HEARTBEAT_MS = 25_000;
const MAX_PER_ADDRESS = 30; // streams from one address (a school or a household has many tabs)

/** state() -> { announcement, maintenance }, the current public values. */
export function createLive({ state }) {
  const streams = new Set(); // { res, address, heartbeat }

  function write(stream, event, data) {
    try { stream.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* the close handler cleans up */ }
  }

  function snapshot() {
    const { announcement, maintenance } = state();
    return { announcement, maintenance: { on: maintenance.on, message: maintenance.message } };
  }

  function handler(req, res) {
    const address = req.ip;
    const mine = [...streams].filter((s) => s.address === address);
    if (mine.length >= MAX_PER_ADDRESS) { mine[0].res.end(); } // the oldest makes room
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform", // no-transform: compression must not buffer the stream
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write("retry: 3000\n\n");
    const stream = { res, address, heartbeat: setInterval(() => { try { res.write(": keep-alive\n\n"); } catch { /* closing */ } }, HEARTBEAT_MS) };
    stream.heartbeat.unref();
    streams.add(stream);
    write(stream, "hello", snapshot());
    res.on("close", () => { clearInterval(stream.heartbeat); streams.delete(stream); });
  }

  return {
    handler,
    /** Tell every open page: event is "announcement" or "maintenance", data the new value. */
    broadcast(event, data) { for (const stream of streams) write(stream, event, data); },
    count: () => streams.size,
    close() { for (const stream of streams) { clearInterval(stream.heartbeat); stream.res.end(); } streams.clear(); },
  };
}
