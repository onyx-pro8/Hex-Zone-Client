import { useCallback, useEffect, useState } from "react";
import { HeartPulse } from "lucide-react";
import {
  acknowledgeWellnessCheck,
  askWellnessSender,
  listWellnessAcknowledgements,
  replyToWellnessAsks,
  type WellnessAckSummary,
} from "../../services/api/messageFeature";
import { WELLNESS_ACK_EVENT } from "../../services/socket/messageSocket";

type Props = {
  messageEventId: string;
  currentOwnerId: number | null;
  senderId: number | null;
};

export function WellnessAckPanel({ messageEventId, currentOwnerId, senderId }: Props) {
  const [summary, setSummary] = useState<WellnessAckSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await listWellnessAcknowledgements(messageEventId);
    if (result.error) {
      setError(result.error);
      setSummary(null);
    } else {
      setSummary(result.data);
    }
    setLoading(false);
  }, [messageEventId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ messageEventId?: string }>).detail;
      if (detail?.messageEventId === messageEventId) {
        void load();
      }
    };
    window.addEventListener(WELLNESS_ACK_EVENT, handler);
    return () => window.removeEventListener(WELLNESS_ACK_EVENT, handler);
  }, [load, messageEventId]);

  const isSender = currentOwnerId != null && senderId === currentOwnerId;
  const isExpectedRecipient =
    currentOwnerId != null &&
    summary?.expected_recipient_ids.includes(currentOwnerId) === true;
  const alreadyAcked = summary?.acknowledgements.some(
    (row) => row.owner_id === currentOwnerId,
  );
  const canAck = isExpectedRecipient && !alreadyAcked;
  const hasPendingAskFromMe =
    currentOwnerId != null &&
    (summary?.pending_sender_asks.some((row) => row.asker_owner_id === currentOwnerId) ??
      false);
  const canAskSender = isExpectedRecipient && !hasPendingAskFromMe;
  const canReplyAsSender =
    isSender && (summary?.pending_sender_asks.length ?? 0) > 0;
  const latestSenderReplyForMe =
    currentOwnerId != null && !isSender
      ? [...(summary?.sender_replies ?? [])]
          .reverse()
          .find((row) => row.answered_asker_ids.includes(currentOwnerId))
      : null;

  const submitAck = async (status: "ok" | "need_help") => {
    setBusy(true);
    setError(null);
    const result = await acknowledgeWellnessCheck(messageEventId, { status });
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setSummary(result.data);
  };

  const submitAskSender = async () => {
    setBusy(true);
    setError(null);
    const result = await askWellnessSender(messageEventId);
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setSummary(result.data);
  };

  const submitSenderReply = async (status: "ok" | "need_help") => {
    setBusy(true);
    setError(null);
    const result = await replyToWellnessAsks(messageEventId, { status });
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setSummary(result.data);
  };

  return (
    <div className="rounded-xl border border-[#F0DBB0] bg-[#FBEFD8] p-4">
      <div className="flex items-center gap-2 text-sm font-bold text-[#E0992A]">
        <HeartPulse className="h-4 w-4" aria-hidden />
        Wellness check responses
      </div>
      {loading ? (
        <p className="mt-2 text-xs text-[#8694AC]">Loading acknowledgements…</p>
      ) : error ? (
        <p className="mt-2 text-xs text-[#E23B4E]">{error}</p>
      ) : summary ? (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-[#566784]">
            {summary.acknowledgements.length} of {summary.expected_recipient_ids.length}{" "}
            expected member(s) responded
            {summary.pending_recipient_ids.length > 0
              ? ` · ${summary.pending_recipient_ids.length} pending`
              : ""}
          </p>
          {canAck ? (
            <div className="space-y-2">
              <p className="text-xs font-medium text-[#566784]">Your response:</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void submitAck("ok")}
                  className="rounded-md bg-[#2FA24A] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                >
                  I&apos;m OK
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void submitAck("need_help")}
                  className="rounded-md bg-[#E23B4E] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                >
                  Need help
                </button>
              </div>
            </div>
          ) : null}
          {alreadyAcked ? (
            <p className="text-xs font-medium text-[#2FA24A]">
              You acknowledged this wellness check.
            </p>
          ) : null}
          {canAskSender ? (
            <div className="space-y-2">
              <p className="text-xs font-medium text-[#566784]">Ask the sender:</p>
              <button
                type="button"
                disabled={busy}
                onClick={() => void submitAskSender()}
                className="rounded-md border border-[#E0992A] bg-white px-3 py-1.5 text-xs font-semibold text-[#E0992A] disabled:opacity-60"
              >
                Ask sender to respond
              </button>
            </div>
          ) : null}
          {hasPendingAskFromMe ? (
            <p className="text-xs text-[#566784]">
              Waiting for the sender to respond to your ask.
            </p>
          ) : null}
          {latestSenderReplyForMe ? (
            <p className="text-xs font-medium text-[#0F2C5C]">
              Sender replied:{" "}
              {latestSenderReplyForMe.status === "need_help" ? "Needs help" : "OK"}
            </p>
          ) : null}
          {canReplyAsSender ? (
            <div className="space-y-2">
              <p className="text-xs font-medium text-[#566784]">
                {summary.pending_sender_asks.length} member(s) asked you to respond.
                One reply answers all pending asks.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void submitSenderReply("ok")}
                  className="rounded-md bg-[#2FA24A] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                >
                  I&apos;m OK
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void submitSenderReply("need_help")}
                  className="rounded-md bg-[#E23B4E] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                >
                  Need help
                </button>
              </div>
            </div>
          ) : null}
          {isSender && summary.acknowledgements.length > 0 ? (
            <ul className="space-y-1 text-xs text-[#566784]">
              {summary.acknowledgements.map((row) => (
                <li key={row.id}>
                  Member {row.owner_id}:{" "}
                  <span className="font-semibold text-[#0F2C5C]">
                    {row.status === "need_help" ? "Needs help" : "OK"}
                  </span>
                  {row.created_at
                    ? ` · ${new Date(row.created_at).toLocaleString()}`
                    : ""}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
