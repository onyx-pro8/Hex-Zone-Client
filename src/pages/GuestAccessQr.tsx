import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { QrCode } from "lucide-react";
import { GuestQrTokensAdmin } from "../components/guestQr/GuestQrTokensAdmin";
import { useAuth } from "../hooks/useAuth";
import { useZones, type SavedZone } from "../hooks/useZones";

export default function GuestAccessQr() {
  const { user } = useAuth();
  const userZoneId = user?.zone_id ?? user?.zoneId ?? null;
  const isAdministrator =
    String(user?.role ?? "").toLowerCase() === "administrator";

  const { zones, loading } = useZones(userZoneId, {
    role: user?.role,
    currentUserId: user?.id != null ? String(user.id) : null,
    accountOwnerId:
      user?.account_owner_id != null ? String(user.account_owner_id) : null,
  });

  const userZoneStr = String(userZoneId ?? "").trim();

  const [pickedZone, setPickedZone] = useState<string | null>(null);

  const zoneOptions = useMemo(() => {
    const list = (zones ?? []) as SavedZone[];
    const ids = new Set<string>();
    for (const z of list) {
      const id = String(z.zone_id ?? z.id ?? "").trim();
      if (id) ids.add(id);
    }
    return [...ids].sort();
  }, [zones]);

  const effectiveZone = useMemo(() => {
    const p = pickedZone?.trim();
    if (p) return p;
    if (userZoneStr && zoneOptions.includes(userZoneStr)) return userZoneStr;
    return zoneOptions[0] ?? "";
  }, [pickedZone, userZoneStr, zoneOptions]);

  if (loading && !userZoneStr && zoneOptions.length === 0) {
    return (
      <section className="space-y-4 p-4">
        <p className="text-sm text-[#8694AC]">Loading zones…</p>
      </section>
    );
  }

  return (
    <section className="space-y-8">
      <div>
        <span className="inline-flex items-center gap-2 rounded-full bg-[#EDF3FB] px-4 py-2 text-sm font-medium text-[#2F80ED]">
          <QrCode size={16} strokeWidth={2} /> Guest access
        </span>
        <h1 className="mt-4 text-3xl font-semibold text-[#0F2C5C] sm:text-4xl">
          Guest access QR
        </h1>
        <p className="mt-3 max-w-2xl text-lg leading-relaxed text-[#8694AC]">
          Administrators manage one reusable Guest QR per zone for{" "}
          <Link to="/access" className="text-[#2F80ED] hover:underline">
            /access?gt=…
          </Link>{" "}
          without sign-in. Rotate only when you need to invalidate the existing link.
          Account-invite QR codes stay under{" "}
          <Link to="/qr" className="text-[#2F80ED] hover:underline">
            QR invite
          </Link>
          . To edit the short messages guests see when requesting access, open{" "}
          <Link
            to="/guest-arrival-messages"
            className="text-[#2F80ED] hover:underline"
          >
            Guest arrival messages
          </Link>
          .
        </p>
      </div>

      {zoneOptions.length > 1 ? (
        <div className="max-w-md space-y-2">
          <label
            htmlFor="guest-qr-zone"
            className="block text-xs font-semibold uppercase tracking-[0.18em] text-[#8694AC]"
          >
            Zone
          </label>
          <select
            id="guest-qr-zone"
            value={effectiveZone}
            onChange={(e) => setPickedZone(e.target.value)}
            className="w-full rounded-md border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2 text-sm text-[#0F2C5C]"
          >
            {zoneOptions.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {!effectiveZone ? (
        <p className="rounded-md border border-[#E0992A]/30 bg-[#FBEFD8] px-4 py-3 text-sm text-[#E0992A]">
          No zone is available on this account. Set a zone on your profile or
          open the dashboard to configure zones.
        </p>
      ) : !isAdministrator ? (
        <p className="rounded-md border border-[#DCE6F2] bg-[#F7FAFE] px-4 py-3 text-sm text-[#566784]">
          Only <strong className="text-[#0F2C5C]">administrators</strong> can
          create and revoke guest QR tokens for a zone. Ask an administrator to
          issue a link or sign in with an admin account.
        </p>
      ) : (
        <div className="rounded-[1.25rem] border border-[#DCE6F2] bg-white p-5 sm:p-6">
          <GuestQrTokensAdmin zoneId={effectiveZone} />
        </div>
      )}
    </section>
  );
}
