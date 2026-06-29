import { useSyncExternalStore } from "react";

/**
 * Local-first configuration for the broadcast identity, address, smart-home
 * integration, and the pre-programmed quick-alert messages.
 *
 * These fields are not part of the remote API contract yet, so they are
 * mirrored in localStorage for fast paint. `broadcastName` is stored on the
 * server (`owners.broadcast_name`) and is empty until the user sets it;
 * `resolveBroadcastName` falls back to first + last name when sending messages.
 */

const STORAGE_KEY = "zoneweaver_app_settings";

export const QUICK_MESSAGE_TYPES = [
  "PANIC",
  "SENSOR",
  "NS_PANIC",
  "UNKNOWN",
  "PA",
  "SERVICE",
  "WELLNESS_CHECK",
  "PRIVATE",
] as const;

export type QuickMessageType = (typeof QUICK_MESSAGE_TYPES)[number];

export type AddressSettings = {
  numberStreet: string;
  streetName: string;
  city: string;
  stateProvince: string;
  cityCode: string;
};

export type SharedNotificationSettings = {
  hid: string;
  networkId: string;
  apiKey: string;
  webhook: string;
  periodicalCheckSec: string;
};

export type AppSettings = {
  broadcastName: string;
  address: AddressSettings;
  sharedNotification: SharedNotificationSettings;
  quickMessages: Record<QuickMessageType, string>;
};

export const QUICK_MESSAGE_LABELS: Record<QuickMessageType, string> = {
  PANIC: "Panic alert",
  SENSOR: "Sensor alert",
  NS_PANIC: "Non-specific (anti-retaliation) alert",
  UNKNOWN: "Unknown alert",
  PA: "Public announcement",
  SERVICE: "Service request",
  WELLNESS_CHECK: "Wellness check",
  PRIVATE: "Private message",
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  broadcastName: "",
  address: {
    numberStreet: "",
    streetName: "",
    city: "",
    stateProvince: "",
    cityCode: "",
  },
  sharedNotification: {
    hid: "",
    networkId: "",
    apiKey: "",
    webhook: "",
    periodicalCheckSec: "86400",
  },
  quickMessages: {
    PANIC: "PANIC! Immediate assistance required at my location.",
    SENSOR: "Sensor triggered in my zone. Please verify.",
    NS_PANIC:
      "Non-specific alert: suspicious activity reported in the area. Sender identity withheld (anti-retaliation).",
    UNKNOWN: "Unknown alert reported in the zone.",
    PA: "Public announcement for the neighbourhood.",
    SERVICE: "Service request submitted.",
    WELLNESS_CHECK: "Wellness check: please confirm you are safe and well.",
    PRIVATE: "",
  },
};

function mergeSettings(raw: unknown): AppSettings {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_APP_SETTINGS };
  const row = raw as Partial<AppSettings>;
  return {
    broadcastName:
      typeof row.broadcastName === "string"
        ? row.broadcastName
        : DEFAULT_APP_SETTINGS.broadcastName,
    address: { ...DEFAULT_APP_SETTINGS.address, ...(row.address ?? {}) },
    sharedNotification: {
      ...DEFAULT_APP_SETTINGS.sharedNotification,
      ...(row.sharedNotification ?? {}),
    },
    quickMessages: {
      ...DEFAULT_APP_SETTINGS.quickMessages,
      ...(row.quickMessages ?? {}),
    },
  };
}

function load(): AppSettings {
  if (typeof window === "undefined") return { ...DEFAULT_APP_SETTINGS };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_APP_SETTINGS };
    return mergeSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_APP_SETTINGS };
  }
}

let current: AppSettings = load();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function getAppSettings(): AppSettings {
  return current;
}

export function updateAppSettings(patch: Partial<AppSettings>): AppSettings {
  current = mergeSettings({ ...current, ...patch });
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    /* ignore persistence failure */
  }
  emit();
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useAppSettings(): AppSettings {
  return useSyncExternalStore(subscribe, getAppSettings, getAppSettings);
}

/** Resolve the broadcast name to use for outgoing traffic. */
export function resolveBroadcastName(fallbackName?: string | null): string {
  const configured = current.broadcastName.trim();
  if (configured) return configured;
  const fallback = (fallbackName ?? "").trim();
  return fallback || "Member";
}
