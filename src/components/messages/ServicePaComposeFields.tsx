import type { MessageType } from "../../lib/messageTypes";
import {
  SERVICE_PA_TOPICS,
  getTopicOption,
  isServicePaMessageType,
  serviceTopicRequiresSubtopic,
  type ServicePaComposeFields,
} from "../../lib/servicePaTopics";

type Props = {
  type: MessageType;
  fields: ServicePaComposeFields;
  onChange: (fields: ServicePaComposeFields) => void;
};

export function ServicePaComposeFieldsPanel({ type, fields, onChange }: Props) {
  if (!isServicePaMessageType(type)) return null;

  const selectedTopic = getTopicOption(fields.topic);
  const showSubtopic = serviceTopicRequiresSubtopic(type, fields.topic);

  return (
    <div className="space-y-3 rounded-lg border border-[#DCE6F2] bg-[#F7FAFE] p-3">
      <p className="text-xs font-semibold text-[#0F2C5C]">
        {type === "SERVICE" ? "Service listing" : "Public announcement"}
      </p>
      <div>
        <label className="mb-1 block text-xs font-medium text-[#566784]">
          Subject
        </label>
        <input
          type="text"
          value={fields.subject}
          onChange={(e) => onChange({ ...fields, subject: e.target.value })}
          placeholder="Short headline for this post"
          maxLength={200}
          className="w-full rounded-lg border border-[#DCE6F2] bg-white px-3 py-2.5 text-sm text-[#0F2C5C] outline-none focus:border-[#2F80ED]"
        />
      </div>
      {type === "SERVICE" ? (
        <>
          <div>
            <label className="mb-1 block text-xs font-medium text-[#566784]">
              Topic
            </label>
            <select
              value={fields.topic}
              onChange={(e) =>
                onChange({ ...fields, topic: e.target.value, subtopic: "" })
              }
              className="w-full rounded-lg border border-[#DCE6F2] bg-white px-3 py-2.5 text-sm text-[#0F2C5C] outline-none focus:border-[#2F80ED]"
            >
              <option value="">Select a topic</option>
              {SERVICE_PA_TOPICS.map((topic) => (
                <option key={topic.id} value={topic.id}>
                  {topic.label}
                </option>
              ))}
            </select>
          </div>
          {showSubtopic ? (
            <div>
              <label className="mb-1 block text-xs font-medium text-[#566784]">
                Products subtopic
              </label>
              <select
                value={fields.subtopic}
                onChange={(e) => onChange({ ...fields, subtopic: e.target.value })}
                className="w-full rounded-lg border border-[#DCE6F2] bg-white px-3 py-2.5 text-sm text-[#0F2C5C] outline-none focus:border-[#2F80ED]"
              >
                <option value="">Select a products category</option>
                {(selectedTopic?.subtopics ?? []).map((subtopic) => (
                  <option key={subtopic.id} value={subtopic.id}>
                    {subtopic.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
