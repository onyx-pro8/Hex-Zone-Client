import { useCallback, useEffect, useState } from "react";
import { Lock, X } from "lucide-react";
import {
  getPrivateThread,
  type PrivateThreadMessage,
} from "../../services/api/messageFeature";

type Props = {
  otherOwnerId: number;
  currentOwnerId: number;
  onClose: () => void;
};

export function PrivateThreadModal({
  otherOwnerId,
  currentOwnerId,
  onClose,
}: Props) {
  const [messages, setMessages] = useState<PrivateThreadMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await getPrivateThread(otherOwnerId);
    if (result.error) {
      setError(result.error);
      setMessages([]);
    } else {
      setMessages(result.data ?? []);
    }
    setLoading(false);
  }, [otherOwnerId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div
      className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-[#DCE6F2] bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-[#DCE6F2] px-4 py-3">
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-[#2F80ED]" aria-hidden />
            <h2 className="text-sm font-bold text-[#0F2C5C]">
              Private thread · Member {otherOwnerId}
            </h2>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="text-[#8694AC] hover:text-[#0F2C5C]"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 space-y-2 overflow-y-auto bg-[#F3F7FD] px-4 py-4">
          {loading ? (
            <p className="text-center text-xs text-[#8694AC]">Loading thread…</p>
          ) : error ? (
            <p className="text-center text-xs text-[#E23B4E]">{error}</p>
          ) : messages.length === 0 ? (
            <p className="text-center text-xs text-[#8694AC]">
              No private messages in this thread yet.
            </p>
          ) : (
            messages.map((msg) => {
              const mine = msg.senderId === currentOwnerId;
              return (
                <div
                  key={msg.id}
                  className={`flex ${mine ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
                      mine
                        ? "bg-[#2F80ED] text-white"
                        : "border border-[#DCE6F2] bg-white text-[#0F2C5C]"
                    }`}
                  >
                    <p className="leading-snug">{msg.text}</p>
                    <p
                      className={`mt-1 text-[10px] ${
                        mine ? "text-white/70" : "text-[#8694AC]"
                      }`}
                    >
                      {new Date(msg.createdAt).toLocaleString()}
                    </p>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
