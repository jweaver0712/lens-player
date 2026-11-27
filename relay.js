/* Ride Along phone-to-lens location relay.
   The phone page sends its GPS position; the lens app listens. Messages go through free public MQTT brokers
   over secure WebSockets, on a random private channel, and every position is encrypted (AES-GCM) with a key
   that only your phone and your glasses have (it travels inside the Add link, never to a server). */
(function () {
  const BROKERS = ["wss://broker.emqx.io:8084/mqtt", "wss://broker.hivemq.com:8884/mqtt"];
  const te = new TextEncoder(), td = new TextDecoder();

  function b64u(bytes) { let s = ""; bytes.forEach(b => s += String.fromCharCode(b)); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
  function unb64u(s) { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }
  function newPair() { const id = crypto.getRandomValues(new Uint8Array(12)), key = crypto.getRandomValues(new Uint8Array(32)); return b64u(id) + "." + b64u(key); }
  function parsePair(p) { const m = /^([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{43})$/.exec(p || ""); return m ? { topic: "fixit-ride/" + m[1], key: unb64u(m[2]) } : null; }

  async function cryptoKey(raw) { return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]); }
  async function seal(k, obj) { const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, te.encode(JSON.stringify(obj)))); const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12); return out; }
  async function open(k, bytes) { if (bytes.length < 29) return null; const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, k, bytes.slice(12)); return JSON.parse(td.decode(pt)); }

  /* ---- a very small MQTT 3.1.1 client (QoS 0) ---- */
  function len(n) { const o = []; do { let b = n % 128; n = Math.floor(n / 128); if (n > 0) b |= 128; o.push(b); } while (n > 0); return o; }
  function str(s) { const b = te.encode(s); return [b.length >> 8, b.length & 255, ...b]; }
  function pkt(h, body) { return new Uint8Array([h, ...len(body.length), ...body]); }
  function conn(url, onMsg, onState) {
    let ws, alive = false, ping, closed = false, subs = [], retry = 1000, buf = new Uint8Array(0);
    function start() {
      if (closed) return;
      try { ws = new WebSocket(url, "mqtt"); } catch (e) { return later(); }
      ws.binaryType = "arraybuffer";
      ws.onopen = () => {
        const id = "ra" + Math.random().toString(36).slice(2, 12);
        ws.send(pkt(0x10, [...str("MQTT"), 4, 0x02, 0, 30, ...str(id)]));
      };
      ws.onmessage = e => { const a = new Uint8Array(e.data), n = new Uint8Array(buf.length + a.length); n.set(buf); n.set(a, buf.length); buf = n; parse(); };
      ws.onclose = () => { alive = false; clearInterval(ping); onState && onState(false); later(); };
      ws.onerror = () => { try { ws.close(); } catch (e) {} };
    }
    function later() { if (closed) return; setTimeout(start, retry); retry = Math.min(retry * 2, 15000); }
    function parse() {
      while (buf.length >= 2) {
        let m = 1, v = 0, i = 1, b;
        do { if (i >= buf.length) return; b = buf[i++]; v += (b & 127) * m; m *= 128; } while (b & 128);
        if (buf.length < i + v) return;
        const hdr = buf[0], type = hdr >> 4, body = buf.slice(i, i + v); buf = buf.slice(i + v);
        if (type === 2) { /* CONNACK */
          if (body[1] !== 0) { try { ws.close(); } catch (e) {} return; }
          alive = true; retry = 1000; onState && onState(true);
          subs.forEach(t => ws.send(pkt(0x82, [0, 1, ...str(t), 0])));
          ping = setInterval(() => { try { ws.send(new Uint8Array([0xC0, 0])); } catch (e) {} }, 20000);
        } else if (type === 3) { /* PUBLISH */
          const tl = (body[0] << 8) | body[1], topic = td.decode(body.slice(2, 2 + tl));
          const qos = (hdr >> 1) & 3; const start = 2 + tl + (qos ? 2 : 0);
          onMsg && onMsg(topic, body.slice(start));
        }
      }
    }
    start();
    return {
      sub(t) { subs.push(t); if (alive) ws.send(pkt(0x82, [0, 1, ...str(t), 0])); },
      pub(t, bytes, retain) { if (!alive) return false; ws.send(pkt(0x30 | (retain ? 1 : 0), [...str(t), ...bytes])); return true; },
      up() { return alive; },
      close() { closed = true; clearInterval(ping); try { ws.send(new Uint8Array([0xE0, 0])); ws.close(); } catch (e) {} }
    };
  }

  /* Phone side: send positions to every broker */
  async function sender(pair, onState) {
    const p = parsePair(pair); if (!p) throw new Error("bad pair");
    const k = await cryptoKey(p.key); const ups = {};
    const cs = BROKERS.map(u => conn(u, null, s => { ups[u] = s; onState && onState(Object.values(ups).some(Boolean)); }));
    return {
      async send(fix) { const bytes = await seal(k, fix); let ok = false; cs.forEach(c => { ok = c.pub(p.topic, bytes, true) || ok; }); return ok; },
      async stop() { cs.forEach(c => c.pub(p.topic, [], true)); setTimeout(() => cs.forEach(c => c.close()), 300); }
    };
  }
  /* Lens side: listen on every broker, keep the newest position */
  async function listener(pair, onFix, onState) {
    const p = parsePair(pair); if (!p) return null;
    const k = await cryptoKey(p.key); let lastT = 0; const ups = {};
    const cs = BROKERS.map(u => {
      const c = conn(u, async (t, bytes) => {
        try { const f = await open(k, bytes); if (f && f.t > lastT) { lastT = f.t; onFix(f); } } catch (e) {}
      }, s => { ups[u] = s; onState && onState(Object.values(ups).some(Boolean)); });
      c.sub(p.topic); return c;
    });
    return { close() { cs.forEach(c => c.close()); } };
  }
  window.RideRelay = { newPair, parsePair, sender, listener };
})();
