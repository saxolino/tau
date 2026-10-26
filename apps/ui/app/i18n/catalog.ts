import { agentMessages } from '#i18n/messages/agent.js';
import { measuresMessages } from '#i18n/messages/measures.js';
import { piecesMessages } from '#i18n/messages/pieces.js';
import { accountMessages } from '#i18n/messages/account.js';
import { authMessages } from '#i18n/messages/auth.js';
import { commonMessages } from '#i18n/messages/common.js';
import { convertMessages } from '#i18n/messages/convert.js';
import { importMessages } from '#i18n/messages/import.js';
import { homeMessages } from '#i18n/messages/home.js';
import { projectMessages } from '#i18n/messages/project.js';
import { shellMessages } from '#i18n/messages/shell.js';
import { toolsMessages } from '#i18n/messages/tools.js';
import { viewerMessages } from '#i18n/messages/viewer.js';
import { exportMessages } from '#i18n/messages/export.js';
import { versionsMessages } from '#i18n/messages/versions.js';
import { sinopiaImagesMessages } from '#i18n/messages/sinopia-images.js';
import { sinopiaSendMessages } from '#i18n/messages/sinopia-send.js';
import { sinopiaSyncMessages } from '#i18n/messages/sinopia-sync.js';
import { libraryMessages } from '#i18n/messages/library.js';
import { manualEditMessages } from '#i18n/messages/manual-edit.js';

/**
 * Every area's messages under its own namespace: `t('project.topBar.versions')`. One area per file in
 * `messages/`, so two people translating different areas never edit the same file.
 */
export const areas = {
  agent: agentMessages,
  measures: measuresMessages,
  pieces: piecesMessages,
  account: accountMessages,
  auth: authMessages,
  common: commonMessages,
  convert: convertMessages,
  import: importMessages,
  export: exportMessages,
  home: homeMessages,
  project: projectMessages,
  shell: shellMessages,
  tools: toolsMessages,
  viewer: viewerMessages,
  versions: versionsMessages,
  sinopiaImages: sinopiaImagesMessages,
  sinopiaSend: sinopiaSendMessages,
  sinopiaSync: sinopiaSyncMessages,
  manualEdit: manualEditMessages,
  library: libraryMessages,
} as const;

/** The Italian catalog, the source of every key. */
export type ItalianMessages = { readonly [Area in keyof typeof areas]: (typeof areas)[Area]['it'] };

const pick = <L extends 'it' | 'en'>(language: L): { readonly [Area in keyof typeof areas]: (typeof areas)[Area][L] } =>
  Object.fromEntries(Object.entries(areas).map(([area, messages]) => [area, messages[language]])) as {
    readonly [Area in keyof typeof areas]: (typeof areas)[Area][L];
  };

/** Both languages, area by area. */
export const catalog = { it: pick('it'), en: pick('en') } as const;
