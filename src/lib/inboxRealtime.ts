import type { MessageFeaturePropagationResponse } from "../services/api/messageFeature";

/** Custom event: geo propagate API returned — update Messages inbox without waiting for poll. */
export const GEO_PROPAGATION_INBOX_EVENT = "hexzone:geo-propagation-inbox";

export type GeoPropagationInboxDetail = {
  propagation: MessageFeaturePropagationResponse;
};

export function dispatchGeoPropagationInbox(
  propagation: MessageFeaturePropagationResponse,
): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<GeoPropagationInboxDetail>(GEO_PROPAGATION_INBOX_EVENT, {
      detail: { propagation },
    }),
  );
}
