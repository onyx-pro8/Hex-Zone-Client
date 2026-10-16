type Osc = OscillatorType;

let ringTimer: ReturnType<typeof setInterval> | null = null;
let audioCtx: AudioContext | null = null;

function audioContext(): AudioContext | null {
  const host = globalThis as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const Ctor = host.AudioContext || host.webkitAudioContext;
  if (!Ctor) return null;
  if (!audioCtx) audioCtx = new Ctor();
  if (audioCtx.state === "suspended") void audioCtx.resume();
  return audioCtx;
}

function beep(freq: number, ms: number, type: Osc = "sine") {
  const ctx = audioContext();
  if (!ctx) return false;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.07, ctx.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + ms / 1000);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + ms / 1000);
  return true;
}

export function startRinging() {
  stopRinging();
  if (!beep(440, 180)) return;
  ringTimer = setInterval(() => {
    beep(440, 150);
    setTimeout(() => beep(494, 150), 180);
  }, 1600);
}

export function stopRinging() {
  if (ringTimer) clearInterval(ringTimer);
  ringTimer = null;
}

export function playConnected() {
  stopRinging();
  if (!beep(523, 110)) return;
  setTimeout(() => beep(659, 180), 120);
}

export function playEnded() {
  stopRinging();
  if (!beep(392, 120, "triangle")) return;
  setTimeout(() => beep(262, 200, "triangle"), 140);
}
