export type UiToastType = "info" | "success" | "warning" | "error";

export type UiToastDetail = {
  message: string;
  title?: string;
  type?: UiToastType;
  duration?: number;
};

const EVENT_NAME = "hexzone:ui-toast";

/** Fire a lightweight floating toast (consumed by UiToastHost). */
export function showUiToast(message: string, options: Omit<UiToastDetail, "message"> = {}): void {
  const trimmed = message.trim();
  if (!trimmed || typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<UiToastDetail>(EVENT_NAME, {
      detail: {
        message: trimmed,
        title: options.title?.trim() || undefined,
        type: options.type ?? "info",
        duration: options.duration ?? 3200,
      },
    }),
  );
}

export const uiToast = {
  info: (message: string, options?: Omit<UiToastDetail, "message" | "type">) =>
    showUiToast(message, { ...options, type: "info" }),
  success: (message: string, options?: Omit<UiToastDetail, "message" | "type">) =>
    showUiToast(message, { ...options, type: "success" }),
  warning: (message: string, options?: Omit<UiToastDetail, "message" | "type">) =>
    showUiToast(message, { ...options, type: "warning" }),
  error: (message: string, options?: Omit<UiToastDetail, "message" | "type">) =>
    showUiToast(message, { ...options, type: "error" }),
};

export function subscribeUiToast(listener: (detail: UiToastDetail) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (event: Event) => {
    const custom = event as CustomEvent<UiToastDetail>;
    if (custom.detail?.message) listener(custom.detail);
  };
  window.addEventListener(EVENT_NAME, handler as EventListener);
  return () => window.removeEventListener(EVENT_NAME, handler as EventListener);
}
