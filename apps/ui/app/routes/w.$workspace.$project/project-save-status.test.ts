import { describe, expect, it } from 'vitest';
import type { RevisionStatusProjection } from '@taucad/revisions';
import { bindTranslate } from '#i18n/translate.js';
import type { Translate } from '#i18n/translate.js';
import type { Language } from '#i18n/language.js';
import { saveStatusSentence, selectSaveStatus } from '#routes/w.$workspace.$project/project-save-status.js';
import type { RevisionWhere } from '#routes/w.$workspace.$project/revision-vocabulary.js';
import type { RevisionCard } from '#hooks/use-revisions.js';

const status = (patch: Partial<Record<string, unknown>> = {}): RevisionStatusProjection =>
  ({
    attention: 0,
    conflicts: [],
    minting: false,
    restore: { busy: false },
    sync: { state: 'idle' },
    ...patch,
  }) as unknown as RevisionStatusProjection;

const where = (patch: Partial<RevisionWhere> = {}): RevisionWhere => ({
  branch: 'main',
  head: 3,
  isDirty: false,
  isLoading: false,
  role: 'owner',
  isSignedOut: true,
  ...patch,
});

const t = (language: Language): Translate => bindTranslate(language);

const at = new Date(2026, 9, 23, 14, 2).getTime();

describe('selectSaveStatus', () => {
  it('should read loading before the project answers', () => {
    expect(selectSaveStatus(undefined, where(), undefined)).toEqual({ kind: 'loading' });
  });

  it('should put a save that needs the person first, then a conflict', () => {
    expect(selectSaveStatus(status({ attention: 1 }), where(), undefined).kind).toBe('failed');
    expect(selectSaveStatus(status({ attention: 1, conflicts: [{}] }), where(), undefined).kind).toBe('conflict');
    expect(selectSaveStatus(status({ sync: { state: 'conflicted' } }), where(), undefined).kind).toBe('conflict');
  });

  it('should say saving and going back while they run', () => {
    expect(selectSaveStatus(status({ minting: true }), where(), undefined).kind).toBe('saving');
    expect(selectSaveStatus(status({ restore: { busy: true } }), where(), undefined).kind).toBe('restoring');
  });

  it('should say what the files are at rest', () => {
    expect(selectSaveStatus(status(), where({ isDirty: true }), undefined).kind).toBe('unsaved');
    expect(selectSaveStatus(status(), where({ head: undefined }), undefined).kind).toBe('notSaved');
    expect(selectSaveStatus(status(), where(), { createdAt: at } as unknown as RevisionCard)).toEqual({
      kind: 'saved',
      at,
    });
  });
});

describe('saveStatusSentence', () => {
  it.each([
    {
      language: 'it',
      saved: 'Salvato su questo computer · 14:02',
      saving: 'Salvo…',
      conflict: 'Conflitto: quale tieni?',
    },
    {
      language: 'en',
      saved: 'Saved on this computer · 2:02 PM',
      saving: 'Saving…',
      conflict: 'Conflict: which one do you keep?',
    },
  ] as const)('should write each state in $language', ({ language, saved, saving, conflict }) => {
    expect(saveStatusSentence({ kind: 'saved', at }, t(language), language)).toBe(saved);
    expect(saveStatusSentence({ kind: 'saving' }, t(language), language)).toBe(saving);
    expect(saveStatusSentence({ kind: 'conflict' }, t(language), language)).toBe(conflict);
  });

  it('should never name a branch, a backup or Git', () => {
    for (const language of ['it', 'en'] as const) {
      for (const kind of ['loading', 'saving', 'restoring', 'failed', 'conflict', 'unsaved', 'notSaved'] as const) {
        expect(saveStatusSentence({ kind }, t(language), language)).not.toMatch(/main|branch|ramo|backup|git/iu);
      }
    }
  });
});
