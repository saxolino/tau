import type { MyMessagePart } from '@taucad/chat';
import type { ChatActivityFacts, ChatActivityCue } from '#utils/chat-activity-cue.js';
import { selectChatActivityCue } from '#utils/chat-activity-cue.js';
import { isActivityPartActive } from '#utils/assistant-message-activity.js';
import type { Translate, PlainMessageKey } from '#i18n/translate.js';

/** Map real run/tool events to designer language. Never expose arguments, paths or raw reasoning. */
export function modellingActivity(
  facts: ChatActivityFacts & { readonly imageAttached?: boolean },
  t: Translate,
): ChatActivityCue | undefined {
  const cue = selectChatActivityCue({ ...facts, parts: [] });
  if (!cue) {
    return undefined;
  }
  let key: PlainMessageKey = 'agent.working';
  switch (facts.runState) {
    case 'reconnecting': {
      key = 'agent.reconnecting';
      break;
    }
    case 'approval': {
      key = 'agent.approval';
      break;
    }
    case 'question': {
      key = 'agent.question';
      break;
    }
    case 'queued': {
      key = 'agent.queued';
      break;
    }
    default: {
      const active =
        facts.chatStatus === 'submitted'
          ? undefined
          : facts.parts?.findLast(
              (part) => (part.type === 'dynamic-tool' || part.type.startsWith('tool-')) && isActivityPartActive(part),
            );
      key = active
        ? toolActivity(active)
        : facts.parts?.at(-1)?.type === 'text'
          ? 'agent.writing'
          : facts.imageAttached && !facts.parts?.length
            ? 'agent.looking'
            : 'agent.working';
    }
  }
  return { kind: cue.kind, sentence: t(key) };
}

const toolActivity = (part: MyMessagePart): PlainMessageKey => {
  const name = part.type === 'dynamic-tool' ? part.toolName : part.type.slice(5);
  if (/screenshot|capture/i.test(name)) {
    return 'agent.views';
  }
  if (/test_model|evaluate|get_kernel_result/i.test(name)) {
    return 'agent.checking';
  }
  const input: unknown = Reflect.get(part, 'input');
  const target: unknown = typeof input === 'object' && input !== null ? Reflect.get(input, 'targetFile') : undefined;
  if (
    /read.*image|image.*read|inspect.*image/i.test(name) ||
    (name === 'read_file' && typeof target === 'string' && /\.(png|jpe?g|webp|gif|avif)$/i.test(target))
  ) {
    return 'agent.looking';
  }
  if (/edit|parameter|delete/i.test(name)) {
    return 'agent.applying';
  }
  if (/create|build|render/i.test(name)) {
    return 'agent.building';
  }
  return 'agent.working';
};
