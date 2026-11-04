import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Check, Copy, KeyRound, RefreshCw, Search } from "lucide-react";
import { useAuth } from "../hooks/useAuth";

async function copyAccessKey(code: string) {
  try {
    await navigator.clipboard.writeText(code);
  } catch {
    // ignore
  }
}

function ReviewDocument({ label, value }: { label: string; value?: string }) {
  const uri = (value || "").trim();
  const isImage = uri.startsWith("data:image/");
  const isPdf = uri.startsWith("data:application/pdf");
  return (
    <div className="mt-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[#566784]">
        {label}
      </p>
      {isImage ? (
        <img
          src={uri}
          alt={label}
          className="mt-2 max-h-64 w-full rounded-lg border border-[#DCE6F2] bg-[#F7FAFE] object-contain"
        />
      ) : isPdf ? (
        <iframe
          title={label}
          src={uri}
          className="mt-2 h-64 w-full rounded-lg border border-[#DCE6F2]"
        />
      ) : uri ? (
        <a
          href={uri}
          download
          className="mt-2 inline-flex text-sm font-semibold text-[#2F80ED] hover:underline"
        >
          Download document
        </a>
      ) : (
        <p className="mt-1 text-sm text-[#8694AC]">Not provided</p>
      )}
    </div>
  );
}

function CopyableAccessKey({
  code,
  label = "Access key",
}: {
  code: string;
  label?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-mono text-sm font-semibold text-[#0F2C5C]">
        {label ? `${label}: ${code}` : code}
      </span>
      <button
        type="button"
        onClick={() => void copyAccessKey(code)}
        className="inline-flex items-center gap-1 rounded-md border border-[#DCE6F2] px-2 py-1 text-[11px] font-bold text-[#2F80ED] hover:bg-[#F7FAFE]"
        aria-label="Copy access key"
      >
        <Copy className="h-3 w-3" />
        Copy
      </button>
    </div>
  );
}
import {
  approveUniversalAccessRequest,
  createInviteUniversalAccessRequest,
  createPlaceAccessUniversalRequest,
  deleteUniversalAccessRequest,
  getUniversalAccessRequest,
  listShareableUniversalZones,
  listUniversalAccessRequests,
  rejectUniversalAccessRequest,
  searchUniversalAccessInvitees,
  searchUniversalAccessTargets,
  setUniversalAccessEnabled,
  updateUniversalAccessDocs,
  type UniversalAccessInvitee,
  type UniversalAccessRequestRow,
  type UniversalAccessTargetNetwork,
  type UniversalAccessZone,
} from "../services/api/universalAccess";
import { formatServerDateTime } from "../lib/serverDate";

type Tab = "invite" | "place" | "list";

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Could not read the file."));
    reader.readAsDataURL(file);
  });
}

function inferredMime(file: File): string {
  if (file.type) return file.type.toLowerCase();
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) return "application/pdf";
  if (name.endsWith(".doc")) return "application/msword";
  if (name.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (name.endsWith(".txt")) return "text/plain";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".gif")) return "image/gif";
  if (name.endsWith(".webp")) return "image/webp";
  return "";
}

function businessMimeAllowed(mime: string): boolean {
  return (
    mime.startsWith("image/") ||
    mime === "application/pdf" ||
    mime === "application/msword" ||
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mime === "text/plain"
  );
}

const BUSINESS_ACCEPT =
  "image/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,.doc,.docx,.txt";

async function readUpload(file: File, kind: "photo" | "business"): Promise<string> {
  const mime = inferredMime(file);
  if (kind === "photo" && !mime.startsWith("image/")) {
    throw new Error("Photo ID must be an image.");
  }
  if (kind === "business" && !businessMimeAllowed(mime)) {
    throw new Error("Business document must be an image, PDF, Word document, or text file.");
  }
  const data = await readFileAsDataUrl(file);
  if (file.type) return data;
  const payload = data.includes(",") ? data.slice(data.indexOf(",") + 1) : data;
  return `data:${mime};base64,${payload}`;
}

