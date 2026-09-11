// The timer — the first mini-app, and the shape the rest should follow.
//
// Nothing here counts. The state is a timestamp for when the time runs out,
// and the face is worked out from it on every tick, so a timer keeps running
// while its page is closed, agrees with itself in a second tab, and comes back
// right after a reload. What is stored is a fact; the countdown is a view of it.

import { register } from "./registry.js";

const MINUTE = 60000;

const clamp = (ms) => Math.max(0, Math.min(ms, 24 * 3600000));

function face(ms) {
  const total = Math.ceil(ms / 1000);
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const pad = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function button(label, className) {
  const el = document.createElement("button");
  el.className = className;
  el.textContent = label;
  // The board reads a pointerdown on a note as the start of a drag. A control
  // inside an app is not a handle — same exemption the tick boxes get.
  el.addEventListener("pointerdown", (e) => e.stopPropagation());
  return el;
}

register({
  name: "timer",
  title: "Timer",
  keywords: ["timer", "countdown"],
  size: { width: 200, height: 132 },

  // `ms` is what Reset goes back to, `left` what is on the clock while it is
  // stopped, `endsAt` when it runs out while it is going. Only one of the last
  // two is ever meaningful, and `endsAt` is the one that says so.
  init: () => ({ ms: 5 * MINUTE, left: 5 * MINUTE, endsAt: null }),

  mount(host, api) {
    const root = document.createElement("div");
    root.className = "app-timer";

    const clock = document.createElement("div");
    clock.className = "timer-face";

    const adjust = document.createElement("div");
    adjust.className = "timer-row";
    const minus = button("−1m", "timer-btn");
    const plus = button("+1m", "timer-btn");
    const plus5 = button("+5m", "timer-btn");
    adjust.append(minus, plus, plus5);

    const controls = document.createElement("div");
    controls.className = "timer-row";
    const go = button("Start", "timer-btn timer-go");
    const reset = button("Reset", "timer-btn");
    controls.append(go, reset);

    root.append(clock, adjust, controls);
    host.appendChild(root);

    const remaining = () => {
      const { endsAt, left, ms } = api.state;
      if (endsAt) return Math.max(0, endsAt - Date.now());
      return left ?? ms ?? 0;
    };

    const draw = () => {
      const ms = remaining();
      const running = !!api.state.endsAt;
      const done = running && ms === 0;
      const text = face(ms);
      // The ticker runs four times a second and the face changes once. Writing
      // it anyway would be a layout on every note with a timer on it.
      if (clock.textContent !== text) clock.textContent = text;
      go.textContent = running && !done ? "Pause" : "Start";
      go.disabled = !running && ms === 0;
      root.classList.toggle("is-running", running && !done);
      root.classList.toggle("is-done", done);
    };

    go.addEventListener("click", () => {
      if (api.state.endsAt) {
        // Pausing puts the clock back on the shelf as a duration. A paused
        // timer that kept an `endsAt` would quietly keep running.
        api.setState({ left: remaining(), endsAt: null });
      } else {
        const ms = remaining() || api.state.ms || 5 * MINUTE;
        api.setState({ endsAt: Date.now() + ms, left: null });
      }
      // Starting and stopping is a deliberate act, not a keystroke to coalesce:
      // it goes to the database now, so a tab closed a moment later still knows.
      api.flush();
      draw();
    });

    reset.addEventListener("click", () => {
      api.setState({ left: api.state.ms || 5 * MINUTE, endsAt: null });
      api.flush();
      draw();
    });

    const bump = (delta) => () => {
      if (api.state.endsAt) {
        // Going: the deadline moves, and the timer keeps counting through it.
        api.setState({ endsAt: Math.max(Date.now(), api.state.endsAt + delta) });
      } else {
        const left = clamp(remaining() + delta);
        // Adding a minute to a stopped timer sets what Reset means too —
        // otherwise Reset would undo the minute you just asked for.
        api.setState({ ms: left, left });
      }
      draw();
    };

    minus.addEventListener("click", bump(-MINUTE));
    plus.addEventListener("click", bump(MINUTE));
    plus5.addEventListener("click", bump(5 * MINUTE));

    api.onTick(draw);
    draw();

    return () => root.remove();
  },
});
