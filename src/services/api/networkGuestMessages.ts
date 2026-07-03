import type {
  MessageFeaturePayload,
  MessageFeaturePropagationResponse,
  PrivateSearchMembersResponse,
} from "./messageFeature";
import { guestSessionAxios } from "./guestSession";
import { guestApiBasePath } from "./guestSession";

export async function propagateNetworkGuestMessage(
  payload: MessageFeaturePayload,
): Promise<{ data: MessageFeaturePropagationResponse | null; error: string | null }> {
  try {
    const res = await guestSessionAxios.post<unknown>(
      `${guestApiBasePath()}/messages/propagate`,
      payload,
    );
    const raw = res.data;
    const body =
      raw && typeof raw === "object" && "status" in raw && "data" in raw
        ? (raw as { data: unknown }).data
        : raw;
    if (!body || typeof body !== "object") {
      return { data: null, error: "Invalid response from server." };
    }
    return { data: body as MessageFeaturePropagationResponse, error: null };
  } catch (e: unknown) {
    const msg =
      e && typeof e === "object" && "response" in e
        ? String(
            (e as { response?: { data?: { message?: string; detail?: { message?: string } } } })
              .response?.data?.detail?.message ??
              (e as { response?: { data?: { message?: string } } }).response?.data?.message ??
              "Could not send alert.",
          )
        : "Could not send alert.";
    return { data: null, error: msg };
  }
}

export async function searchNetworkGuestPrivateRecipients(
  query: string,
  position?: { latitude: number; longitude: number },
): Promise<{ data: PrivateSearchMembersResponse | null; error: string | null }> {
  try {
    const res = await guestSessionAxios.get<PrivateSearchMembersResponse>(
      `${guestApiBasePath()}/messages/members/search`,
      {
        params: {
          q: query.trim(),
          ...(position
            ? { latitude: position.latitude, longitude: position.longitude }
            : {}),
        },
      },
    );
    return { data: res.data, error: null };
  } catch (e: unknown) {
    const msg =
      e && typeof e === "object" && "response" in e
        ? String(
            (e as { response?: { data?: { message?: string; detail?: { message?: string } } } })
              .response?.data?.detail?.message ??
              (e as { response?: { data?: { message?: string } } }).response?.data?.message ??
              "Could not search members.",
          )
        : "Could not search members.";
    return { data: null, error: msg };
  }
}
