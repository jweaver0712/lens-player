/* Band Shortcuts: extra Neural Band gestures for a Meta Ray-Ban Display web app.

   What the glasses give a web app (Meta's Web Apps docs, "Input and navigation"): keydown for
   ArrowUp / ArrowDown / ArrowLeft / ArrowRight (thumb swipes) and Enter (pinch). Back is the
   system's. There is no raw gesture API, so the band itself can't learn new moves.

   This file builds new gestures out of those five signals, inside the app:
     • Double pinch  → opens a shortcut wheel; the next swipe picks 1 of 4 actions.
     • Quick flicks  → two opposite swipes in a row (left-right, right-left, up-down, down-up),
                       each one its own action. Focus goes back to where it was.
   That is 8 slots. Each app lists the actions it offers, the person picks what goes in each slot,
   and the choice is kept on the device (localStorage).

   Cost: with double pinch on, a single pinch waits DP_MS before it presses, to see if a second
   one is coming. Turning double pinch off removes the wait.

   Use:
     BandShortcuts.start({ key, actions:{id:{name, run}}, defaults:{slot:actionId}, say(text), testing() })
     BandShortcuts.renderSettings(container, { rowClass })
*/
(function () {
  const DP_MS = 280;        // second pinch must land within this
  const FLICK_MS = 380;     // second, opposite swipe must land within this
  const WHEEL_MS = 6000;    // the wheel closes itself after this

  const SLOTS = [
    { id: "w-up",    group: "wheel", icon: "🤏🤏 ↑", name: "Double pinch, then up" },
    { id: "w-right", group: "wheel", icon: "🤏🤏 →", name: "Double pinch, then right" },
    { id: "w-down",  group: "wheel", icon: "🤏🤏 ↓", name: "Double pinch, then down" },
    { id: "w-left",  group: "wheel", icon: "🤏🤏 ←", name: "Double pinch, then left" },
    { id: "f-lr",    group: "flick", icon: "← →",   name: "Flick left, right" },
    { id: "f-rl",    group: "flick", icon: "→ ←",   name: "Flick right, left" },
    { id: "f-ud",    group: "flick", icon: "↑ ↓",   name: "Flick up, down" },
    { id: "f-du",    group: "flick", icon: "↓ ↑",   name: "Flick down, up" }
  ];
  const DIR = { ArrowUp: "up", ArrowRight: "right", ArrowDown: "down", ArrowLeft: "left" };
  const OPP = { up: "down", down: "up", left: "right", right: "left" };
  const FLICK_SLOT = { "left>right": "f-lr", "right>left": "f-rl", "up>down": "f-ud", "down>up": "f-du" };

  let O = null, map = {}, on = { wheel: true, flick: true };
  let pinch = null;          // { t, target, timer } while waiting for a possible 2nd pinch
  let last = null;           // { dir, t, before } the previous swipe
  let wheel = null;          // { el, timer } while the wheel is open
  let toastEl = null, toastT = null, settingsBox = null, settingsOpts = null;

  function save() { try { localStorage.setItem(O.key, JSON.stringify({ map, on })); } catch (e) {} }
  function load() {
    map = Object.assign({}, O.defaults);
    try {
      const s = JSON.parse(localStorage.getItem(O.key) || "null");
      if (s && s.map) Object.keys(s.map).forEach(k => { if (O.actions[s.map[k]] || s.map[k] === "none") map[k] = s.map[k]; });
      if (s && s.on) on = { wheel: s.on.wheel !== false, flick: s.on.flick !== false };
    } catch (e) {}
  }
  function slot(id) { return SLOTS.find(s => s.id === id); }
  function actionName(id) { return id === "none" || !O.actions[id] ? "Nothing" : O.actions[id].name; }
  function testing() { return !!(O.testing && O.testing()); }

  function say(text) {
    if (O.say) return O.say(text);
    if (!toastEl) { toastEl = document.createElement("div"); toastEl.className = "band-toast"; document.body.appendChild(toastEl); }
    toastEl.textContent = text; toastEl.classList.add("on");
    clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove("on"), 2200);
  }

  function fire(slotId) {
    const s = slot(slotId), a = map[slotId];
    if (testing()) { say("✓ " + s.name + ": " + actionName(a)); flash(slotId); return; }
    if (!a || a === "none" || !O.actions[a]) { say(s.name + " has nothing set. Change it in Gestures."); return; }
    say("⚡ " + O.actions[a].name);
    try { O.actions[a].run(); } catch (e) { say("That shortcut hit a snag."); }
  }

  /* ---- the wheel ---- */
  function openWheel() {
    closeWheel();
    const el = document.createElement("div"); el.className = "band-wheel"; el.setAttribute("role", "dialog");
    const cell = (d, cls) => { const sid = "w-" + d, c = document.createElement("div"); c.className = "band-w " + cls;
      c.innerHTML = '<b>' + { up: "↑", right: "→", down: "↓", left: "←" }[d] + '</b><span></span>';
      c.querySelector("span").textContent = actionName(map[sid]); if (map[sid] === "none") c.classList.add("off"); return c; };
    const mid = document.createElement("div"); mid.className = "band-w band-mid"; mid.innerHTML = "<b>🤏</b><span>pinch to close</span>";
    el.append(cell("up", "band-n"), cell("left", "band-wl"), mid, cell("right", "band-e"), cell("down", "band-s"));
    document.body.appendChild(el);
    wheel = { el, timer: setTimeout(closeWheel, WHEEL_MS) };
  }
  function closeWheel() { if (!wheel) return; clearTimeout(wheel.timer); wheel.el.remove(); wheel = null; }

  /* ---- replaying a single pinch exactly as the page would have seen it ---- */
  function replayPinch(target) {
    if (!target || !target.isConnected) target = document.activeElement || document.body;
    const ev = new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true });
    target.dispatchEvent(ev);
    if (!ev.defaultPrevented && target !== document.body && typeof target.click === "function") target.click();
  }
  function flushPinch() { if (!pinch) return; const p = pinch; pinch = null; clearTimeout(p.timer); replayPinch(p.target); }

  function isTyping(t) { return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable); }
  function stop(e) { e.preventDefault(); e.stopImmediatePropagation(); }

  function onKey(e) {
    if (!e.isTrusted || e.altKey || e.ctrlKey || e.metaKey) return;     // our own replays pass straight through
    const k = e.key;

    if (wheel) {                                                         // the wheel owns every key while open
      stop(e);
      if (DIR[k]) { closeWheel(); fire("w-" + DIR[k]); }
      else closeWheel();                                                 // pinch, Escape, anything else
      return;
    }
    if (isTyping(e.target)) { last = null; return; }

    if (k === "Enter") {
      last = null;
      if (!on.wheel || e.repeat) return;
      if (pinch) { stop(e); clearTimeout(pinch.timer); pinch = null; openWheel(); return; }   // 2nd pinch: wheel
      stop(e);
      pinch = { target: document.activeElement, timer: setTimeout(flushPinch, DP_MS) };
      return;
    }

    const d = DIR[k];
    if (!d) { last = null; return; }
    flushPinch();                                                        // a swipe right after one pinch: press first
    const now = performance.now();
    if (on.flick && last && last.dir === OPP[d] && now - last.t < FLICK_MS && !e.repeat) {
      stop(e);
      const before = last.before; last = null;
      if (before && before.isConnected && before !== document.body && before.focus) before.focus({ preventScroll: false });
      fire(FLICK_SLOT[OPP[d] + ">" + d]);
      return;
    }
    last = { dir: d, t: now, before: document.activeElement };
  }

  /* ---- settings list (the app puts it on its own screen) ---- */
  function flash(slotId) {
    if (!settingsBox) return;
    const r = settingsBox.querySelector('[data-slot="' + slotId + '"]'); if (!r) return;
    r.classList.add("band-hit"); setTimeout(() => r.classList.remove("band-hit"), 900);
  }
  function choices() { return Object.keys(O.actions).concat("none"); }
  function renderSettings(box, opts) {
    settingsBox = box; settingsOpts = opts || {};
    const rc = settingsOpts.rowClass || "band-row";
    const keep = document.activeElement && document.activeElement.dataset ? (document.activeElement.dataset.slot || document.activeElement.dataset.band) : null;
    box.innerHTML = "";
    const row = (label, value, icon, data) => {
      const b = document.createElement("button"); b.className = rc + " band-set";
      Object.keys(data).forEach(k => b.dataset[k] = data[k]);
      const i = document.createElement("span"); i.className = "band-ic"; i.textContent = icon;
      const t = document.createElement("span"); t.className = "band-tx";
      const n = document.createElement("span"); n.className = "band-nm"; n.textContent = label;
      const v = document.createElement("span"); v.className = "band-val"; v.textContent = value;
      t.append(n, v); b.append(i, t); box.appendChild(b); return b;
    };
    const head = txt => { const h = document.createElement("div"); h.className = "band-head"; h.textContent = txt; box.appendChild(h); };

    head(on.wheel ? "Double pinch opens the wheel" : "Double pinch is off");
    row("Double pinch", on.wheel ? "On · pinch to turn off" : "Off · single pinch is instant", "🤏🤏", { band: "wheel" })
      .addEventListener("click", () => { on.wheel = !on.wheel; save(); renderSettings(box, settingsOpts); });
    if (on.wheel) SLOTS.filter(s => s.group === "wheel").forEach(s => slotRow(s));
    head(on.flick ? "Quick flicks" : "Quick flicks are off");
    row("Quick flicks", on.flick ? "On · pinch to turn off" : "Off", "↔", { band: "flick" })
      .addEventListener("click", () => { on.flick = !on.flick; last = null; save(); renderSettings(box, settingsOpts); });
    if (on.flick) SLOTS.filter(s => s.group === "flick").forEach(s => slotRow(s));
    row("Reset to the starting set", "", "↺", { band: "reset" })
      .addEventListener("click", () => { map = Object.assign({}, O.defaults); on = { wheel: true, flick: true }; save(); renderSettings(box, settingsOpts); say("Back to the starting set."); });

    function slotRow(s) {
      row(s.name, actionName(map[s.id]), s.icon, { slot: s.id }).addEventListener("click", () => {
        const c = choices(); map[s.id] = c[(c.indexOf(map[s.id]) + 1) % c.length]; save();
        renderSettings(box, settingsOpts); say(s.name + ": " + actionName(map[s.id]));
      });
    }
    if (keep) { const k = box.querySelector('[data-slot="' + keep + '"],[data-band="' + keep + '"]'); if (k) k.focus(); }
  }

  function css() {
    const s = document.createElement("style");
    s.textContent = `
.band-toast{position:fixed;left:50%;top:18px;transform:translateX(-50%);max-width:92vw;padding:10px 18px;border-radius:14px;background:#0d1a2e;border:2px solid #9cc3ff;color:#fff;font:600 22px system-ui,sans-serif;display:none;z-index:99}
.band-toast.on{display:block}
.band-wheel{position:fixed;inset:0;z-index:98;background:rgba(0,0,0,.88);display:grid;grid-template:1fr auto 1fr/1fr auto 1fr;align-items:center;justify-items:center;padding:18px;font-family:system-ui,sans-serif;color:#fff}
.band-w{display:flex;flex-direction:column;align-items:center;gap:4px;text-align:center;max-width:180px;padding:12px 14px;border-radius:18px;border:3px solid #5b7bd6;background:#0f1a33}
.band-w b{font-size:40px;line-height:1;color:#9cc3ff}.band-w span{font-size:21px;font-weight:600;line-height:1.2}
.band-w.off{opacity:.45;border-style:dashed}
.band-n{grid-area:1/2}.band-wl{grid-area:2/1}.band-mid{grid-area:2/2;border-color:#333;background:transparent}.band-mid span{font-size:16px;color:#aaa;font-weight:400}.band-e{grid-area:2/3}.band-s{grid-area:3/2}
.band-head{font-size:18px;color:#9aa;margin:10px 6px 0;text-transform:uppercase;letter-spacing:.6px;flex-shrink:0}
.band-set .band-ic{min-width:76px;font-size:24px;text-align:center;white-space:nowrap}
.band-set{justify-content:flex-start !important;text-align:left !important}
.band-set .band-tx{display:flex;flex-direction:column;align-items:flex-start;min-width:0}
.band-set .band-nm{font-size:19px;color:#aab}
.band-set .band-val{font-size:25px;font-weight:600}
.band-set.band-hit{border-color:#4cd08a !important;background:#0d2a1b !important}`;
    document.head.appendChild(s);
  }

  window.BandShortcuts = {
    SLOTS,
    start(opts) {
      O = Object.assign({ key: "band.shortcuts", actions: {}, defaults: {} }, opts);
      SLOTS.forEach(s => { if (!(s.id in O.defaults)) O.defaults[s.id] = "none"; });
      load(); css();
      window.addEventListener("keydown", onKey, true);                 // window capture: runs before the app's own key handlers
      window.addEventListener("popstate", closeWheel);
      return this;
    },
    renderSettings,
    openWheel, closeWheel,
    get state() { return { map: Object.assign({}, map), on: Object.assign({}, on) }; }
  };
})();
