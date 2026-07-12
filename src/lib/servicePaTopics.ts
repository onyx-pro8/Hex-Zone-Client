import type { MessageType } from "./messageTypes";

export type SubtopicOption = {
  id: string;
  label: string;
};

export type TopicOption = {
  id: string;
  label: string;
  subtopics?: SubtopicOption[];
};

/** Kijiji-style categories shared by PA and SERVICE compose flows. */
export const SERVICE_PA_TOPICS: TopicOption[] = [
  { id: "skilled_trades", label: "Skilled Trades" },
  { id: "childcare", label: "Childcare" },
  { id: "cleaning", label: "Cleaning" },
  { id: "beauty", label: "Beauty" },
  { id: "fitness", label: "Fitness" },
  { id: "tutors", label: "Tutors" },
  {
    id: "products",
    label: "Products",
    subtopics: [
      { id: "fruits", label: "Fruits" },
      { id: "vegetable", label: "Vegetable" },
      { id: "poultry_meat", label: "Poultry Meat" },
      { id: "seafood", label: "Seafood" },
      { id: "others", label: "Others" },
    ],
  },
  { id: "health_lifestyle", label: "Health & Lifestyle" },
  { id: "entertainment", label: "Entertainment" },
  { id: "others", label: "Others" },
];

export function isServicePaMessageType(type: MessageType): boolean {
  return type === "PA" || type === "SERVICE";
}

export function serviceTopicRequiresSubtopic(
  type: MessageType,
  topicId: string,
): boolean {
  return type === "SERVICE" && topicId === "products";
}

export function getTopicOption(topicId: string): TopicOption | undefined {
  return SERVICE_PA_TOPICS.find((topic) => topic.id === topicId);
}

export function getTopicLabel(topicId: string): string | undefined {
  return getTopicOption(topicId)?.label;
}

export function getSubtopicLabel(
  topicId: string,
  subtopicId: string,
): string | undefined {
  return getTopicOption(topicId)?.subtopics?.find((row) => row.id === subtopicId)
    ?.label;
}

export function formatTopicPath(
  topicId?: string | null,
  subtopicId?: string | null,
): string | null {
  if (!topicId) return null;
  const topic = getTopicLabel(topicId);
  if (!topic) return null;
  const subtopic = subtopicId ? getSubtopicLabel(topicId, subtopicId) : null;
  return subtopic ? `${topic} · ${subtopic}` : topic;
}

export type ServicePaComposeFields = {
  subject: string;
  topic: string;
  subtopic: string;
};

export function validateServicePaCompose(
  type: MessageType,
  fields: ServicePaComposeFields,
  body: string,
): string | null {
  if (!isServicePaMessageType(type)) return null;
  if (!fields.subject.trim()) return "Subject is required for PA and SERVICE messages.";
  if (type === "SERVICE") {
    if (!fields.topic) return "Topic is required for SERVICE messages.";
    if (serviceTopicRequiresSubtopic(type, fields.topic) && !fields.subtopic) {
      return "Subtopic is required for SERVICE Products messages.";
    }
  }
  if (!body.trim()) return "Message body is required.";
  return null;
}

export function buildServicePaMsgPayload(
  fields: ServicePaComposeFields,
  description: string,
  extras: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    subject: fields.subject.trim(),
    ...(fields.topic ? { topic: fields.topic } : {}),
    ...(fields.subtopic ? { subtopic: fields.subtopic } : {}),
    description: description.trim(),
    ...extras,
  };
}

export function extractServicePaFields(
  source: Record<string, unknown> | null | undefined,
): {
  subject: string | null;
  topic: string | null;
  subtopic: string | null;
  description: string | null;
} {
  if (!source) {
    return { subject: null, topic: null, subtopic: null, description: null };
  }
  const subject =
    typeof source.subject === "string" && source.subject.trim()
      ? source.subject.trim()
      : null;
  const topic =
    typeof source.topic === "string" && source.topic.trim()
      ? source.topic.trim()
      : null;
  const subtopic =
    typeof source.subtopic === "string" && source.subtopic.trim()
      ? source.subtopic.trim()
      : null;
  const description =
    typeof source.description === "string" && source.description.trim()
      ? source.description.trim()
      : typeof source.text === "string" && source.text.trim()
        ? source.text.trim()
        : null;
  return { subject, topic, subtopic, description };
}
