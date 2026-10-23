import type { MyMessagePart } from '@taucad/chat';
import { toolName } from '@taucad/chat/constants';
import { agentApprovalToolName } from '#services/agent-host-event-projection.js';

/** Decisions stay actionable; implementation details never enter the designer transcript. */
export const isDesignerMessagePart = (part: MyMessagePart): boolean =>
  part.type === 'text' ||
  part.type === 'file' ||
  part.type === 'source-url' ||
  part.type === 'source-document' ||
  part.type === `tool-${toolName.askQuestions}` ||
  (part.type === 'dynamic-tool' && (part.toolName === agentApprovalToolName || /ask.*question/i.test(part.toolName)));
