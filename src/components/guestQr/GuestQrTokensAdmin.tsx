import { useCallback, useEffect, useMemo, useState } from "react";
import QRCode from "react-qr-code";
import {
  Copy,
  Download,
  Loader2,
  RefreshCw,
  RotateCw,
} from "lucide-react";
import {
  fetchPrimaryGuestQrToken,
  guestPrimaryQrRotatePath,
  rotatePrimaryGuestQrToken,
} from "../../services/api/guestQrTokens";
import {
  absoluteUrlFromPathWithQuery,
  ensureGuestAccessUrlIncludesZidWhenGtOnly,
} from "../../lib/guestAccessUrls";
import { apiClient } from "../../services/api/client";

type Props = {
  zoneId: string;
};

export function GuestQrTokensAdmin({ zoneId }: Props) {
  const z = zoneId.trim();
  const [tokenUrl, setTokenUrl] = useState("");
  const [tokenSuffix, setTokenSuffix] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [rotateBusy, setRotateBusy] = useState(false);
  const [rotateAvailable, setRotateAvailable] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const qrSvgId = useMemo(() => `primary-guest-qr-${z}`, [z]);

  const copyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      /* ignore */
    }
  };

  const refreshPrimary = useCallback(async () => {
    if (!z) return;
    setLoading(true);
    setError("");
    const res = await fetchPrimaryGuestQrToken(z);
    setLoading(false);
    if (res.error || !res.data) {
      setError(res.error ?? "Could not load primary guest QR.");
      return;
    }
    const rawUrl =
      String(res.data.url ?? "").trim() ||
      (res.data.path_with_query
        ? absoluteUrlFromPathWithQuery(window.location.origin, res.data.path_with_query)
        : "");
    const next = ensureGuestAccessUrlIncludesZidWhenGtOnly(rawUrl, z);
    if (!next) {
      setError("Primary guest QR did not include a usable URL.");
      return;
    }
    setTokenUrl(next);
    setTokenSuffix(String(res.data.token_suffix ?? "").trim());
  }, [z]);

  useEffect(() => {
    if (!z) return;
    void refreshPrimary();
  }, [z, refreshPrimary]);

  useEffect(() => {
    let alive = true;
    if (!z) return;
    void apiClient
      .options(guestPrimaryQrRotatePath(), {
        params: { zone_id: z },
        validateStatus: () => true,
      })
      .then((res) => {
        if (!alive) return;
        setRotateAvailable(res.status !== 404);
      })
      .catch(() => {
        if (alive) setRotateAvailable(false);
      });
    return () => {
      alive = false;
    };
  }, [z]);

  const runRotate = async () => {
    if (!z) return;
    const ok = window.confirm(
      "Rotate the primary guest QR for this zone? Existing links will stop working.",
    );
    if (!ok) return;
    setRotateBusy(true);
    setError("");
    const res = await rotatePrimaryGuestQrToken(z);
    setRotateBusy(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    await refreshPrimary();
  };

  const runDownload = () => {
    const node = document.getElementById(qrSvgId);
    if (!node) return;
    const blob = new Blob([node.outerHTML], { type: "image/svg+xml;charset=utf-8" });
    const u = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = u;
    a.download = `guest-qr-${z}.svg`;
    a.click();
    URL.revokeObjectURL(u);
  };

  if (!z) return null;

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-300">Reusable Guest QR for this zone</p>
      <p className="text-xs text-slate-500">
        No expiration unless manually rotated/revoked by admin
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void refreshPrimary()}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-md border border-[#DCE6F2] px-3 py-1.5 text-xs text-[#566784]"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Refresh
        </button>
        {rotateAvailable ? (
          <button
            type="button"
            onClick={() => void runRotate()}
            disabled={rotateBusy}
            className="inline-flex items-center gap-2 rounded-md border border-[#DCE6F2] px-3 py-1.5 text-xs text-[#566784]"
          >
            {rotateBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />}
            Rotate QR
          </button>
        ) : null}
      </div>
      {error ? (
        <p className="rounded-md border border-[#E23B4E]/30 bg-[#FCE7EA] px-3 py-2 text-sm text-[#E23B4E]">
          {error}
        </p>
      ) : null}
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-[#DCE6F2] bg-white p-5 sm:flex-row sm:items-start">
        <div className="rounded-2xl bg-white p-4">
          {tokenUrl ? <QRCode id={qrSvgId} value={tokenUrl} size={200} level="M" /> : <p className="max-w-[200px] text-center text-xs text-[#8694AC]">No URL available.</p>}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#8694AC]">Guest URL</p>
          <code className="block break-all rounded-lg border border-[#DCE6F2] bg-[#F7FAFE] px-2 py-1.5 text-xs text-[#566784]">
            {tokenUrl || "—"}
          </code>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void copyText("primary-url", tokenUrl)}
              disabled={!tokenUrl}
              className="inline-flex items-center gap-1 rounded-md border border-[#DCE6F2] px-3 py-1.5 text-xs text-[#566784] hover:border-[#2F80ED]/50"
            >
              <Copy className="h-3.5 w-3.5" />
              {copied === "primary-url" ? "Copied" : "Copy URL"}
            </button>
            <button
              type="button"
              onClick={runDownload}
              disabled={!tokenUrl}
              className="inline-flex items-center gap-1 rounded-md border border-[#DCE6F2] px-3 py-1.5 text-xs text-[#566784] hover:border-[#2F80ED]/50"
            >
              <Download className="h-3.5 w-3.5" />
              Download QR
            </button>
          </div>
          <p className="text-xs text-slate-500">Suffix ···{tokenSuffix || "—"}</p>
        </div>
      </div>
    </div>
  );
}
