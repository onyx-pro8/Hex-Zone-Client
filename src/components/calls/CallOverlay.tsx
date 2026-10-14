import { Phone, PhoneOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useGuestCallOptional } from "../../context/GuestCallContext";
import { API_BASE_URL } from "../../services/api/client";

function otherPartyName(
  callerRole: "guest" | "admin",
  isCaller: boolean,
  guestName: string,
) {
  if (callerRole === "guest") {
    return isCaller ? "Administrator" : guestName;
  }
  return isCaller ? guestName : "Administrator";
}

function avatarSrc(url: string | null): string | null {
  if (!url) return null;
  if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("data:")) {
    return url;
  }
  const base = API_BASE_URL.replace(/\/$/, "");
  return `${base}${url.startsWith("/") ? url : `/${url}`}`;
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (
    parts
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "C"
  );
}

function visualKey(session: {
  guestId: string;
  callId: string;
}): string {
  return session.guestId.trim() || session.callId;
}

export function CallOverlay() {
  const call = useGuestCallOptional();
  const session = call?.session ?? null;
  const viewingAdmin = session
    ? session.callerRole === "guest"
      ? session.isCaller
      : !session.isCaller
    : false;
  const photoUrl = session
    ? avatarSrc(viewingAdmin ? session.adminAvatarUrl : session.guestAvatarUrl)
    : null;

  const [photo, setPhoto] = useState<string | null>(null);
  const [reveal, setReveal] = useState(false);
  const revealedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!session) {
      revealedKeyRef.current = null;
      setReveal(false);
      setPhoto(null);
      return;
    }
    const key = visualKey(session);
    const alreadyOpen = revealedKeyRef.current === key;
    let cancelled = false;

    const openCard = (readyPhoto: string | null) => {
      if (cancelled) return;
      setPhoto(readyPhoto);
      revealedKeyRef.current = key;
      setReveal(true);
    };

    if (!photoUrl) {
      if (alreadyOpen) {
        setPhoto(null);
        return;
      }
      const wait = window.setTimeout(() => openCard(null), 30);
      return () => {
        cancelled = true;
        window.clearTimeout(wait);
      };
    }

    const img = new Image();
    const timeout = window.setTimeout(() => openCard(photoUrl), 1100);
    img.onload = () => {
      window.clearTimeout(timeout);
      openCard(photoUrl);
    };
    img.onerror = () => {
      window.clearTimeout(timeout);
      openCard(null);
    };
    img.src = photoUrl;
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      img.onload = null;
      img.onerror = null;
    };
  }, [session, photoUrl]);

  if (!call || !session || !reveal) return null;

  const fullscreen = session.fullscreen;
  const isQueued = session.state === "queued";
  const isIncoming = session.state === "ringing" && !session.isCaller;
  const isOutgoing = session.state === "ringing" && session.isCaller;
  const connected = session.state === "connected";
  const ringing = session.state === "ringing";
  const party = otherPartyName(session.callerRole, session.isCaller, session.guestName);
  const queueLabel =
    session.queuePosition && session.queuePosition > 1
      ? `Waiting in queue · ${session.queuePosition}`
      : "Waiting in queue…";
  const status = connected
    ? call.elapsedLabel
    : isQueued
      ? queueLabel
      : isOutgoing
        ? "Calling…"
        : "Incoming call";

  const avatar = (light: boolean) => (
    <div className="relative flex h-[7.25rem] w-[7.25rem] items-center justify-center">
      {ringing ? (
        <>
          <span className={`call-halo call-halo-a ${light ? "call-halo-light" : ""}`} />
          <span className={`call-halo call-halo-b ${light ? "call-halo-light" : ""}`} />
          <span className={`call-halo call-halo-c ${light ? "call-halo-light" : ""}`} />
        </>
      ) : (
        <span
          className={`absolute inset-[-10px] rounded-full ${
            light ? "bg-[#2F80ED]/10" : "bg-[#5AA2F7]/10"
          }`}
        />
      )}
      <div
        className={`relative z-[1] flex h-[7.25rem] w-[7.25rem] items-center justify-center overflow-hidden rounded-full bg-[#16345f] text-[2.15rem] font-semibold tracking-wide text-white ${
          light
            ? "shadow-[0_14px_36px_rgba(15,44,92,0.14)] ring-[3px] ring-[#0F2C5C]/10"
            : "shadow-[0_12px_40px_rgba(5,16,38,0.55)] ring-[3px] ring-white/20"
        } ${ringing ? "call-avatar-breathe" : ""}`}
      >
        {photo ? (
          <img src={photo} alt="" className="h-full w-full object-cover" />
        ) : (
          initials(party)
        )}
      </div>
    </div>
  );

  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-[200] flex flex-col bg-[linear-gradient(165deg,#F8FBFF_0%,#EEF4FC_48%,#F5F8FC_100%)] px-8 pb-12 pt-12 text-[#0F2C5C]">
        <style>{CALL_CSS}</style>
        <p className="relative text-center text-[11px] font-semibold uppercase tracking-[0.28em] text-[#8694AC]">
          Access call
        </p>
        <div className="relative flex flex-1 flex-col items-center justify-center call-enter">
          <div className="mb-8">{avatar(true)}</div>
          <p className="text-center text-[2.15rem] font-semibold tracking-[-0.03em] text-[#0F2C5C]">
            {party}
          </p>
          <p className="mt-2.5 text-[15px] font-medium tabular-nums tracking-wide text-[#2F80ED]">
            {status}
          </p>
          <p className="mt-2 max-w-xs text-center text-[13px] leading-5 text-[#8694AC]">
            {connected
              ? "Voice connected"
              : isQueued
                ? "Another call is in progress. Yours starts when it ends."
                : isIncoming
                  ? "Answer to speak with them"
                  : "Waiting for an answer"}
          </p>
        </div>
        <div className="relative flex items-end justify-center gap-14">
          {isIncoming ? (
            <>
              <button type="button" onClick={call.rejectCall} className="flex flex-col items-center gap-2.5">
                <span className="flex h-[4.35rem] w-[4.35rem] items-center justify-center rounded-full bg-[#D64545] text-white shadow-[0_10px_24px_rgba(214,69,69,0.28)]">
                  <PhoneOff className="h-6 w-6" />
                </span>
                <span className="text-[12px] font-medium text-[#566784]">Decline</span>
              </button>
              <button type="button" onClick={call.acceptCall} className="flex flex-col items-center gap-2.5">
                <span className="flex h-[4.35rem] w-[4.35rem] items-center justify-center rounded-full bg-[#2E9B57] text-white shadow-[0_10px_24px_rgba(46,155,87,0.28)]">
                  <Phone className="h-6 w-6" />
                </span>
                <span className="text-[12px] font-medium text-[#566784]">Accept</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={connected ? call.endCall : call.cancelCall}
              className="flex flex-col items-center gap-2.5"
            >
              <span className="flex h-[4.35rem] w-[4.35rem] items-center justify-center rounded-full bg-[#D64545] text-white shadow-[0_10px_24px_rgba(214,69,69,0.28)]">
                <PhoneOff className="h-6 w-6" />
              </span>
              <span className="text-[12px] font-medium text-[#566784]">
                {connected ? "End" : "Cancel"}
              </span>
            </button>
          )}
        </div>
      </div>
    );
  }

  const title = connected
    ? `On call · ${call.elapsedLabel}`
    : isQueued
      ? queueLabel
      : isOutgoing
        ? `Calling ${party}…`
        : `${party} is calling`;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[200] flex justify-center px-3 sm:top-4">
      <style>{CALL_CSS}</style>
      <div className="pointer-events-auto w-full max-w-lg call-card-enter rounded-2xl border border-white/10 bg-[#0B1C36]/95 p-4 text-white shadow-[0_18px_50px_rgba(5,16,38,0.45)] backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="relative flex h-12 w-12 items-center justify-center">
            {ringing ? <span className="call-halo-sm" /> : null}
            <div className="relative z-[1] h-12 w-12 overflow-hidden rounded-full bg-[#16345f] ring-2 ring-white/20">
              {photo ? (
                <img src={photo} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-sm font-semibold">
                  {initials(party)}
                </span>
              )}
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold tracking-[-0.01em]">{title}</p>
            <p className="text-[12px] text-white/55">
              {connected
                ? "Voice connected"
                : isQueued
                  ? "Yours starts when the current call ends"
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
                className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl bg-[#2E9B57] px-3 py-2.5 text-xs font-semibold text-white"
              >
                <Phone className="h-3.5 w-3.5" /> Accept
              </button>
              <button
                type="button"
                onClick={call.rejectCall}
                className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl bg-[#D64545] px-3 py-2.5 text-xs font-semibold text-white"
              >
                <PhoneOff className="h-3.5 w-3.5" /> Reject
              </button>
            </>
          ) : null}
          {isOutgoing || isQueued ? (
            <button
              type="button"
              onClick={call.cancelCall}
              className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl bg-[#D64545] px-3 py-2.5 text-xs font-semibold text-white"
            >
              <PhoneOff className="h-3.5 w-3.5" /> Cancel
            </button>
          ) : null}
          {connected ? (
            <button
              type="button"
              onClick={call.endCall}
              className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl bg-[#D64545] px-3 py-2.5 text-xs font-semibold text-white"
            >
              <PhoneOff className="h-3.5 w-3.5" /> End
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

const CALL_CSS = `
  @keyframes callEnter {
    from { opacity: 0; transform: translateY(18px) scale(0.985); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
  @keyframes callCardEnter {
    from { opacity: 0; transform: translateY(-18px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes callHalo {
    0% { transform: scale(0.82); opacity: 0.42; }
    70% { opacity: 0.12; }
    100% { transform: scale(1.55); opacity: 0; }
  }
  @keyframes callHaloSm {
    0% { transform: scale(0.9); opacity: 0.4; }
    100% { transform: scale(1.55); opacity: 0; }
  }
  @keyframes callBreathe {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(1.028); }
  }
  .call-enter { animation: callEnter 420ms cubic-bezier(0.22, 1, 0.36, 1); }
  .call-card-enter { animation: callCardEnter 380ms cubic-bezier(0.22, 1, 0.36, 1); }
  .call-halo {
    position: absolute;
    inset: -18px;
    border-radius: 9999px;
    border: 1.5px solid rgba(154, 196, 255, 0.38);
    box-shadow: 0 0 0 8px rgba(47, 128, 237, 0.05);
    animation: callHalo 2.4s cubic-bezier(0.22, 0.61, 0.36, 1) infinite;
  }
  .call-halo-light {
    border-color: rgba(47, 128, 237, 0.28);
    box-shadow: 0 0 0 8px rgba(47, 128, 237, 0.04);
  }
  .call-halo-b { animation-delay: 0.8s; }
  .call-halo-c { animation-delay: 1.6s; }
  .call-halo-sm {
    position: absolute;
    inset: -8px;
    border-radius: 9999px;
    border: 1px solid rgba(154, 196, 255, 0.4);
    animation: callHaloSm 1.8s ease-out infinite;
  }
  .call-avatar-breathe { animation: callBreathe 3.2s ease-in-out infinite; }
`;
