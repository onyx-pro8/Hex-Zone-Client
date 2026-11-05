import { useEffect, useMemo, useState } from "react";
import { Check, Copy, KeyRound, Search, X } from "lucide-react";
import {
  listPrivateUniversalAccessKeys,
  searchPublicUniversalAccessKeys,
  sendUniversalAccessKey,
  type UniversalAccessKeyRow,
} from "../../services/api/universalAccess";

function CopyKeyButton({ code }: { code: string }) {
  return (
    <button
      type="button"
      aria-label="Copy access key"
      onClick={() => {
        void navigator.clipboard.writeText(code).catch(() => undefined);
      }}
      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[#DCE6F2] px-2 py-1 text-[11px] font-bold text-[#2F80ED] hover:bg-[#F7FAFE]"
    >
      <Copy className="h-3 w-3" />
      Copy
    </button>
  );
}

type Props = {
  open: boolean;
  onClose: () => void;
  onActivated?: () => void;
};

export function UniversalAccessKeyModal({ open, onClose, onActivated }: Props) {
  const [privateKeys, setPrivateKeys] = useState<UniversalAccessKeyRow[]>([]);
  const [publicQuery, setPublicQuery] = useState("");
  const [suggestions, setSuggestions] = useState<UniversalAccessKeyRow[]>([]);
  const [pickedPublic, setPickedPublic] = useState<UniversalAccessKeyRow | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selectableKeys = useMemo(() => {
    const rows = [...privateKeys];
    if (
      pickedPublic &&
      !rows.some((row) => row.credential_id === pickedPublic.credential_id)
    ) {
      rows.push(pickedPublic);
    }
    return rows;
  }, [privateKeys, pickedPublic]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setPublicQuery("");
    setSuggestions([]);
    setPickedPublic(null);
    setSelectedId(null);
    void listPrivateUniversalAccessKeys().then((result) => {
      setPrivateKeys(result.data ?? []);
      if (result.error) setError(result.error);
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const query = publicQuery.trim();
    if (query.length < 3) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void searchPublicUniversalAccessKeys(query).then((result) => {
        if (cancelled) return;
        setSuggestions(Array.isArray(result.data) ? result.data : []);
      });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [publicQuery, open]);

  if (!open) return null;

  function selectKey(item: UniversalAccessKeyRow) {
    setSelectedId(item.credential_id);
    setError(null);
  }

  async function onSendKey() {
    if (selectedId == null) {
      setError("Select one access key to send.");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await sendUniversalAccessKey(selectedId);
    setBusy(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    onActivated?.();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl border border-[#DCE6F2] bg-white shadow-xl">
        <header className="flex items-center justify-between border-b border-[#DCE6F2] px-4 py-3">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-[#2F80ED]" />
            <span className="text-sm font-bold text-[#0F2C5C]">Universal access keys</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-[#8694AC] hover:bg-[#F7FAFE] hover:text-[#0F2C5C]"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="space-y-4 px-4 py-4">
          {error ? (
            <p className="rounded-md border border-[#E23B4E]/30 bg-[#FCE7EA] px-3 py-2 text-sm text-[#E23B4E]">
              {error}
            </p>
          ) : null}

          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[#566784]">
              Find a public access key
            </p>
            <div className="relative">
              <div className="flex min-h-11 items-center gap-2 rounded-xl border border-[#DCE6F2] bg-white px-3">
                <Search className="h-4 w-4 shrink-0 text-[#8694AC]" />
                <input
                  value={publicQuery}
                  onChange={(event) => setPublicQuery(event.target.value)}
                  placeholder="Search public key"
                  className="min-w-0 flex-1 bg-transparent text-sm text-[#0F2C5C] outline-none placeholder:text-[#8694AC]"
                />
              </div>
              {suggestions.length > 0 ? (
                <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-[#DCE6F2] bg-white shadow-lg">
                  <ul className="max-h-48 overflow-auto py-1">
                    {suggestions.map((item) => {
                      const zoneLabel =
                        (item.zones ?? []).map((zone) => zone.name).join(", ") || "Zones";
                      return (
                        <li key={item.credential_id}>
                          <button
                            type="button"
                            className="w-full px-3 py-2 text-left hover:bg-[#F7FAFE]"
                            onClick={() => {
                              setPickedPublic(item);
                              setSelectedId(item.credential_id);
                              setPublicQuery(item.code);
                              setSuggestions([]);
                              setError(null);
                            }}
                          >
                            <span className="block truncate font-mono text-sm text-[#0F2C5C]">
                              {item.code}
                            </span>
                            <span className="mt-1 block truncate text-xs text-[#8694AC]">
                              {zoneLabel}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}
            </div>
          </div>

          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#566784]">
              Select one key
            </p>
            {selectableKeys.length === 0 ? (
              <p className="text-sm text-[#8694AC]">
                No private keys yet. Search for a public key above.
              </p>
            ) : (
              <ul className="space-y-1">
                {selectableKeys.map((item) => {
                  const selected = selectedId === item.credential_id;
                  return (
                    <li
                      key={`${item.key_type}-${item.credential_id}`}
                      className={`rounded-xl border px-3 py-2 text-sm text-[#0F2C5C] ${
                        selected
                          ? "border-[#16A34A] bg-[rgba(22,163,74,0.06)]"
                          : "border-[#DCE6F2] bg-white"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          aria-pressed={selected}
                          onClick={() => selectKey(item)}
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        >
                          {selected ? (
                            <Check className="h-4 w-4 shrink-0 text-[#16A34A]" />
                          ) : null}
                          <span className="truncate font-mono">{item.code}</span>
                          <span className="shrink-0 rounded bg-[#EEF3FA] px-1.5 py-0.5 text-[10px] font-bold uppercase text-[#566784]">
                            {item.key_type}
                          </span>
                          <span
                            className={`shrink-0 text-[11px] font-bold ${
                              selected ? "text-[#16A34A]" : "text-[#2F80ED]"
                            }`}
                          >
                            {selected ? "Selected" : "Select"}
                          </span>
                        </button>
                        <CopyKeyButton code={item.code} />
                      </div>
                      <span className="mt-0.5 block font-sans text-xs text-[#8694AC]">
                        {(item.zones ?? []).map((zone) => zone.name).join(", ") || "Zones"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[#DCE6F2] px-4 py-2 text-sm font-bold text-[#566784]"
            >
              Close
            </button>
            <button
              type="button"
              disabled={busy || selectedId == null}
              onClick={() => void onSendKey()}
              className="rounded-lg bg-[#2F80ED] px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
            >
              {busy ? "Sending…" : "Send key"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
