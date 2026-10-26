/**
 * Best-effort WebRTC for guest↔admin voice.
 * Uses browser RTCPeerConnection when present; react-native-webrtc when installed.
 */

type SignalPayload =
  | { kind: "offer"; sdp: string }
  | { kind: "answer"; sdp: string }
  | { kind: "ice"; candidate: RTCIceCandidateInit };

type PeerBundle = {
  pc: RTCPeerConnection;
  localStream: MediaStream | null;
};

let active: PeerBundle | null = null;
const levelListeners = new Set<(level: number) => void>();
let meterTimer: ReturnType<typeof setInterval> | null = null;
let meterContext: AudioContext | null = null;

export function subscribeLocalVoiceLevel(listener: (level: number) => void) {
  levelListeners.add(listener);
  return () => {
    levelListeners.delete(listener);
  };
}

function publishLocalVoiceLevel(level: number) {
  const next = Math.max(0, Math.min(1, level));
  for (const listener of levelListeners) listener(next);
}

function stopLocalVoiceMeter() {
  if (meterTimer) clearInterval(meterTimer);
  meterTimer = null;
  const ctx = meterContext;
  meterContext = null;
  if (ctx) void ctx.close().catch(() => undefined);
}

function audioContext(): AudioContext | null {
  const Host = globalThis as typeof globalThis & {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const Ctor = Host.AudioContext || Host.webkitAudioContext;
  if (!Ctor) return null;
  if (!meterContext || meterContext.state === "closed") meterContext = new Ctor();
  if (meterContext.state === "suspended") void meterContext.resume();
  return meterContext;
}

/** Call from the Call or Accept click so the browser unlocks the microphone graph. */
export function primeLocalVoiceContext() {
  audioContext();
}

function startLocalVoiceMeter(stream: MediaStream) {
  if (meterTimer) {
    clearInterval(meterTimer);
    meterTimer = null;
  }
  const ctx = audioContext();
  if (!ctx) return;
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  const mute = ctx.createGain();
  mute.gain.value = 0;
  source.connect(analyser);
  analyser.connect(mute);
  mute.connect(ctx.destination);
  const samples = new Float32Array(analyser.fftSize);
  meterTimer = setInterval(() => {
    if (ctx.state === "suspended") void ctx.resume();
    analyser.getFloatTimeDomainData(samples);
    let peak = 0;
    for (let i = 0; i < samples.length; i += 1) {
      const abs = Math.abs(samples[i] || 0);
      if (abs > peak) peak = abs;
    }
    publishLocalVoiceLevel(Math.min(1, peak * 14));
  }, 80);
}

function getRtcPeerConnection(): typeof RTCPeerConnection | null {
  const g = globalThis as typeof globalThis & {
    RTCPeerConnection?: typeof RTCPeerConnection;
  };
  if (typeof g.RTCPeerConnection === "function") return g.RTCPeerConnection;
  try {
    // Optional native module for custom Expo/dev clients.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("react-native-webrtc") as {
      RTCPeerConnection?: typeof RTCPeerConnection;
    };
    if (typeof mod.RTCPeerConnection === "function") return mod.RTCPeerConnection;
  } catch {
    /* module not installed */
  }
  return null;
}

async function getUserMedia(): Promise<MediaStream | null> {
  const nav = globalThis.navigator as
    | (Navigator & {
        mediaDevices?: { getUserMedia: (c: MediaStreamConstraints) => Promise<MediaStream> };
      })
    | undefined;
  if (nav?.mediaDevices?.getUserMedia) {
    const spoken: MediaTrackConstraints = {
      echoCancellation: { ideal: true },
      noiseSuppression: { ideal: true },
      autoGainControl: { ideal: true },
      channelCount: { ideal: 1 },
    };
    try {
      return await nav.mediaDevices.getUserMedia({ audio: spoken, video: false });
    } catch {
      try {
        return await nav.mediaDevices.getUserMedia({ audio: true, video: false });
      } catch {
        return null;
      }
    }
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("react-native-webrtc") as {
      mediaDevices?: { getUserMedia: (c: object) => Promise<MediaStream> };
    };
    if (mod.mediaDevices?.getUserMedia) {
      return await mod.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function guestCallMediaAvailable(): boolean {
  return getRtcPeerConnection() != null;
}

export async function startGuestCallMedia(opts: {
  isOfferer: boolean;
  onSignal: (signal: SignalPayload) => void;
}): Promise<boolean> {
  await stopGuestCallMedia();
  const RTC = getRtcPeerConnection();
  if (!RTC) return false;

  const pc = new RTC({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });
  const localStream = await getUserMedia();
  if (localStream) {
    for (const track of localStream.getTracks()) {
      pc.addTrack(track, localStream);
    }
    startLocalVoiceMeter(localStream);
  }

  pc.onicecandidate = (ev) => {
    if (ev.candidate) {
      opts.onSignal({ kind: "ice", candidate: ev.candidate.toJSON() });
    }
  };

  active = { pc, localStream };

  if (opts.isOfferer) {
    const offer = await pc.createOffer({ offerToReceiveAudio: true });
    await pc.setLocalDescription(offer);
    if (offer.sdp) {
      opts.onSignal({ kind: "offer", sdp: offer.sdp });
    }
  }
  return true;
}

export async function handleGuestCallSignal(
  signal: SignalPayload,
  onSignal?: (signal: SignalPayload) => void,
): Promise<void> {
  const bundle = active;
  if (!bundle) return;
  const { pc } = bundle;
  if (signal.kind === "offer") {
    await pc.setRemoteDescription({ type: "offer", sdp: signal.sdp });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    if (answer.sdp && onSignal) {
      onSignal({ kind: "answer", sdp: answer.sdp });
    }
  } else if (signal.kind === "answer") {
    await pc.setRemoteDescription({ type: "answer", sdp: signal.sdp });
  } else if (signal.kind === "ice" && signal.candidate) {
    try {
      await pc.addIceCandidate(signal.candidate);
    } catch {
      /* race with remote description */
    }
  }
}

export async function stopGuestCallMedia(): Promise<void> {
  stopLocalVoiceMeter();
  const bundle = active;
  active = null;
  if (!bundle) return;
  try {
    bundle.localStream?.getTracks().forEach((t) => t.stop());
  } catch {
    /* ignore */
  }
  try {
    bundle.pc.close();
  } catch {
    /* ignore */
  }
}
