export type NormalizedAccountType =
  | "PRIVATE"
  | "EXCLUSIVE"
  | "PRIVATE_PLUS"
  | "ENHANCED"
  | "ENHANCED_PLUS";

/** Organization (enhanced_plus) total-user caps by level. */
export const ENHANCED_PLUS_MEMBER_LIMITS: Record<number, number> = {
  1: 20,
  2: 50,
  3: 100,
  4: 500,
  5: 2500,
};

export const FAMILY_MEMBER_LIMIT = 10;

export function normalizeAccountType(
  accountType?: string | null,
  legacyAccountType?: string | null,
): NormalizedAccountType {
  const upper = String(accountType ?? legacyAccountType ?? "")
    .trim()
    .toUpperCase();
  if (upper === "EXCLUSIVE") return "EXCLUSIVE";
  if (upper === "PRIVATE_PLUS" || upper === "PRIVATE+" || upper === "PRIVATEPLUS") {
    return "PRIVATE_PLUS";
  }
  if (upper === "ENHANCED") return "ENHANCED";
  if (
    upper === "ENHANCED_PLUS" ||
    upper === "ENHANCED+" ||
    upper === "ENHANCEDPLUS" ||
    upper === "ENHANCE_PLUS" ||
    upper === "ENHANCE+"
  ) {
    return "ENHANCED_PLUS";
  }
  return "PRIVATE";
}

export function normalizeTierLevel(tierLevel?: number | string | null): number | null {
  if (tierLevel == null || tierLevel === "") return null;
  const n = typeof tierLevel === "number" ? tierLevel : Number(tierLevel);
  if (!Number.isFinite(n)) return null;
  const level = Math.trunc(n);
  return level in ENHANCED_PLUS_MEMBER_LIMITS ? level : null;
}

/**
 * Total members allowed per account (admin + invited).
 * `Infinity` means unbounded (Private / system admin).
 */
export function getMemberLimit(
  type: NormalizedAccountType,
  tierLevel?: number | string | null,
): number {
  if (type === "EXCLUSIVE" || type === "ENHANCED") return 1;
  if (type === "PRIVATE_PLUS") return FAMILY_MEMBER_LIMIT;
  if (type === "ENHANCED_PLUS") {
    const level = normalizeTierLevel(tierLevel) ?? 1;
    return ENHANCED_PLUS_MEMBER_LIMITS[level] ?? ENHANCED_PLUS_MEMBER_LIMITS[1];
  }
  return Number.POSITIVE_INFINITY;
}

/** Individual accounts may create this many secondary zones (never primary). */
export function getSecondaryZoneLimit(type: NormalizedAccountType): number {
  if (type === "EXCLUSIVE") return 3;
  return Number.POSITIVE_INFINITY;
}

/**
 * Invited Individual (invited by Family/Organization account holder):
 * secondary zones follow the member workflow (typically up to 2).
 * Solo Individual (self sign-up or system-admin invite): use getSecondaryZoneLimit (3).
 */
export const INVITED_MEMBER_SECONDARY_ZONE_LIMIT = 2;

/** Whether administrators of this tier may generate member-invite QR codes. */
export function accountSupportsMemberInvite(type: NormalizedAccountType): boolean {
  return getMemberLimit(type) > 1;
}

export function canAdministratorInviteUserMember(params: {
  role?: string | null;
  accountType?: string | null;
  legacyAccountType?: string | null;
}): boolean {
  if (String(params.role ?? "").toLowerCase() !== "administrator") return false;
  return accountSupportsMemberInvite(
    normalizeAccountType(params.accountType, params.legacyAccountType),
  );
}

/** System administrator (Private tier) may edit the network ID in Settings. */
export function isSystemAdministrator(params: {
  accountType?: string | null;
  legacyAccountType?: string | null;
  role?: string | null;
}): boolean {
  if (String(params.role ?? "").toLowerCase() !== "administrator") return false;
  return normalizeAccountType(params.accountType, params.legacyAccountType) === "PRIVATE";
}