export default function AccessCodes() {
  const { user } = useAuth();
  const canInvite = String(user?.role ?? "").toLowerCase() === "administrator";

  const [tab, setTab] = useState<Tab>(canInvite ? "invite" : "place");
  const [rows, setRows] = useState<UniversalAccessRequestRow[]>([]);
  const [zones, setZones] = useState<UniversalAccessZone[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [detail, setDetail] = useState<UniversalAccessRequestRow | null>(null);
  const [editing, setEditing] = useState<UniversalAccessRequestRow | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [editPhoto, setEditPhoto] = useState("");
  const [editBusinessDoc, setEditBusinessDoc] = useState("");

  const [keyType, setKeyType] = useState<"private" | "public">("private");
  const [inviteeEmail, setInviteeEmail] = useState("");
  const [invitee, setInvitee] = useState<UniversalAccessInvitee | null>(null);
  const [inviteeMatches, setInviteeMatches] = useState<UniversalAccessInvitee[]>([]);
  const [lookingUp, setLookingUp] = useState(false);
  const [selectedZoneIds, setSelectedZoneIds] = useState<number[]>([]);
  const [inviteNote, setInviteNote] = useState("");
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [inviteReadyToRefresh, setInviteReadyToRefresh] = useState(false);

  const [networkQuery, setNetworkQuery] = useState("");
  const [target, setTarget] = useState<UniversalAccessTargetNetwork | null>(null);
  const [targetMatches, setTargetMatches] = useState<UniversalAccessTargetNetwork[]>([]);
  const [targetLookingUp, setTargetLookingUp] = useState(false);
  const [placeZoneIds, setPlaceZoneIds] = useState<number[]>([]);
  const [placeNote, setPlaceNote] = useState("");
  const [photo, setPhoto] = useState("");
  const [businessDoc, setBusinessDoc] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [inviteAwaitingReview, setInviteAwaitingReview] = useState(false);
  const [statusFilter, setStatusFilter] = useState<
    "all" | "pending" | "approved" | "rejected"
  >("all");

  const profile = useMemo(
    () => ({
      firstName: String(user?.first_name ?? ""),
      lastName: String(user?.last_name ?? ""),
      email: String(user?.email ?? ""),
      address: String(user?.address ?? ""),
    }),
    [user],
  );

  async function reload() {
    setLoading(true);
    setError(null);
    const [requestResult, zoneResult] = await Promise.all([
      listUniversalAccessRequests(),
      canInvite
        ? listShareableUniversalZones()
        : Promise.resolve({ data: [] as UniversalAccessZone[], error: null }),
    ]);
    if (requestResult.error) setError(requestResult.error);
    if (zoneResult.error) setError(zoneResult.error);
    setRows(requestResult.data ?? []);
    setZones(zoneResult.data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    void reload();
  }, [canInvite]);

  useEffect(() => {
    if (keyType === "public") {
      setInvitee(null);
      setInviteeEmail("");
      setInviteeMatches([]);
    }
  }, [keyType]);

  useEffect(() => {
    if (inviteReadyToRefresh) return;
    if (invitee && invitee.email === inviteeEmail.trim()) {
      setInviteeMatches([]);
      setLookingUp(false);
      return;
    }
    const query = inviteeEmail.trim();
    if (query.length < 2 || keyType !== "private") {
      setInviteeMatches([]);
      setLookingUp(false);
      return;
    }
    let cancelled = false;
    setLookingUp(true);
    const timer = window.setTimeout(() => {
      void searchUniversalAccessInvitees(query).then((result) => {
        if (cancelled) return;
        setLookingUp(false);
        const matches = Array.isArray(result.data) ? result.data.slice(0, 5) : [];
        setInviteeMatches(matches);
        if (result.error) setError(result.error);
      });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [invitee, inviteeEmail, keyType, inviteReadyToRefresh]);

  useEffect(() => {
    if (target && target.network_id === networkQuery.trim()) {
      setTargetMatches([]);
      setTargetLookingUp(false);
      return;
    }
    const query = networkQuery.trim();
    if (query.length < 2) {
      setTargetMatches([]);
      setTargetLookingUp(false);
      return;
    }
    let cancelled = false;
    setTargetLookingUp(true);
    const timer = window.setTimeout(() => {
      void searchUniversalAccessTargets(query).then((result) => {
        if (cancelled) return;
        setTargetLookingUp(false);
        setTargetMatches(Array.isArray(result.data) ? result.data : []);
        if (result.error) setError(result.error);
      });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [networkQuery, target]);

  const tabs: { key: Tab; label: string }[] = [
    ...(canInvite ? [{ key: "invite" as const, label: "Key Invitation" }] : []),
    { key: "place", label: "Request Key" },
    { key: "list", label: "Request List" },
  ];

  function toggleZone(id: number, current: number[], setter: (next: number[]) => void) {
    setter(current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function resetInviteForm() {
    setKeyType("private");
    setInvitee(null);
    setInviteeEmail("");
    setInviteeMatches([]);
    setSelectedZoneIds([]);
    setInviteNote("");
    setGeneratedCode(null);
    setInviteAwaitingReview(false);
    setInviteReadyToRefresh(false);
  }

  function resetPlaceForm() {
    setNetworkQuery("");
    setTarget(null);
    setTargetMatches([]);
    setPlaceZoneIds([]);
    setPlaceNote("");
    setPhoto("");
    setBusinessDoc("");
  }

  async function onSubmitInvite(event: FormEvent) {
    event.preventDefault();
    if (inviteReadyToRefresh) {
      resetInviteForm();
      return;
    }
    if (keyType === "private" && !invitee) {
      setError("Pick an invitee from the search results.");
      return;
    }
    if (selectedZoneIds.length === 0) {
      setError("Select at least one primary or communal zone.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const result = await createInviteUniversalAccessRequest({
      key_type: keyType,
      invitee_email: keyType === "private" ? invitee?.email : undefined,
      zone_ids: selectedZoneIds,
      note: inviteNote.trim(),
    });
    setSubmitting(false);
    if (result.error || !result.data) {
      setError(result.error || "Could not generate the access key.");
      return;
    }
    setGeneratedCode(result.data.code);
    setInviteAwaitingReview(result.data.status === "pending" && keyType === "private");
    setInviteReadyToRefresh(true);
    await reload();
  }

  async function onSubmitPlace(event: FormEvent) {
    event.preventDefault();
    if (!target) {
      setError("Select a network ID first.");
      return;
    }
    if (placeZoneIds.length === 0) {
      setError("Select at least one zone.");
      return;
    }
    if (!photo || !businessDoc) {
      setError("Photo ID and business document are required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const result = await createPlaceAccessUniversalRequest({
      network_id: target.network_id,
      zone_ids: placeZoneIds,
      photo_id: photo,
      business_document: businessDoc,
      note: placeNote.trim(),
    });
    setSubmitting(false);
    if (result.error || !result.data) {
      setError(result.error || "Could not submit the request.");
      return;
    }
    resetPlaceForm();
    setTab("list");
    await reload();
  }

  async function onApprove(row: UniversalAccessRequestRow) {
    setBusyId(row.id);
    const result = await approveUniversalAccessRequest(row.id);
    setBusyId(null);
    if (result.error) {
      setError(result.error);
      return;
    }
    setDetail(null);
    await reload();
  }

  async function onReject(row: UniversalAccessRequestRow) {
    setBusyId(row.id);
    const result = await rejectUniversalAccessRequest(row.id, rejectReason.trim());
    setBusyId(null);
    if (result.error) {
      setError(result.error);
      return;
    }
    setDetail(null);
    setRejectReason("");
    await reload();
  }

  async function onRemove(row: UniversalAccessRequestRow) {
    setBusyId(row.id);
    const result = await deleteUniversalAccessRequest(row.id);
    setBusyId(null);
    if (result.error) {
      setError(result.error);
      return;
    }
    setDetail(null);
    setEditing(null);
    await reload();
  }

  async function onSaveDocs() {
    if (!editing) return;
    if (!editPhoto || !editBusinessDoc) {
      setError("Photo ID and business document are required.");
      return;
    }
    setBusyId(editing.id);
    const result = await updateUniversalAccessDocs(editing.id, {
      photo_id: editPhoto,
      business_document: editBusinessDoc,
    });
    setBusyId(null);
    if (result.error) {
      setError(result.error);
      return;
    }
    setEditing(null);
    await reload();
  }

  async function openDetail(row: UniversalAccessRequestRow) {
    setRejectReason("");
    const result = await getUniversalAccessRequest(row.id);
    setDetail(result.data ?? row);
    if (result.error) setError(result.error);
  }

  async function openEdit(row: UniversalAccessRequestRow) {
    const result = await getUniversalAccessRequest(row.id);
    const full = result.data ?? row;
    setEditing(full);
    setEditPhoto(full.photo_id || "");
    setEditBusinessDoc(full.business_document || "");
    if (result.error) setError(result.error);
  }

  return (
    <section className="space-y-0">
      <div className="overflow-hidden rounded-lg border border-[#DCE6F2] bg-white shadow-sm">
        <header className="flex items-center gap-2 border-b border-[#DCE6F2] px-4 py-3 sm:px-6">
          <KeyRound className="h-4 w-4 text-[#2F80ED]" />
          <span className="text-xs font-bold uppercase tracking-[0.2em] text-[#0F2C5C]">
            Zone Management
          </span>
        </header>
        <div className="flex flex-wrap gap-4 border-b border-[#DCE6F2] px-4 sm:px-6">
          {tabs.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              className={`py-3 text-xs font-bold uppercase tracking-[0.15em] transition ${
                tab === item.key
                  ? "border-b-2 border-[#2F80ED] text-[#2F80ED]"
                  : "text-[#8694AC] hover:text-[#566784]"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="px-4 py-5 sm:px-6">
          {error ? (
            <p className="mb-4 rounded-md border border-[#E23B4E]/30 bg-[#FCE7EA] px-3 py-2 text-sm text-[#E23B4E]">
              {error}
            </p>
          ) : null}

          {canInvite && tab === "invite" ? (
            <form className="max-w-xl space-y-4" onSubmit={(event) => void onSubmitInvite(event)}>
              <p className="text-sm text-[#566784]">
                Generate a private or public universal access key for your primary or communal
                zones.
              </p>
              <fieldset className="flex gap-4">
                <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[#566784]">
                  Key type
                </legend>
                {(["private", "public"] as const).map((value) => (
                  <label key={value} className="flex items-center gap-2 text-sm text-[#0F2C5C]">
                    <input
                      type="radio"
                      name="keyType"
                      checked={keyType === value}
                      disabled={inviteReadyToRefresh}
                      onChange={() => setKeyType(value)}
                    />
                    {value === "private" ? "Private" : "Public"}
                  </label>
                ))}
              </fieldset>
              {keyType === "private" ? (
                <div className="relative block text-sm">
                  <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[#566784]">
                    Invitee email
                  </span>
                  <div
                    className={`flex min-h-11 items-center gap-2 rounded-xl border px-3 ${
                      invitee
                        ? "border-[#16A34A] bg-[rgba(22,163,74,0.06)]"
                        : inviteeMatches.length > 0
                          ? "border-[#2F80ED] bg-white shadow-[0_0_0_3px_rgba(47,128,237,0.12)]"
                          : "border-[#DCE6F2] bg-white"
                    }`}
                  >
                    {invitee ? (
                      <Check className="h-4 w-4 shrink-0 text-[#16A34A]" />
                    ) : (
                      <Search
                        className={`h-4 w-4 shrink-0 ${
                          inviteeMatches.length > 0 ? "text-[#2F80ED]" : "text-[#8694AC]"
                        }`}
                      />
                    )}
                    <input
                      type="email"
                      value={inviteeEmail}
                      disabled={inviteReadyToRefresh}
                      onChange={(event) => {
                        setInviteeEmail(event.target.value);
                        setInvitee(null);
                      }}
                      placeholder="Search other-network users…"
                      className="w-full bg-transparent py-2.5 text-sm text-[#0F2C5C] outline-none placeholder:text-[#8694AC] disabled:opacity-60"
                    />
                    {invitee ? (
                      <span className="shrink-0 text-[11px] font-bold text-[#16A34A]">
                        Selected
                      </span>
                    ) : null}
                  </div>
                  {lookingUp ? (
                    <p className="mt-1.5 text-xs text-[#8694AC]">Searching…</p>
                  ) : null}
                  {inviteeMatches.length > 0 ? (
                    <div className="absolute left-0 right-0 z-20 mt-1.5 overflow-hidden rounded-xl border border-[#DCE6F2] bg-white shadow-[0_12px_32px_rgba(15,44,92,0.14)]">
                      <div className="border-b border-[#DCE6F2] bg-[#F7FAFE] px-4 py-3">
                        <p className="text-[11px] font-semibold tracking-wide text-[#8694AC]">
                          {inviteeMatches.length} match
                          {inviteeMatches.length === 1 ? "" : "es"} · other networks
                        </p>
                      </div>
                      <ul className="max-h-52 overflow-auto">
                        {inviteeMatches.map((match) => (
                          <li key={match.id}>
                            <button
                              type="button"
                              className="block w-full border-b border-[#EDF2F8] px-4 py-3.5 text-left last:border-b-0 hover:bg-[#F7FAFE]"
                              onClick={() => {
                                setInvitee(match);
                                setInviteeEmail(match.email);
                                setInviteeMatches([]);
                              }}
                            >
                              <span className="block text-sm font-semibold text-[#0F2C5C]">
                                {match.email}
                              </span>
                              <span className="mt-1 block truncate text-xs text-[#8694AC]">
                                {[match.name, match.network_id]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}
              <fieldset className="space-y-2">
                <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[#566784]">
                  Zones to share
                </legend>
                {zones.map((zone) => (
                  <label key={zone.id} className="flex items-center gap-2 text-sm text-[#0F2C5C]">
                    <input
                      type="checkbox"
                      checked={selectedZoneIds.includes(zone.id)}
                      disabled={inviteReadyToRefresh}
                      onChange={() => toggleZone(zone.id, selectedZoneIds, setSelectedZoneIds)}
                    />
                    <span>
                      {zone.name}
                      <span className="ml-2 text-xs text-[#8694AC]">
                        {[
                          zone.zone_type,
                          zone.is_primary ? "primary" : null,
                          zone.communal ? "communal" : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>
              <textarea
                value={inviteNote}
                disabled={inviteReadyToRefresh}
                onChange={(event) => setInviteNote(event.target.value)}
                rows={3}
                placeholder="Note"
                className="w-full rounded-lg border border-[#DCE6F2] px-3 py-2 text-sm outline-none disabled:bg-[#F7FAFE]"
              />
              {generatedCode ? (
                <div className="rounded-md border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2">
                  <CopyableAccessKey code={generatedCode} />
                </div>
              ) : null}
              {inviteAwaitingReview ? (
                <p className="rounded-md border border-[#E0992A]/40 bg-[rgba(224,153,42,0.12)] px-3 py-2 text-sm text-[#9A6410]">
                  Sent for review. The selected user must accept before this key is added to their zones.
                </p>
              ) : null}
              <button
                type="submit"
                disabled={submitting}
                className="rounded-lg bg-[#2F80ED] px-5 py-2 text-sm font-bold text-white disabled:opacity-60"
              >
                {submitting
                  ? "Working…"
                  : inviteReadyToRefresh
                    ? "Refresh"
                    : "Generate"}
              </button>
            </form>
          ) : null}

          {tab === "place" ? (
            <form className="max-w-xl space-y-4" onSubmit={(event) => void onSubmitPlace(event)}>
              <p className="text-sm text-[#566784]">
                Request access to another network&apos;s zones. The network admin reviews your
                request.
              </p>
              <div className="relative block text-sm">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[#566784]">
                  Network ID
                </span>
                <div
                  className={`flex min-h-11 items-center gap-2 rounded-xl border px-3 ${
                    target
                      ? "border-[#16A34A] bg-[rgba(22,163,74,0.06)]"
                      : targetMatches.length > 0
                        ? "border-[#2F80ED] bg-white shadow-[0_0_0_3px_rgba(47,128,237,0.12)]"
                        : "border-[#DCE6F2] bg-white"
                  }`}
                >
                  {target ? (
                    <Check className="h-4 w-4 shrink-0 text-[#16A34A]" />
                  ) : (
                    <Search
                      className={`h-4 w-4 shrink-0 ${
                        targetMatches.length > 0 ? "text-[#2F80ED]" : "text-[#8694AC]"
                      }`}
                    />
                  )}
                  <input
                    value={networkQuery}
                    onChange={(event) => {
                      setNetworkQuery(event.target.value);
                      setTarget(null);
                      setPlaceZoneIds([]);
                    }}
                    placeholder="Search other networks…"
                    className="w-full bg-transparent py-2.5 text-sm text-[#0F2C5C] outline-none placeholder:text-[#8694AC]"
                  />
                  {target ? (
                    <span className="shrink-0 text-[11px] font-bold text-[#16A34A]">
                      Selected
                    </span>
                  ) : null}
                </div>
                {targetLookingUp ? (
                  <p className="mt-1.5 text-xs text-[#8694AC]">Searching…</p>
                ) : null}
                {targetMatches.length > 0 ? (
                  <div className="absolute left-0 right-0 z-20 mt-1.5 overflow-hidden rounded-xl border border-[#DCE6F2] bg-white shadow-[0_12px_32px_rgba(15,44,92,0.14)]">
                    <div className="border-b border-[#DCE6F2] bg-[#F7FAFE] px-4 py-3">
                      <p className="text-[11px] font-semibold tracking-wide text-[#8694AC]">
                        {targetMatches.length} match
                        {targetMatches.length === 1 ? "" : "es"} · other networks
                      </p>
                    </div>
                    <ul className="max-h-52 overflow-auto">
                      {targetMatches.map((match) => (
                        <li key={match.network_id}>
                          <button
                            type="button"
                            className="block w-full border-b border-[#EDF2F8] px-4 py-3.5 text-left last:border-b-0 hover:bg-[#F7FAFE]"
                            onClick={() => {
                              setTarget(match);
                              setNetworkQuery(match.network_id);
                              setTargetMatches([]);
                              setPlaceZoneIds([]);
                            }}
                          >
                            <span className="block text-sm font-semibold text-[#0F2C5C]">
                              {match.network_id}
                            </span>
                            <span className="mt-1 block truncate text-xs text-[#8694AC]">
                              {match.admin_name} · {match.admin_email}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
              <div className="block text-sm">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[#566784]">
                  Zone name
                </span>
                {!target ? (
                  <div className="rounded-xl border border-[#DCE6F2] bg-[#F7FAFE] px-4 py-3.5 text-xs text-[#8694AC]">
                    Select a network first to choose zones.
                  </div>
                ) : target.zones.length === 0 ? (
                  <div className="rounded-xl border border-[#DCE6F2] bg-[#F7FAFE] px-4 py-3.5 text-xs text-[#8694AC]">
                    No shareable zones on this network.
                  </div>
                ) : (
                  <div
                    className={`overflow-hidden rounded-xl border bg-white ${
                      placeZoneIds.length > 0 ? "border-[#2F80ED]" : "border-[#DCE6F2]"
                    }`}
                  >
                    <div className="border-b border-[#DCE6F2] bg-[#F7FAFE] px-4 py-3">
                      <p className="text-[11px] font-semibold tracking-wide text-[#8694AC]">
                        {placeZoneIds.length} selected · {target.zones.length} available
                      </p>
                    </div>
                    <ul>
                      {target.zones.map((zone) => {
                        const selected = placeZoneIds.includes(zone.id);
                        const meta = [
                          zone.zone_type,
                          zone.is_primary ? "primary" : null,
                          zone.communal ? "communal" : null,
                        ]
                          .filter(Boolean)
                          .join(" · ");
                        return (
                          <li key={zone.id}>
                            <button
                              type="button"
                              className={`flex w-full items-center gap-3 border-b border-[#EDF2F8] px-4 py-3.5 text-left last:border-b-0 hover:bg-[#F7FAFE] ${
                                selected ? "bg-[rgba(47,128,237,0.06)]" : "bg-white"
                              }`}
                              onClick={() =>
                                toggleZone(zone.id, placeZoneIds, setPlaceZoneIds)
                              }
                            >
                              <span
                                className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md border-[1.5px] ${
                                  selected
                                    ? "border-[#2F80ED] bg-[#2F80ED] text-white"
                                    : "border-[#DCE6F2] bg-white"
                                }`}
                              >
                                {selected ? <Check className="h-3 w-3" /> : null}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block text-sm font-semibold text-[#0F2C5C]">
                                  {zone.name}
                                </span>
                                {meta ? (
                                  <span className="mt-1 block truncate text-xs text-[#8694AC]">
                                    {meta}
                                  </span>
                                ) : null}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[#566784]">
                  Network admin email
                </span>
                <input
                  value={target?.admin_email ?? ""}
                  disabled
                  className="w-full rounded-lg border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2 text-sm outline-none"
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <input
                  value={profile.firstName}
                  disabled
                  placeholder="First name"
                  className="rounded-lg border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2 text-sm outline-none"
                />
                <input
                  value={profile.lastName}
                  disabled
                  placeholder="Last name"
                  className="rounded-lg border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2 text-sm outline-none"
                />
                <input
                  value={profile.email}
                  disabled
                  placeholder="Email"
                  className="rounded-lg border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2 text-sm outline-none"
                />
                <input
                  value={profile.address}
                  disabled
                  placeholder="Address"
                  className="rounded-lg border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2 text-sm outline-none"
                />
              </div>
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[#566784]">
                  Photo ID
                </span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    void readUpload(file, "photo").then(setPhoto).catch((err: Error) => {
                      setError(err.message);
                    });
                  }}
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[#566784]">
                  Business document
                </span>
                <input
                  type="file"
                  accept={BUSINESS_ACCEPT}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    void readUpload(file, "business")
                      .then(setBusinessDoc)
                      .catch((err: Error) => {
                        setError(err.message);
                      });
                  }}
                />
              </label>
              <textarea
                value={placeNote}
                onChange={(event) => setPlaceNote(event.target.value)}
                rows={3}
                placeholder="Note"
                className="w-full rounded-lg border border-[#DCE6F2] px-3 py-2 text-sm outline-none"
              />
              <button
                type="submit"
                disabled={submitting}
                className="rounded-lg bg-[#2F80ED] px-5 py-2 text-sm font-bold text-white disabled:opacity-60"
              >
                {submitting ? "Sending…" : "Send request"}
              </button>
            </form>
          ) : null}

          {tab === "list" ? (
            loading ? (
              <p className="text-sm text-[#8694AC]">Loading…</p>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="inline-flex items-center gap-2 text-xs font-semibold text-[#566784]">
                    Status
                    <select
                      value={statusFilter}
                      onChange={(event) =>
                        setStatusFilter(
                          event.target.value as "all" | "pending" | "approved" | "rejected",
                        )
                      }
                      className="rounded-lg border border-[#DCE6F2] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#0F2C5C] outline-none"
                    >
                      <option value="all">All</option>
                      <option value="pending">Pending</option>
                      <option value="approved">Approved</option>
                      <option value="rejected">Rejected</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() => void reload()}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#2F80ED] hover:underline"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Refresh
                  </button>
                </div>
                {rows
                  .filter((row) => statusFilter === "all" || row.status === statusFilter)
                  .map((row) => {
                  const actions = row.viewer_actions;
                  const showApproveReject = Boolean(
                    actions?.can_approve || actions?.can_reject,
                  );
                  const showSenderReview =
                    row.viewer_role === "requester" && row.status === "pending";
                  const showReview = showApproveReject || showSenderReview;
                  return (
                    <div
                      key={row.id}
                      className="rounded-lg border border-[#DCE6F2] px-3 py-3 text-sm text-[#0F2C5C]"
                    >
                      <div className="font-semibold">
                        {row.request_kind === "place_access" ? "Request Key" : "Key Invitation"}
                        {row.key_type ? (
                          <span className="ml-2 text-xs font-normal uppercase text-[#8694AC]">
                            {row.key_type}
                          </span>
                        ) : null}
                      </div>
                      <div className="text-[#8694AC]">
                        {row.created_at
                          ? formatServerDateTime(row.created_at)
                          : "—"}
                      </div>
                      <div className="font-semibold capitalize text-[#566784]">
                        {row.status}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-3">
                        {row.status === "approved" &&
                        row.credential_id != null &&
                        row.viewer_role === "owner" ? (
                          <button
                            type="button"
                            disabled={busyId === row.id}
                            onClick={() => {
                              void setUniversalAccessEnabled(
                                row.credential_id!,
                                !row.enabled,
                              ).then(() => reload());
                            }}
                            className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                              row.enabled
                                ? "border-[#E0992A] bg-[rgba(224,153,42,0.12)] text-[#9A6410]"
                                : "border-[#2FA24A] bg-[rgba(47,162,74,0.10)] text-[#1E7A36]"
                            }`}
                          >
                            {row.enabled ? "Turn off" : "Turn on"}
                          </button>
                        ) : null}
                        {showReview ? (
                          <button
                            type="button"
                            className="rounded-full border border-[#2F80ED] bg-[rgba(47,128,237,0.08)] px-3 py-1.5 text-xs font-semibold text-[#1B5BB5]"
                            onClick={() => void openDetail(row)}
                          >
                            Review
                          </button>
                        ) : null}
                        {actions?.can_edit_docs && row.status === "pending" ? (
                          <button
                            type="button"
                            className="rounded-full border border-[#E0992A] bg-[rgba(224,153,42,0.12)] px-3 py-1.5 text-xs font-semibold text-[#9A6410]"
                            onClick={() => void openEdit(row)}
                          >
                            Edit
                          </button>
                        ) : null}
                        {actions?.can_remove ? (
                          <button
                            type="button"
                            disabled={busyId === row.id}
                            className="rounded-full border border-[#E23B4E] bg-[#FCE7EA] px-3 py-1.5 text-xs font-semibold text-[#C4283A]"
                            onClick={() => void onRemove(row)}
                          >
                            Remove
                          </button>
                        ) : null}
                        {!showReview &&
                        !(actions?.can_edit_docs && row.status === "pending") ? (
                          <button
                            type="button"
                            className="rounded-full border border-[#C2D2E6] bg-[#F4F7FB] px-3 py-1.5 text-xs font-semibold text-[#566784]"
                            onClick={() => void openDetail(row)}
                          >
                            Detail
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
                {rows.filter((row) => statusFilter === "all" || row.status === statusFilter)
                  .length === 0 ? (
                  <p className="text-sm text-[#8694AC]">Nothing here yet.</p>
                ) : null}
              </div>
            )
          ) : null}
        </div>
      </div>

      {detail ? (
        <div className="mt-4 rounded-lg border border-[#DCE6F2] bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold text-[#0F2C5C]">
            {detail.request_kind === "place_access" ? "Request Key" : "Key Invitation"}
            {detail.key_type ? (
              <span className="ml-2 text-xs font-normal uppercase text-[#8694AC]">
                {detail.key_type}
              </span>
            ) : null}
          </h2>
          <p className="mt-1 text-sm font-semibold capitalize text-[#566784]">
            {detail.status}
            {detail.created_at
              ? ` · ${formatServerDateTime(detail.created_at)}`
              : ""}
          </p>
          {detail.request_kind === "invite" &&
          detail.key_type === "private" &&
          detail.email ? (
            <div className="mt-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[#566784]">
                Invited user
              </p>
              <p className="text-sm text-[#0F2C5C]">{detail.email}</p>
              {detail.member_name ? (
                <p className="text-xs text-[#8694AC]">{detail.member_name}</p>
              ) : null}
            </div>
          ) : null}
          <div className="mt-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[#566784]">
              Zones
            </p>
            <p className="text-sm text-[#0F2C5C]">
              {(detail.zones ?? []).map((zone) => zone.name).join(", ") ||
                detail.place ||
                "No zones"}
              {detail.network_id ? (
                <span className="text-[#8694AC]"> · {detail.network_id}</span>
              ) : null}
            </p>
          </div>
          {detail.request_kind === "place_access" ? (
            <>
              <div className="mt-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[#566784]">
                  Requester
                </p>
                <p className="text-sm text-[#0F2C5C]">
                  <span className="font-semibold">
                    {[detail.first_name, detail.last_name].filter(Boolean).join(" ") ||
                      detail.member_name ||
                      "—"}
                  </span>
                  {detail.email ? ` · ${detail.email}` : ""}
                </p>
                <p className="text-xs text-[#8694AC]">{detail.address || "No address"}</p>
              </div>
              {detail.note ? (
                <div className="mt-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[#566784]">
                    Note
                  </p>
                  <p className="text-sm text-[#0F2C5C]">{detail.note}</p>
                </div>
              ) : null}
              <ReviewDocument label="Photo ID" value={detail.photo_id} />
              <ReviewDocument label="Business document" value={detail.business_document} />
            </>
          ) : null}
          {detail.code ? (
            <div className="mt-3">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[#566784]">
                Access key
              </p>
              <CopyableAccessKey code={detail.code} label="" />
            </div>
          ) : null}
          {detail.reject_reason ? (
            <p className="mt-2 text-sm text-[#E23B4E]">{detail.reject_reason}</p>
          ) : null}
          {detail.viewer_actions?.can_approve || detail.viewer_actions?.can_reject ? (
            <div className="mt-4 flex flex-wrap items-end gap-3">
              <button
                type="button"
                disabled={busyId === detail.id}
                onClick={() => void onApprove(detail)}
                className="rounded-lg border border-[#2FA24A] bg-[#2FA24A] px-4 py-2 text-sm font-bold text-white"
              >
                Approve
              </button>
              <input
                value={rejectReason}
                onChange={(event) => setRejectReason(event.target.value)}
                placeholder="Reject reason (optional)"
                className="rounded-lg border border-[#DCE6F2] px-3 py-2 text-sm"
              />
              <button
                type="button"
                disabled={busyId === detail.id}
                onClick={() => void onReject(detail)}
                className="rounded-lg border border-[#E23B4E] bg-[#FCE7EA] px-4 py-2 text-sm font-bold text-[#C4283A]"
              >
                Reject
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="mt-4 text-sm font-semibold text-[#566784]"
              onClick={() => setDetail(null)}
            >
              Close
            </button>
          )}
        </div>
      ) : null}

      {editing ? (
        <div className="mt-4 rounded-lg border border-[#DCE6F2] bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold text-[#0F2C5C]">Edit documents</h2>
          <p className="mt-1 text-sm text-[#566784]">
            Only photo ID and business document can be changed while pending.
          </p>
          <div className="mt-4 space-y-3">
            <label className="block text-sm">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[#566784]">
                Photo ID
              </span>
              <input
                type="file"
                accept="image/*"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  void readUpload(file, "photo").then(setEditPhoto).catch((err: Error) => {
                    setError(err.message);
                  });
                }}
              />
              {editPhoto ? (
                <p className="mt-1 text-xs text-[#8694AC]">Photo selected</p>
              ) : null}
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[#566784]">
                Business document
              </span>
              <input
                type="file"
                accept={BUSINESS_ACCEPT}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  void readUpload(file, "business")
                    .then(setEditBusinessDoc)
                    .catch((err: Error) => {
                      setError(err.message);
                    });
                }}
              />
              {editBusinessDoc ? (
                <p className="mt-1 text-xs text-[#8694AC]">Document selected</p>
              ) : null}
            </label>
          </div>
          <div className="mt-4 flex gap-3">
            <button
              type="button"
              disabled={busyId === editing.id}
              onClick={() => void onSaveDocs()}
              className="rounded-lg bg-[#2F80ED] px-4 py-2 text-sm font-bold text-white"
            >
              Save
            </button>
            <button
              type="button"
              className="rounded-lg border border-[#DCE6F2] px-4 py-2 text-sm font-bold text-[#566784]"
              onClick={() => setEditing(null)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
