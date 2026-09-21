import { uiToast } from "./uiToast";

/** Success toast after Settings → Smart-home integration save. */
export function toastSmartHomeSettingsSaved(options?: {
  webhook?: string | null;
  hid?: string | null;
}): void {
  const webhook = (options?.webhook ?? "").trim();
  const hid = (options?.hid ?? "").trim();
  if (webhook) {
    uiToast.success(
      hid
        ? `Saved for ${hid}. Alarm/Alert messages on your network will POST to your hub.`
        : "Webhook saved. Alarm/Alert messages on your network will POST to your hub.",
      { title: "Smart-home integration" },
    );
    return;
  }
  uiToast.success(
    "Settings saved. Add a public webhook URL to push Alarm/Alert messages to your hub.",
    { title: "Smart-home integration" },
  );
}

export type SmartHomeWebhookSocketPayload = {
  ok?: boolean | null;
  hid?: string | null;
  title?: string | null;
  toast?: string | null;
};

/** Toast for the hub owner after server POSTs (or fails) their webhook. */
export function toastSmartHomeWebhookOwnerResult(
  payload: SmartHomeWebhookSocketPayload | null | undefined,
): void {
  if (!payload || typeof payload !== "object") return;
  const ok = payload.ok === true;
  const text =
    (typeof payload.toast === "string" && payload.toast.trim()) ||
    (ok ? "Hub notified." : "Hub webhook failed.");
  if (ok) {
    uiToast.success(text, { title: "Smart-home" });
  } else {
    uiToast.warning(text, { title: "Smart-home", duration: 4500 });
  }
}

/** @deprecated Sender-side webhook toasts removed — hub owners get WS toasts. */
export function toastSmartHomeWebhookDelivery(_stats: unknown): void {
  // Intentionally no-op.
}