/** Bulk / multi invite QR generation is system-admin only. Network admins mint one at a time. */
export function canBulkGenerateMemberInviteQr(params: {
  accountType?: string | null;
  legacyAccountType?: string | null;
  role?: string | null;
}): boolean {
  return isSystemAdministrator(params);
}

/** Excel/QR workbook download is system-admin only. */
export function canDownloadMemberInviteQr(params: {
  accountType?: string | null;
  legacyAccountType?: string | null;
  role?: string | null;
}): boolean {
  return isSystemAdministrator(params);
}

/** System administrator (Private tier) may edit the network ID in Settings. */
export function canEditNetworkId(params: {
  accountType?: string | null;
  legacyAccountType?: string | null;
}): boolean {
  return isSystemAdministrator({ ...params, role: "administrator" });
}

export const MEMBER_INVITE_UNAVAILABLE_HINT =
  "Member invite QR is available to administrators on Private, Family, and Organization accounts. Individual and Individual Pro accounts are solo and cannot invite members. Use Guest access to invite visitors.";

export function memberInviteUnavailableHint(
  type: NormalizedAccountType,
): string {
  if (type === "EXCLUSIVE") {
    return "Individual accounts are user-role only and cannot invite members. Use Guest access to invite visitors.";
  }
  if (type === "ENHANCED") {
    return "Individual Pro accounts are solo and cannot invite members. Use Guest access to invite visitors.";
  }
  return MEMBER_INVITE_UNAVAILABLE_HINT;
}

/** Geo types network-shared on Private+ (family) accounts. */
export const PRIVATE_PLUS_NETWORK_SHARED_MESSAGE_TYPES = [
  "PANIC",
  "NS_PANIC",
  "PA",
  "SERVICE",
] as const;

export function accountTypeLabel(type: NormalizedAccountType): string {
  switch (type) {
    case "PRIVATE_PLUS":
      return "Family";
    case "ENHANCED_PLUS":
      return "Organization";
    case "EXCLUSIVE":
      return "Individual";
    case "ENHANCED":
      return "Individual Pro";
    default:
      return "Private";
  }
}

export function formatLimit(used: number, limit: number): string {
  if (!Number.isFinite(limit)) return `${used} / ∞`;
  return `${used} / ${limit}`;
}

export function memberLimitDescription(
  type: NormalizedAccountType,
  tierLevel?: number | string | null,
): string {
  const limit = getMemberLimit(type, tierLevel);
  if (type === "PRIVATE_PLUS") {
    return "Family accounts allow up to 10 users (administrator + members).";
  }
  if (type === "ENHANCED_PLUS") {
    const level = normalizeTierLevel(tierLevel) ?? 1;
    return `Organization Level ${level} allows up to ${limit} users (administrator + members).`;
  }
  if (!Number.isFinite(limit)) {
    return "Private accounts have no member invite cap.";
  }
  if (limit <= 1) {
    return `${accountTypeLabel(type)} accounts are solo and cannot invite members.`;
  }
  return `${accountTypeLabel(type)} accounts allow up to ${limit} users.`;
}

export const ADMIN_ASSIGNABLE_ACCOUNT_TYPES: {
  value: NormalizedAccountType;
  apiValue: string;
  label: string;
  description: string;
}[] = [
  {
    value: "PRIVATE",
    apiValue: "private",
    label: "Private",
    description: "System administrator — platform-wide access",
  },
  {
    value: "PRIVATE_PLUS",
    apiValue: "private_plus",
    label: "Family",
    description: "Family account — up to 10 users",
  },
  {
    value: "EXCLUSIVE",
    apiValue: "exclusive",
    label: "Individual",
    description: "Solo account — no member invites",
  },
  {
    value: "ENHANCED",
    apiValue: "enhanced",
    label: "Individual Pro",
    description: "Solo account — one device",
  },
  {
    value: "ENHANCED_PLUS",
    apiValue: "enhanced_plus",
    label: "Organization",
    description: "Organization — user capacity by level (20–2500)",
  },
];
