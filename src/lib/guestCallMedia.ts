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
    try {
      return await nav.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch {
      return null;
    }
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("react-native-webrtc") as {
      mediaDevices?: { getUserMedia: (c: object) => Promise<MediaStream> };
    };
    if (mod.mediaDevices?.getUserMedia) {
      return await mod.mediaDevices.getUserMedia({ audio: true, video: false });
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
