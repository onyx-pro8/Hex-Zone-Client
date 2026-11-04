/**
 * Guest↔admin voice through LiveKit.
 * The browser joins the same per-call room as the phone, microphone only.
 */

import { Room, RoomEvent, Track } from "livekit-client";

type SignalPayload =
  | { kind: "offer"; sdp: string }
  | { kind: "answer"; sdp: string }
  | { kind: "ice"; candidate: RTCIceCandidateInit }
  | { kind: "audio"; b64: string; level?: number };

const levelListeners = new Set<(level: number) => void>();
let room: Room | null = null;
let levelTimer: ReturnType<typeof setInterval> | null = null;
let session = 0;
const remoteElements: HTMLMediaElement[] = [];

function closedOnPurpose(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /closed|abort|disconnect|cancel/i.test(message);
}
let unlockContext: AudioContext | null = null;

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

function audioContext(): AudioContext | null {
  const Host = globalThis as typeof globalThis & {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const Ctor = Host.AudioContext || Host.webkitAudioContext;
  if (!Ctor) return null;
  if (!unlockContext || unlockContext.state === "closed") unlockContext = new Ctor();
  if (unlockContext.state === "suspended") void unlockContext.resume();
  return unlockContext;
}

/** Call from the Call or Accept click so the browser may play remote audio. */
export function primeLocalVoiceContext() {
  audioContext();
}

export function guestCallMediaAvailable(): boolean {
  return true;
}

export async function startGuestCallMedia(_opts: {
  isOfferer: boolean;
  onSignal: (signal: SignalPayload) => void;
}): Promise<boolean> {
  primeLocalVoiceContext();
  return true;
}

export async function handleGuestCallSignal(
  _signal: SignalPayload,
  _onSignal?: (signal: SignalPayload) => void,
): Promise<void> {
  /* Voice is the LiveKit room, not socket audio frames. */
}

export async function connectLiveKitCall(
  serverUrl: string,
  token: string,
): Promise<"joined" | "cancelled" | "failed"> {
  await stopGuestCallMedia();
  const mine = session;
  primeLocalVoiceContext();
  const next = new Room({
    audioCaptureDefaults: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  room = next;
  next.on(RoomEvent.TrackSubscribed, (track) => {
    if (track.kind !== Track.Kind.Audio) return;
    const element = track.attach();
    element.autoplay = true;
    document.body.appendChild(element);
    remoteElements.push(element);
  });
  try {
    await next.connect(serverUrl, token);
    if (mine !== session) return "cancelled";
    await next.localParticipant.setMicrophoneEnabled(true);
    if (mine !== session) return "cancelled";
    await next.startAudio();
  } catch (error) {
    if (mine !== session || closedOnPurpose(error)) return "cancelled";
    if (room === next) {
      room = null;
      try {
        await next.disconnect();
      } catch {
        /* already closed */
      }
    }
    return "failed";
  }
  if (mine !== session || room !== next) return "cancelled";
  levelTimer = setInterval(() => {
    if (room !== next) return;
    publishLocalVoiceLevel(next.localParticipant.audioLevel || 0);
  }, 80);
  return "joined";
}

export async function stopGuestCallMedia(): Promise<void> {
  session += 1;
  if (levelTimer) clearInterval(levelTimer);
  levelTimer = null;
  publishLocalVoiceLevel(0);
  for (const element of remoteElements.splice(0)) {
    try {
      element.pause();
      element.remove();
    } catch {
      /* ignore */
    }
  }
  const current = room;
  room = null;
  if (current) {
    const { setLogLevel, LogLevel } = await import("livekit-client");
    setLogLevel(LogLevel.silent);
    try {
      await current.disconnect();
    } catch {
      /* ignore */
    } finally {
      setLogLevel(LogLevel.info);
    }
  }
}
