import { useEffect, useState } from "react";
import { Check, ChevronDown, Copy, KeyRound, Search, X } from "lucide-react";
import {
  activatePublicUniversalAccessKey,
  deactivatePublicUniversalAccessKey,
  listActivatedUniversalAccessKeys,
  listPrivateUniversalAccessKeys,
  searchPublicUniversalAccessKeys,
  type UniversalAccessKeyRow,
} from "../../services/api/universalAccess";

type FieldStatus = "empty" | "inputting" | "selected";

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
  const [codes, setCodes] = useState<string[]>([""]);
  const [selectedFlags, setSelectedFlags] = useState<boolean[]>([false]);
  const [privateKeys, setPrivateKeys] = useState<UniversalAccessKeyRow[]>([]);
  const [activated, setActivated] = useState<UniversalAccessKeyRow[]>([]);
  const [suggestions, setSuggestions] = useState<UniversalAccessKeyRow[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function fieldStatus(index: number): FieldStatus {
    if (selectedFlags[index]) return "selected";
    if ((codes[index] ?? "").trim().length > 0) return "inputting";
    return "empty";
  }

  useEffect(() => {
    if (!open) return;
    setError(null);
    setCodes([""]);
    setSelectedFlags([false]);
    setSuggestions([]);
    setActiveIndex(0);
    void Promise.all([
      listPrivateUniversalAccessKeys(),
      listActivatedUniversalAccessKeys(),
    ]).then(([privateResult, activatedResult]) => {
      setPrivateKeys(privateResult.data ?? []);
      setActivated(activatedResult.data ?? []);
      if (privateResult.error) setError(privateResult.error);
      if (activatedResult.error) setError(activatedResult.error);
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (selectedFlags[activeIndex]) {
      setSuggestions([]);
      return;
    }
    const query = (codes[activeIndex] ?? "").trim();
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
  }, [codes, activeIndex, open, selectedFlags]);

  if (!open) return null;

  async function submitCodes() {
    const unique = [
      ...new Set(
        codes
          .map((item) => item.trim().toUpperCase())
          .filter(Boolean),
      ),
    ];
    if (unique.length === 0) {
      setError("Enter at least one public access key.");
      return;
    }
    setBusy(true);
    setError(null);
    for (const code of unique) {
      const result = await activatePublicUniversalAccessKey(code);
      if (result.error) {
        setBusy(false);
        setError(result.error);
        return;
      }
    }
    setBusy(false);
    setCodes([""]);
    setSelectedFlags([false]);
    setSuggestions([]);
    onActivated?.();
    const activatedResult = await listActivatedUniversalAccessKeys();
    setActivated(activatedResult.data ?? []);
  }

  async function removeActivated(credentialId: number) {
    const result = await deactivatePublicUniversalAccessKey(credentialId);
    if (result.error) {
      setError(result.error);
      return;
    }
    setActivated((prev) =>
      prev.filter((item) => item.credential_id !== credentialId),
    );
    onActivated?.();
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
          <div className="space-y-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[#566784]">
              Public access keys
            </p>
            {codes.map((code, index) => {
              const status = fieldStatus(index);
              const showMenu =
                status === "inputting" &&
                index === activeIndex &&
                suggestions.length > 0;
              const fieldClass =
                status === "selected"
                  ? "border-[#16A34A] bg-[rgba(22,163,74,0.06)]"
                  : status === "inputting"
                    ? "border-[#2F80ED] bg-white shadow-[0_0_0_3px_rgba(47,128,237,0.12)]"
                    : "border-[#DCE6F2] bg-white";
              return (
                <div key={`code-${index}`} className="relative z-10">
                  <div className="flex items-center gap-2">
                    <div
                      className={`flex min-h-11 flex-1 items-center gap-2 rounded-xl border px-3 ${fieldClass}`}
                    >
                      {status === "selected" ? (
                        <Check className="h-4 w-4 shrink-0 text-[#16A34A]" />
                      ) : (
                        <Search
                          className={`h-4 w-4 shrink-0 ${
                            status === "inputting" ? "text-[#2F80ED]" : "text-[#8694AC]"
                          }`}
                        />
                      )}
                      <input
                        value={code}
                        onFocus={() => setActiveIndex(index)}
                        onChange={(event) => {
                          const next = [...codes];
                          next[index] = event.target.value;
                          setCodes(next);
                          setSelectedFlags((prev) => {
                            const flags = [...prev];
                            flags[index] = false;
                            return flags;
                          });
                          setActiveIndex(index);
                        }}
                        placeholder="Search public key…"
                        className="w-full bg-transparent py-2.5 font-mono text-sm text-[#0F2C5C] outline-none placeholder:text-[#8694AC]"
                      />
                      {status === "selected" ? (
                        <span className="shrink-0 text-[11px] font-bold text-[#16A34A]">
                          Selected
                        </span>
                      ) : (
                        <ChevronDown
                          className={`h-4 w-4 shrink-0 ${
                            status === "inputting" ? "text-[#2F80ED]" : "text-[#8694AC]"
                          }`}
                        />
                      )}
                    </div>
                    {index > 0 ? (
                      <button
                        type="button"
                        aria-label="Remove key"
                        onClick={() => {
                          setCodes((prev) => prev.filter((_, i) => i !== index));
                          setSelectedFlags((prev) =>
                            prev.filter((_, i) => i !== index),
                          );
                          setActiveIndex((current) =>
                            current >= index ? Math.max(0, current - 1) : current,
                          );
                          setSuggestions([]);
                        }}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#DCE6F2] text-[#8694AC] hover:bg-[#F7FAFE] hover:text-[#0F2C5C]"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </div>
                  {showMenu ? (
                    <div className="absolute left-0 right-10 z-20 mt-1.5 overflow-hidden rounded-xl border border-[#DCE6F2] bg-white shadow-[0_12px_32px_rgba(15,44,92,0.14)]">
                      <div className="border-b border-[#DCE6F2] bg-[#F7FAFE] px-4 py-3">
                        <p className="text-[11px] font-semibold tracking-wide text-[#8694AC]">
                          {suggestions.length} match
                          {suggestions.length === 1 ? "" : "es"}
                        </p>
                      </div>
                      <ul className="max-h-52 overflow-auto">
                        {suggestions.map((item) => {
                          const zoneLabel =
                            (item.zones ?? []).map((zone) => zone.name).join(", ") ||
                            "Shared zones";
                          return (
                            <li key={item.credential_id}>
                              <button
                                type="button"
                                className="block w-full border-b border-[#EDF2F8] px-4 py-3.5 text-left last:border-b-0 hover:bg-[#F7FAFE]"
                                onClick={() => {
                                  const next = [...codes];
                                  next[index] = item.code;
                                  setCodes(next);
                                  setSelectedFlags((prev) => {
                                    const flags = [...prev];
                                    flags[index] = true;
                                    return flags;
                                  });
                                  setSuggestions([]);
                                }}
                              >
                                <span className="block font-mono text-sm font-semibold text-[#0F2C5C]">
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
              );
            })}
            <button
              type="button"
              className="text-xs font-semibold text-[#2F80ED]"
              onClick={() => {
                setCodes((prev) => [...prev, ""]);
                setSelectedFlags((prev) => [...prev, false]);
              }}
            >
              + Add another key
            </button>
          </div>

          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#566784]">
              Your private keys
            </p>
            {privateKeys.length === 0 ? (
              <p className="text-sm text-[#8694AC]">No private keys yet.</p>
            ) : (
              <ul className="space-y-1">
                {privateKeys.map((item) => (
                  <li
                    key={item.credential_id}
                    className="rounded-md border border-[#DCE6F2] px-3 py-2 text-sm text-[#0F2C5C]"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono">{item.code}</span>
                      <CopyKeyButton code={item.code} />
                    </div>
                    <span className="mt-0.5 block font-sans text-xs text-[#8694AC]">
                      {(item.zones ?? []).map((zone) => zone.name).join(", ") || "Zones"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {activated.length > 0 ? (
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#566784]">
                Activated public keys
              </p>
              <ul className="space-y-1">
                {activated.map((item) => (
                  <li
                    key={item.credential_id}
                    className="flex items-center justify-between gap-2 rounded-md border border-[#DCE6F2] px-3 py-2 text-sm text-[#0F2C5C]"
                  >
                    <span className="font-mono">{item.code}</span>
                    <div className="flex items-center gap-1.5">
                      <CopyKeyButton code={item.code} />
                      <button
                        type="button"
                        aria-label="Remove activated key"
                        onClick={() => void removeActivated(item.credential_id)}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#DCE6F2] text-[#8694AC] hover:bg-[#F7FAFE] hover:text-[#0F2C5C]"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

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
              disabled={busy}
              onClick={() => void submitCodes()}
              className="rounded-lg bg-[#2F80ED] px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
            >
              {busy ? "Applying…" : "Apply keys"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
