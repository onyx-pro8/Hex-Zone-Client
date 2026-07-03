import { useCallback, useEffect, useMemo, useState } from "react";
import QRCode from "react-qr-code";
import { Copy, Loader2, RefreshCw, RotateCw } from "lucide-react";
import {
  fetchNetworkAccessQrToken,
  guestNetworkQrRotatePath,
  rotateNetworkAccessQrToken,
} from "../../services/api/guestQrTokens";
import { absoluteUrlFromPathWithQuery } from "../../lib/guestAccessUrls";
import { apiClient } from "../../services/api/client";

type Props = {
  zoneId: string;
};

export function NetworkAccessQrAdmin({ zoneId }: Props) {
  const z = zoneId.trim();
  const [tokenUrl, setTokenUrl] = useState("");
  const [tokenSuffix, setTokenSuffix] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [rotateBusy, setRotateBusy] = useState(false);
  const [rotateAvailable, setRotateAvailable] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const qrSvgId = useMemo(() => `network-access-qr-${z}`, [z]);

  const copyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      /* ignore */
    }
  };

  const refreshNetwork = useCallback(async () => {
    if (!z) return;
    setLoading(true);
    setError("");
    const res = await fetchNetworkAccessQrToken(z);
    setLoading(false);
    if (res.error || !res.data) {
      setError(res.error ?? "Could not load network access QR.");
      return;
    }
    const rawUrl =
      String(res.data.url ?? "").trim() ||
      (res.data.path_with_query
        ? absoluteUrlFromPathWithQuery(window.location.origin, res.data.path_with_query)
        : "");
    if (!rawUrl) {
      setError("Network access QR did not include a usable URL.");
      return;
    }
    setTokenUrl(rawUrl);
    setTokenSuffix(String(res.data.token_suffix ?? "").trim());
  }, [z]);

  useEffect(() => {
    if (!z) return;
    void refreshNetwork();
  }, [z, refreshNetwork]);

  useEffect(() => {
    let alive = true;
    if (!z) return;
    void apiClient
      .options(guestNetworkQrRotatePath(), { params: { zone_id: z } })
      .then((res) => {
        if (alive) setRotateAvailable(res.status !== 404 && res.status !== 405);
      })
      .catch(() => {
        if (alive) setRotateAvailable(false);
      });
    return () => {
      alive = false;
    };
  }, [z]);

  const handleRotate = async () => {
    if (!z || rotateBusy) return;
    setRotateBusy(true);
    setError("");
    const res = await rotateNetworkAccessQrToken(z);
    setRotateBusy(false);
    if (res.error || !res.data) {
      setError(res.error ?? "Could not rotate network access QR.");
      return;
    }
    await refreshNetwork();
  };

  if (!z) return null;

  return (
    <section className="rounded-xl border border-[#DCE6F2] bg-[#F7FAFE] px-5 py-5">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#2F80ED]">
        Network guest QR
      </p>
      <p className="mt-2 max-w-xl text-sm text-[#566784]">
        One reusable link per network (
        <span className="font-mono">/access?gt=…&amp;nid=…</span>). Guests submit a request; an
        administrator must approve before they can sign in. After approval they can chat via access
        messages; map zones are optional.
      </p>

      {loading ? (
        <p className="mt-4 inline-flex items-center gap-2 text-sm text-[#8694AC]">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </p>
      ) : null}
      {error ? (
        <p className="mt-4 rounded-md border border-[#E23B4E]/30 bg-[#FDEDEF] px-3 py-2 text-sm text-[#E23B4E]">
          {error}
        </p>
      ) : null}

      {tokenUrl ? (
        <div className="mt-4 flex flex-wrap items-start gap-6">
          <div className="rounded-lg border border-[#DCE6F2] bg-white p-3">
            <QRCode id={qrSvgId} value={tokenUrl} size={160} />
          </div>
          <div className="min-w-0 flex-1 space-y-3">
            <p className="text-xs text-[#8694AC]">
              Network id: <span className="font-mono text-[#566784]">{z}</span>
              {tokenSuffix ? (
                <>
                  {" "}
                  · token …<span className="font-mono">{tokenSuffix}</span>
                </>
              ) : null}
            </p>
            <p className="break-all font-mono text-xs text-[#566784]">{tokenUrl}</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void copyText("url", tokenUrl)}
                className="inline-flex items-center gap-1 rounded-md border border-[#DCE6F2] bg-white px-3 py-1.5 text-xs font-medium text-[#566784] hover:border-[#2F80ED]/50"
              >
                <Copy className="h-3.5 w-3.5" />
                {copied === "url" ? "Copied" : "Copy link"}
              </button>
              <button
                type="button"
                onClick={() => void refreshNetwork()}
                className="inline-flex items-center gap-1 rounded-md border border-[#DCE6F2] bg-white px-3 py-1.5 text-xs font-medium text-[#566784] hover:border-[#2F80ED]/50"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Refresh
              </button>
              {rotateAvailable ? (
                <button
                  type="button"
                  disabled={rotateBusy}
                  onClick={() => void handleRotate()}
                  className="inline-flex items-center gap-1 rounded-md border border-[#E0992A]/40 bg-[#FBEFD8] px-3 py-1.5 text-xs font-medium text-[#E0992A] hover:border-[#E0992A]"
                >
                  <RotateCw className={`h-3.5 w-3.5 ${rotateBusy ? "animate-spin" : ""}`} />
                  Rotate
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
