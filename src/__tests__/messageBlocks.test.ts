import { describe, expect, it } from "vitest";
import {
  blockedMemberIdsFromRules,
  filterMessagesForBlocks,
  isMessageHiddenByBlocks,
} from "../lib/messageBlocks";
import type { Message } from "../services/api/messages";
import type { MessageFeatureBlock } from "../services/api/messageFeature";

const baseMessage: Message = {
  id: "1",
  zone_id: "ZN-1",
  sender_id: 9,
  receiver_id: null,
  type: "SERVICE",
  category: "Alert",
  scope: "public",
  visibility: "public",
  message: "hello",
  created_at: "2026-01-01T00:00:00Z",
  raw_payload: null,
};

describe("messageBlocks", () => {
  it("hides messages from a blocked member", () => {
    const blocks: MessageFeatureBlock[] = [{ id: "1", blocked_owner_id: 9 }];
    expect(isMessageHiddenByBlocks(baseMessage, blocks)).toBe(true);
    expect(filterMessagesForBlocks([baseMessage], blocks)).toHaveLength(0);
  });

  it("excludes blocked members from picker set", () => {
    const blocks: MessageFeatureBlock[] = [{ id: "1", blocked_owner_id: 9 }];
    expect(blockedMemberIdsFromRules(blocks)).toEqual(new Set([9]));
  });

  it("does not hide other senders when one member is blocked", () => {
    const blocks: MessageFeatureBlock[] = [{ id: "1", blocked_owner_id: 9 }];
    const other = { ...baseMessage, sender_id: 10 };
    expect(isMessageHiddenByBlocks(other, blocks)).toBe(false);
  });
});
