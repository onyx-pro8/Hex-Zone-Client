import { useEffect, useState } from "react";
import { X } from "lucide-react";
import {
  subscribeUiToast,
  type UiToastDetail,
  type UiToastType,
} from "../lib/uiToast";

type ToastItem = UiToastDetail & { id: string };

const TYPE_STYLES: Record<UiToastType, string> = {
  success: "border-[#B7E0C2] bg-[#F3FBF5] text-[#1B5E20]",
  warning: "border-[#F0D9A8] bg-[#FFF8EB] text-[#8A5A00]",
  error: "border-[#F0C2C2] bg-[#FFF5F5] text-[#B71C1C]",
  info: "border-[#DCE6F2] bg-white text-[#0F2C5C]",
};

/**
 * Floating toast stack for web (settings save, smart-home webhook feedback, etc.).
 */
export function UiToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    return subscribeUiToast((detail) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const item: ToastItem = { ...detail, id };
      setItems((prev) => [...prev, item].slice(-3));
      window.setTimeout(() => {
        setItems((prev) => prev.filter((t) => t.id !== id));
      }, detail.duration ?? 3200);
    });
  }, []);

  if (!items.length) return null;

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[80] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2">
      {items.map((item) => {
        const type = item.type ?? "info";
        return (
          <div
            key={item.id}
            className={`pointer-events-auto rounded-xl border px-4 py-3 shadow-lg ${TYPE_STYLES[type]}`}
            role="status"
          >
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                {item.title ? (
                  <p className="text-xs font-bold uppercase tracking-wide opacity-80">
                    {item.title}
                  </p>
                ) : null}
                <p className="text-sm font-medium leading-snug">{item.message}</p>
              </div>
              <button
                type="button"
                aria-label="Dismiss"
                className="rounded p-0.5 opacity-60 hover:opacity-100"
                onClick={() =>
                  setItems((prev) => prev.filter((t) => t.id !== item.id))
                }
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
