// A small kit for tests that talk to a running server as several people: each has its own cookie and address, can
// call the JSON API, and can listen to the chat stream.
export function chatKit(getServer, ipPrefix = "198.19.0") {
  let clients = 0, names = 0;
  const listeners = [];
  function browser() {
    let cookie = "";
    const ip = `${ipPrefix}.${++clients}`;
    const headers = (body) => ({ "x-forwarded-for": ip, ...(cookie ? { cookie } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) });
    async function call(method, path, body) {
      const res = await fetch(getServer().url + path, { method, headers: headers(body), body: body !== undefined ? JSON.stringify(body) : undefined });
      const set = res.headers.get("set-cookie");
      if (set) cookie = set.split(";")[0];
      const text = await res.text();
      let data = null;
      try { data = JSON.parse(text); } catch { /* not JSON */ }
      return { status: res.status, data, text, headers: res.headers };
    }
    return {
      get: (path) => call("GET", path),
      post: (path, body = {}) => call("POST", path, body),
      async listen(query = "") {
        const controller = new AbortController();
        const res = await fetch(getServer().url + "/api/chat/stream" + query, { headers: headers(), signal: controller.signal });
        const events = [];
        (async () => {
          const decoder = new TextDecoder();
          let buffer = "";
          try {
            for await (const chunk of res.body) {
              buffer += decoder.decode(chunk, { stream: true });
              let end;
              while ((end = buffer.indexOf("\n\n")) !== -1) {
                const block = buffer.slice(0, end);
                buffer = buffer.slice(end + 2);
                const event = block.match(/^event: (.+)$/m)?.[1];
                const data = block.match(/^data: (.+)$/m)?.[1];
                if (event) events.push({ event, data: JSON.parse(data) });
              }
            }
          } catch { /* aborted */ }
        })();
        const listener = {
          events,
          async waitFor(name, test = () => true, ms = 3000) {
            const until = Date.now() + ms;
            while (Date.now() < until) {
              const found = events.find((item) => item.event === name && test(item.data));
              if (found) return found.data;
              await new Promise((resolve) => setTimeout(resolve, 10));
            }
            throw new Error(`No "${name}" event arrived. Got: ${events.map((item) => item.event).join(", ")}`);
          },
          close: () => controller.abort(),
        };
        listeners.push(listener);
        return listener;
      },
    };
  }
  async function person(name = `pal${++names}x`) {
    const b = browser();
    const made = await b.post("/api/account/register", { username: name, password: "password123" });
    if (made.status !== 201) throw new Error(`could not register ${name}: ${made.status} ${made.text}`);
    b.username = name;
    return b;
  }
  return { browser, person, closeAll: () => { for (const listener of listeners) listener.close(); } };
}
export const settle = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));
