import { accountMessages } from '#i18n/messages/account.js';
import { authMessages } from '#i18n/messages/auth.js';
import { commonMessages } from '#i18n/messages/common.js';
import { homeMessages } from '#i18n/messages/home.js';
import { projectMessages } from '#i18n/messages/project.js';
import { shellMessages } from '#i18n/messages/shell.js';
import { viewerMessages } from '#i18n/messages/viewer.js';
import { exportMessages } from '#i18n/messages/export.js';

/**
 * Every area's messages under its own namespace: `t('project.topBar.versions')`. One area per file in
 * `messages/`, so two people translating different areas never edit the same file.
 */
export const areas = {
  account: accountMessages,
  auth: authMessages,
  common: commonMessages,
  export: exportMessages,
  home: homeMessages,
  project: projectMessages,
  shell: shellMessages,
  viewer: viewerMessages,
} as const;

/** The Italian catalog, the source of every key. */
export type ItalianMessages = { readonly [Area in keyof typeof areas]: (typeof areas)[Area]['it'] };

const pick = <L extends 'it' | 'en'>(language: L): { readonly [Area in keyof typeof areas]: (typeof areas)[Area][L] } =>
  Object.fromEntries(Object.entries(areas).map(([area, messages]) => [area, messages[language]])) as {
    readonly [Area in keyof typeof areas]: (typeof areas)[Area][L];
  };

/** Both languages, area by area. */
export const catalog = { it: pick('it'), en: pick('en') } as const;
