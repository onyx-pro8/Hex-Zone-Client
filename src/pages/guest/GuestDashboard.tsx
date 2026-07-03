import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, MessageSquare } from "lucide-react";
import { getGuestSessionMeta } from "../../lib/guestAccessToken";
import { tryParseGuestDashboardMap, networkZonesFromGuestDashboard } from "../../lib/guestDashboardMap";
import GuestZoneReadOnlyMap from "../../components/guest/GuestZoneReadOnlyMap";
import { fetchGuestMe, fetchGuestZoneDashboard } from "../../services/api/guestMessages";
import type { GuestMe } from "../../services/api/guestMessages";

function zonesFromMeAndStored(me: GuestMe | null, stored: ReturnType<typeof getGuestSessionMeta>): string[] {
  if (me?.zone_ids?.length) return me.zone_ids;
  if (stored?.zone_ids?.length) return stored.zone_ids;
  if (stored?.zone_id?.trim()) return [stored.zone_id.trim()];
  return [];
}

function primaryZoneForUi(me: GuestMe | null, stored: ReturnType<typeof getGuestSessionMeta>, zones: string[]): string {
  const fb = stored?.zone_id?.trim();
  if (fb && zones.includes(fb)) return fb;
  return zones[0] ?? "";
}

/** Parsed from `GET /api/guest/zones/{id}/dashboard` success `data`. */
type GuestZoneDashboardPayload = {
  zone_id?: string;
  label?: string;
  welcome_text?: string;
  links?: unknown[];
};

function asDashboardPayload(d: unknown): GuestZoneDashboardPayload | null {
  if (!d || typeof d !== "object" || Array.isArray(d)) return null;
  return d as GuestZoneDashboardPayload;
}

function dashboardLinks(
  raw: unknown,
): { href: string; label: string }[] {
  if (!Array.isArray(raw)) return [];
  const out: { href: string; label: string }[] = [];
  for (const item of raw) {
    if (typeof item === "string" && item.trim()) {
      out.push({ href: item.trim(), label: item.trim() });
      continue;
    }
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const o = item as Record<string, unknown>;
      const hrefRaw = o.url ?? o.href ?? o.link;
      const href = typeof hrefRaw === "string" && hrefRaw.trim() ? hrefRaw.trim() : "";
      if (!href) continue;
      const labRaw = o.label ?? o.title ?? o.text;
      const label =
        typeof labRaw === "string" && labRaw.trim() ? labRaw.trim() : href;
      out.push({ href, label });
    }
  }
  return out;
}

