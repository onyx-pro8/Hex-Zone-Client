import { Link } from "react-router-dom";
import { QrCode } from "lucide-react";

type Props = {
  zoneId: string;
  compact?: boolean;
};

/** Dashboard teaser: full issuance lives on Guest QR (admin). */
export function GuestAccessQrSection({ zoneId, compact = false }: Props) {
  const normalizedZone = zoneId.trim();
  if (!normalizedZone) {
    return (
      <div className="rounded-xl border border-[#DCE6F2] bg-[#F7FAFE] px-4 py-3 text-sm text-[#8694AC]">
        Select or enter a zone, then use{" "}
        <Link to="/guest-access-qr" className="text-[#2F80ED] hover:underline">
          Guest QR
        </Link>{" "}
        to issue guest access tokens.
      </div>
    );
  }

  return (
    <section
      id="guest-access-qr-section"
      className={`rounded-xl border border-[#DCE6F2] bg-white ${compact ? "px-4 py-4" : "px-5 py-5"}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#2F80ED]">
            <QrCode className="h-4 w-4" /> Guest access QR
          </p>
          <p className="mt-1 max-w-xl text-sm text-[#566784]">
            View and manage the reusable primary guest QR (
            <span className="font-mono">/access?gt=…</span>) for this zone.
            Requires an administrator account.
          </p>
        </div>
        <Link
          to="/guest-access-qr"
          className="inline-flex shrink-0 items-center gap-2 rounded-md border border-[#DCE6F2] bg-white px-3 py-2 text-xs font-medium text-[#566784] transition hover:border-[#2F80ED]/50 hover:text-[#2F80ED]"
        >
          Open Guest QR
        </Link>
      </div>
      <p className="mt-2 text-xs text-[#8694AC]">
        Current zone:{" "}
        <span className="font-mono text-[#566784]">{normalizedZone}</span>
      </p>
    </section>
  );
}
