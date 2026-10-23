import { describe, expect, it } from 'vitest';
import type { MyMessagePart } from '@taucad/chat';
import { bindTranslate } from '#i18n/translate.js';
import { modellingActivity } from '#utils/modelling-activity.js';
import { isDesignerMessagePart } from '#utils/designer-message-part.js';
const tool = (toolName: string): MyMessagePart => ({
  type: 'dynamic-tool',
  toolName,
  toolCallId: 'call',
  state: 'input-available',
  input: { path: 'secret.scad' },
});

describe('modelling activity', () => {
  it('should name the image attached to an admitted first request without invented view counts', () => {
    expect(
      modellingActivity({ runState: 'working', chatStatus: 'submitted', imageAttached: true }, bindTranslate('it'))
        ?.sentence,
    ).toBe('Guardo l’immagine…');
  });
  it.each([
    ['screenshot', 'Controllo le viste…', 'Checking the views…'],
    ['get_kernel_result', 'Controllo il modello…', 'Checking the model…'],
    ['edit_file', 'Applico la modifica…', 'Applying the change…'],
    ['create_file', 'Costruisco il modello…', 'Building the model…'],
    ['read_image', 'Guardo l’immagine…', 'Looking at the image…'],
    ['unrecognized', 'Lavoro al modello…', 'Working on the model…'],
  ])('should describe %s in both languages without tool arguments', (name, italian, english) => {
    const facts = { runState: 'tool', chatStatus: 'streaming', parts: [tool(name)] } as const;
    expect(modellingActivity(facts, bindTranslate('it'))?.sentence).toBe(italian);
    expect(modellingActivity(facts, bindTranslate('en'))?.sentence).toBe(english);
  });
  it.each(['done', 'failed', 'stopped'] as const)('should remove activity when the host is %s', (runState) => {
    expect(
      modellingActivity({ runState, chatStatus: 'ready', parts: [tool('edit_file')] }, bindTranslate('it')),
    ).toBeUndefined();
  });
  it('should keep approvals and reconnecting honest', () => {
    expect(modellingActivity({ runState: 'approval', chatStatus: 'streaming' }, bindTranslate('it'))).toEqual({
      kind: 'waiting',
      sentence: 'Aspetto la tua conferma',
    });
    expect(
      modellingActivity({ runState: 'reconnecting', chatStatus: 'streaming' }, bindTranslate('en'))?.sentence,
    ).toBe('Reconnecting…');
  });
});
describe('designer transcript', () => {
  it('should hide routine tools and reasoning while preserving answers and questions', () => {
    const parts: MyMessagePart[] = [
      tool('edit_file'),
      tool('read_file'),
      tool('run_command'),
      tool('get_kernel_result'),
      { type: 'reasoning', text: 'secret', state: 'done' },
      { type: 'text', text: 'Done', state: 'done' },
      tool('ask_questions'),
    ];
    expect(parts.filter((part) => isDesignerMessagePart(part))).toEqual([parts[5], parts[6]]);
  });
});
