import { Phone, PhoneIncoming, PhoneOff } from "lucide-react";
import { useGuestCallOptional } from "../../context/GuestCallContext";

export function CallOverlay() {
  const call = useGuestCallOptional();
  const session = call?.session ?? null;
  if (!call || !session) return null;

  const fullscreen = session.fullscreen;
  const isIncoming = session.state === "ringing" && !session.isCaller;
  const isOutgoing = session.state === "ringing" && session.isCaller;
  const connected = session.state === "connected";
  const title = connected
    ? `On call · ${call.elapsedLabel}`
    : isOutgoing
      ? `Calling ${session.guestName}…`
      : `${session.guestName} is calling`;

  return (
    <div
      className={[
        "pointer-events-none fixed inset-x-0 z-[200] flex justify-center px-3",
        fullscreen ? "bottom-0 top-0 items-center bg-[#081228]/90" : "top-3 sm:top-4",
      ].join(" ")}
    >
      <div
        className={[
          "pointer-events-auto w-full max-w-lg animate-[callSlideDown_280ms_ease-out] rounded-2xl bg-[#0F2C5C] p-4 text-white shadow-2xl",
          fullscreen ? "mx-4 py-8" : "",
        ].join(" ")}
      >
        <style>{`
          @keyframes callSlideDown {
            from { transform: translateY(-120%); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
          }
          @keyframes callPulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.1); }
          }
        `}</style>
        <div className="flex items-center gap-3">
          <div
            className="flex h-11 w-11 items-center justify-center rounded-full bg-[#2F80ED]"
            style={
              session.state === "ringing"
                ? { animation: "callPulse 1.4s ease-in-out infinite" }
                : undefined
            }
          >
            {isIncoming ? (
              <PhoneIncoming className="h-5 w-5" />
            ) : (
              <Phone className="h-5 w-5" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold">{title}</p>
            <p className="text-xs text-white/70">
              {connected
                ? "Voice connected"
                : fullscreen
                  ? "Escalated access request — please answer"
                  : "Guest access voice call"}
            </p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {isIncoming ? (
            <>
              <button
                type="button"
                onClick={call.acceptCall}
                className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-[#2FA24A] px-3 py-2 text-xs font-bold text-white"
              >
                <Phone className="h-3.5 w-3.5" /> Accept
              </button>
              <button
                type="button"
                onClick={call.rejectCall}
                className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-[#E23B4E] px-3 py-2 text-xs font-bold text-white"
              >
                <PhoneOff className="h-3.5 w-3.5" /> Reject
              </button>
            </>
          ) : null}
          {isOutgoing ? (
            <button
              type="button"
              onClick={call.cancelCall}
              className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-[#E23B4E] px-3 py-2 text-xs font-bold text-white"
            >
              <PhoneOff className="h-3.5 w-3.5" /> Cancel
            </button>
          ) : null}
          {connected ? (
            <button
              type="button"
              onClick={call.endCall}
              className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-[#E23B4E] px-3 py-2 text-xs font-bold text-white"
            >
              <PhoneOff className="h-3.5 w-3.5" /> End
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
