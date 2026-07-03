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
