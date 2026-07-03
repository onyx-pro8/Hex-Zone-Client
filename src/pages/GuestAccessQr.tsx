import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { QrCode } from "lucide-react";
import { NetworkAccessQrAdmin } from "../components/guestQr/NetworkAccessQrAdmin";
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

  const networkId = String(userZoneId ?? "").trim();

  const [pickedZone, setPickedZone] = useState<string | null>(null);

  const zoneOptions = useMemo(() => {
    const list = (zones ?? []) as SavedZone[];
    const ids = new Set<string>();
    if (networkId) ids.add(networkId);
    for (const z of list) {
      const id = String(z.zone_id ?? z.id ?? "").trim();
      if (id) ids.add(id);
    }
    return [...ids].sort();
  }, [zones, networkId]);

  /** Network guest QR uses `owners.zone_id` — geometry zones are optional. */
  const effectiveNetworkId = useMemo(() => {
    const p = pickedZone?.trim();
    if (p) return p;
    if (networkId) return networkId;
    return zoneOptions[0] ?? "";
  }, [pickedZone, networkId, zoneOptions]);

  if (loading && !networkId && zoneOptions.length === 0) {
    return (
      <section className="space-y-4">
        <p className="text-sm text-[#8694AC]">Loading zones…</p>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-[#DCE6F2] bg-white p-6 shadow-sm">
        <span className="inline-flex items-center gap-2 rounded-full bg-[#EDF3FB] px-4 py-2 text-sm font-medium text-[#2F80ED]">
          <QrCode size={16} strokeWidth={2} /> Guest access QR
        </span>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[#566784]">
          Administrators share one reusable <strong className="text-[#0F2C5C]">network guest QR</strong> for{" "}
          <Link to="/access" className="text-[#2F80ED] hover:underline">
            /access?nid=…
          </Link>
          . Guests request access at the network level; an administrator must approve before they can
          sign in. After approval they can use{" "}
          <strong className="text-[#0F2C5C]">access messages</strong> (CHAT) with your network; drawing
          acceptable zones on the map is optional. Account member invites stay under{" "}
          <Link to="/qr" className="text-[#2F80ED] hover:underline">
            QR invite
          </Link>
          .
        </p>

        {zoneOptions.length > 1 ? (
          <div className="mt-5 max-w-md space-y-2">
            <label
              htmlFor="guest-qr-zone"
              className="block text-xs font-semibold uppercase tracking-[0.18em] text-[#8694AC]"
            >
              Network
            </label>
            <select
              id="guest-qr-zone"
              value={effectiveNetworkId}
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
      </div>

      {!effectiveNetworkId ? (
        <p className="rounded-md border border-[#E0992A]/30 bg-[#FBEFD8] px-4 py-3 text-sm text-[#E0992A]">
          No network id on this account. Complete administrator signup or set your network id on your
          profile before issuing a guest QR.
        </p>
      ) : !isAdministrator ? (
        <p className="rounded-md border border-[#DCE6F2] bg-[#F7FAFE] px-4 py-3 text-sm text-[#566784]">
          Only <strong className="text-[#0F2C5C]">administrators</strong> can
          create and revoke guest QR tokens for a zone. Ask an administrator to
          issue a link or sign in with an admin account.
        </p>
      ) : (
        <div className="rounded-2xl border border-[#DCE6F2] bg-white p-6 shadow-sm">
          <NetworkAccessQrAdmin zoneId={effectiveNetworkId} />
        </div>
      )}
    </section>
  );
}
