/**
 * Helpers for surfacing alarm-category geo messages as browser notifications.
 *
 * Browser notifications work even when the tab is in the background; we also
 * play a short tone via Web Audio so the user notices without owning a custom
 * audio asset. All helpers degrade gracefully when the browser does not
 * implement the Notification API (Safari iOS, etc.) — callers should still
 * call `showInAppAlarm` for a visual fallback.
 */
import type { MessageFeaturePropagationResponse } from "../services/api/messageFeature";

export const ALARM_MESSAGE_TYPES = [
  "UNKNOWN",
  "PANIC",
  "NS_PANIC",
  "SENSOR",
] as const;

export type AlarmMessageType = (typeof ALARM_MESSAGE_TYPES)[number];

export function isAlarmType(value: string | null | undefined): value is AlarmMessageType {
  if (!value) return false;
  return (ALARM_MESSAGE_TYPES as readonly string[]).includes(value.toUpperCase());
}

export function browserSupportsNotifications(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function notificationPermission(): NotificationPermission | "unsupported" {
  if (!browserSupportsNotifications()) return "unsupported";
  return Notification.permission;
}

/**
 * Request notification permission. Must be invoked from a user gesture for the
 * prompt to appear in most browsers. Returns the final permission.
 */
export async function requestAlarmNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
  if (!browserSupportsNotifications()) return "unsupported";
  if (Notification.permission === "granted" || Notification.permission === "denied") {
    return Notification.permission;
  }
  try {
    const result = await Notification.requestPermission();
    return result;
  } catch {
    return Notification.permission;
  }
}

type AlarmDisplayPayload = {
  type: string;
  text?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt?: string | null;
};

function broadcastNameFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const pick = (o: Record<string, unknown>): string | null => {
    const v = o.broadcast_name ?? o.broadcastName;
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };
  const top = pick(metadata);
  if (top) return top;
  const msg = metadata.msg;
  if (msg && typeof msg === "object" && !Array.isArray(msg)) {
    return pick(msg as Record<string, unknown>);
  }
  return null;
}

export function alarmTitle(payload: AlarmDisplayPayload): string {
  const label = String(payload.type || "ALARM").replace(/_/g, " ");
  const broadcast = broadcastNameFromMetadata(payload.metadata);
  return broadcast ? `${broadcast} · ${label}` : `Safe Zone Patrol ${label}`;
}

export function alarmBody(payload: AlarmDisplayPayload): string {
  const raw = (payload.text ?? "").toString().trim();
  if (raw) return raw.slice(0, 240);
  const meta = payload.metadata as Record<string, unknown> | undefined;
  const position = meta?.position as { latitude?: unknown; longitude?: unknown } | undefined;
  if (position && Number.isFinite(Number(position.latitude)) && Number.isFinite(Number(position.longitude))) {
    return `Alarm originated near ${Number(position.latitude).toFixed(4)}, ${Number(position.longitude).toFixed(4)}`;
  }
  return String(payload.type || "ALARM").replace(/_/g, " ");
}

export function alarmTag(payload: AlarmDisplayPayload): string {
  const meta = payload.metadata as Record<string, unknown> | undefined;
  const hid = typeof meta?.hid === "string" ? meta.hid : "";
  return `hexzone-alarm-${String(payload.type || "ALARM")}-${hid}-${payload.createdAt ?? Date.now()}`;
}

/**
 * Show a system notification for an alarm; no-op if permission is missing.
 */
export function showBrowserAlarmNotification(payload: AlarmDisplayPayload): boolean {
  if (!browserSupportsNotifications()) return false;
  if (Notification.permission !== "granted") return false;
  try {
    const notif = new Notification(alarmTitle(payload), {
      body: alarmBody(payload),
      tag: alarmTag(payload),
      requireInteraction: false,
      silent: false,
    });
    /** Bring the tab forward when the user clicks the notification. */
    notif.onclick = () => {
      try {
        window.focus();
        notif.close();
      } catch {
        /* ignore */
      }
    };
    return true;
  } catch {
    return false;
  }
}

let cachedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor: typeof AudioContext | undefined =
    (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!cachedAudioCtx) {
    try {
      cachedAudioCtx = new Ctor();
    } catch {
      cachedAudioCtx = null;
    }
  }
  return cachedAudioCtx;
}

/** Short two-tone beep; safe to call repeatedly. */
export function playAlarmSound(): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") {
    void ctx.resume().catch(() => undefined);
  }
  const now = ctx.currentTime;
  const tone = (frequency: number, start: number, duration: number) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, now + start);
    gain.gain.exponentialRampToValueAtTime(0.25, now + start + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + start + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now + start);
    osc.stop(now + start + duration + 0.05);
  };
  tone(880, 0, 0.18);
  tone(660, 0.22, 0.22);
}

export function alarmFromPropagation(
  response: MessageFeaturePropagationResponse | null | undefined,
): AlarmDisplayPayload | null {
  if (!response || !isAlarmType(response.type ?? null)) return null;
  const row = response as unknown as Record<string, unknown>;
  const text =
    typeof row.text === "string"
      ? row.text
      : typeof (row.metadata as Record<string, unknown> | undefined)?.msg === "object"
        ? String(
            ((row.metadata as Record<string, unknown>).msg as Record<string, unknown>).description ??
              ((row.metadata as Record<string, unknown>).msg as Record<string, unknown>).title ??
              "",
          )
        : "";
  return {
    type: String(response.type ?? "ALARM"),
    text: text || null,
    metadata: (row.metadata as Record<string, unknown> | null | undefined) ?? null,
    createdAt: typeof response.created_at === "string" ? response.created_at : null,
  };
}