export default function GuestDashboard() {
  const stored = useMemo(() => getGuestSessionMeta(), []);
  const [me, setMe] = useState<GuestMe | null>(null);
  const [dashboard, setDashboard] = useState<unknown | null>(null);
  const [dashNote, setDashNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);

  const zones = useMemo(() => zonesFromMeAndStored(me, stored), [me, stored]);
  const primaryZone = useMemo(() => primaryZoneForUi(me, stored, zones), [me, stored, zones]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setProfileError(null);
      const m = await fetchGuestMe();
      if (!alive) return;
      if (m.data) {
        setMe(m.data);
        setProfileError(null);
      } else {
        setMe(null);
        setProfileError(m.error ?? "Could not refresh profile from the server.");
      }
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [stored?.zone_id]);

  useEffect(() => {
    let alive = true;
    const z = primaryZone.trim();
    if (!z) {
      setDashboard(null);
      setDashNote(null);
      return;
    }
    (async () => {
      const dash = await fetchGuestZoneDashboard(z);
      if (!alive) return;
      if (dash.error) {
        setDashNote(dash.error);
        setDashboard(null);
      } else if (dash.notFound) {
        setDashNote(null);
        setDashboard(null);
      } else {
        setDashNote(null);
        setDashboard(dash.data);
      }
    })();
    return () => {
      alive = false;
    };
  }, [primaryZone]);

  const displayName = me?.display_name || stored?.display_name || "Guest";
  const dash = asDashboardPayload(dashboard);
  const linkRows = dashboardLinks(dash?.links);
  const guestMapModel = useMemo(() => tryParseGuestDashboardMap(dashboard), [dashboard]);
  const networkZones = useMemo(() => networkZonesFromGuestDashboard(dashboard), [dashboard]);
  const zonesForDisplay = networkZones.length
    ? networkZones.map((z) => z.name)
    : zones;
  /** Map/hints tie to resolved zone + dashboard blob; `/me` can still be loading separately. */
  const dashboardGeoReady = primaryZone.trim().length > 0;

  return (
    <section className="mx-auto w-full min-w-0 max-w-[min(1920px,100%)] space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-[#0F2C5C]">Guest dashboard</h1>
        <p className="text-sm text-[#8694AC]">
          Signed in as <span className="text-[#566784]">{displayName}</span>
        </p>
        <p className="text-xs text-[#8694AC]">
          Guest access is read-only for dashboard, map, and members.
        </p>
      </header>

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-[#8694AC]">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading…
        </p>
      ) : null}

      {!loading && profileError ? (
        <p className="rounded-md border border-[#E0992A]/30 bg-[#FBEFD8] px-3 py-2 text-sm text-[#E0992A]">
          {profileError} Saved session data below still works if your token is valid (e.g. open Messages). If this
          persists, confirm the server exposes <span className="font-mono">GET /api/guest/me</span> and matches the
          response shape this app expects.
        </p>
      ) : null}

      {!loading ? (
        <div className="space-y-4 rounded-2xl border border-[#DCE6F2] bg-white p-5">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-[#8694AC]">
              Zones
            </h2>
            {zonesForDisplay.length ? (
              <ul className="mt-2 space-y-1 text-sm text-[#566784]">
                {networkZones.length
                  ? networkZones.map((z) => (
                      <li key={String(z.id)} className="break-all">
                        <span className="font-medium text-[#0F2C5C]">{z.name}</span>
                        {z.networkId ? (
                          <span className="ml-2 font-mono text-xs text-[#8694AC]">{z.networkId}</span>
                        ) : null}
                      </li>
                    ))
                  : zonesForDisplay.map((z) => (
                      <li key={z} className="break-all font-mono text-[#2F80ED]">
                        {z}
                      </li>
                    ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-[#8694AC]">
                No zone on this session. Return to{" "}
                <Link className="text-[#2F80ED] underline" to="/access">
                  guest access
                </Link>{" "}
                with your invite link.
              </p>
            )}
          </div>

          {primaryZone ? (
            <Link
              to={`/guest/messages?zone=${encodeURIComponent(primaryZone)}`}
              className="inline-flex items-center gap-2 rounded-md bg-[#2F80ED] px-4 py-2.5 text-sm font-bold text-white transition hover:brightness-110"
            >
              <MessageSquare className="h-4 w-4" /> Open messages
            </Link>
          ) : (
            <p className="text-sm text-[#8694AC]">Pick a zone from your host to use messaging.</p>
          )}

          {dashboardGeoReady && guestMapModel ? (
            <div className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-[#8694AC]">
                Zone map (read-only)
              </h2>
              <GuestZoneReadOnlyMap center={guestMapModel.center} polygons={guestMapModel.polygons} />
            </div>
          ) : null}

          {dashboardGeoReady &&
          !guestMapModel &&
          dashboard != null &&
          typeof dashboard === "object" ? (
            <div className="rounded-lg border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2 text-xs text-[#8694AC]">
              Map requires backend dashboard map payload (
              <span className="font-mono text-[#8694AC]">geojson</span>,{" "}
              <span className="font-mono text-[#8694AC]">bounds</span>,{" "}
              <span className="font-mono text-[#8694AC]">h3_cells</span>,{" "}
              <span className="font-mono text-[#8694AC]">geo_fence</span>). See README.md (Guest session, Backend
              integration) and share{" "}
              <span className="font-mono text-[#566784]">docs/BACKEND_ACCESS_ZONE_FULL_CONTRACT.md</span> with your API
              team.
            </div>
          ) : null}

          {dash && (dash.label || dash.welcome_text || linkRows.length > 0) ? (
            <div className="space-y-3 rounded-xl border border-[#2FA24A]/30 bg-[#E3F4E8] px-4 py-4 text-[#2FA24A]">
              {dash.label ? (
                <h3 className="text-lg font-semibold text-[#0F2C5C]">{dash.label}</h3>
              ) : null}
              {dash.welcome_text ? (
                <p className="text-sm leading-relaxed text-[#2FA24A]">{dash.welcome_text}</p>
              ) : null}
              {linkRows.length > 0 ? (
                <ul className="space-y-1 text-sm">
                  {linkRows.map((l) => (
                    <li key={l.href}>
                      <a
                        href={l.href}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[#2F80ED] underline hover:text-[#2F80ED]"
                      >
                        {l.label}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {dashNote ? (
            <p className="text-xs text-[#E0992A]">Dashboard extra: {dashNote}</p>
          ) : null}

          {dashboard != null && typeof dashboard === "object" ? (
            <details className="rounded-lg border border-[#DCE6F2] bg-[#F7FAFE] p-3 text-xs text-[#8694AC]">
              <summary className="cursor-pointer font-medium text-[#566784]">
                Raw zone dashboard JSON
              </summary>
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all">
                {JSON.stringify(dashboard, null, 2)}
              </pre>
            </details>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
