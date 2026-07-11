export type NormalizedAccountType =
  | "PRIVATE"
  | "EXCLUSIVE"
  | "PRIVATE_PLUS"
  | "ENHANCED"
  | "ENHANCED_PLUS";

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

/** Members allowed per account. `Infinity` means unbounded. */
export function getMemberLimit(type: NormalizedAccountType): number {
  if (type === "EXCLUSIVE") return 2;
  if (type === "ENHANCED") return 1;
  return Number.POSITIVE_INFINITY;
}

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

/** System administrator (Private tier) may edit the network ID in Settings. */
export function canEditNetworkId(params: {
  accountType?: string | null;
  legacyAccountType?: string | null;
}): boolean {
  return isSystemAdministrator({ ...params, role: "administrator" });
}

export const MEMBER_INVITE_UNAVAILABLE_HINT =
  "Member invite QR is available to administrators on Private, Private+, Exclusive, and Enhanced+ accounts. Enhanced accounts are solo and cannot invite members.";

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
      return "Private+";
    case "ENHANCED_PLUS":
      return "Enhanced+";
    case "EXCLUSIVE":
      return "Exclusive";
    case "ENHANCED":
      return "Enhanced";
    default:
      return "Private";
  }
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
    label: "Private+",
    description: "Family account — up to 10 devices",
  },
  {
    value: "EXCLUSIVE",
    apiValue: "exclusive",
    label: "Exclusive",
    description: "Solo account with one invited member",
  },
  {
    value: "ENHANCED",
    apiValue: "enhanced",
    label: "Enhanced",
    description: "Solo account — one device",
  },
  {
    value: "ENHANCED_PLUS",
    apiValue: "enhanced_plus",
    label: "Enhanced+",
    description: "Unlimited devices and members",
  },
];
