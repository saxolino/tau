import { idPrefix } from '@taucad/types/constants';
import { translate } from '#i18n/translate.js';
import { getLanguage } from '#i18n/language.js';
import type { WorkspaceDirectoryRequiredCode } from '#filesystem/workspace-errors.js';
import type { ProjectCreationLocation } from '#types/project-creation-location.types.js';
import { isDesktopTarget } from '#lib/build-target.js';

export type ProjectLocationDisplay =
  | { readonly kind: 'home' }
  | { readonly kind: 'workspace'; readonly workspaceName?: string }
  | { readonly kind: 'temporary' };

export type ProjectLocationDescriptor = {
  readonly label: string;
  readonly detail: string;
};

export const parseProjectCreationLocation = (value: unknown): ProjectCreationLocation | undefined => {
  if (typeof value !== 'object' || value === null || !('kind' in value)) {
    return undefined;
  }
  if (value.kind === 'home') {
    return { kind: 'home' };
  }
  if (
    value.kind === 'workspace' &&
    'workspaceId' in value &&
    typeof value.workspaceId === 'string' &&
    value.workspaceId.startsWith(`${idPrefix.workspace}_`)
  ) {
    return { kind: 'workspace', workspaceId: value.workspaceId };
  }
  return undefined;
};

export const projectCreationLocationsEqual = (left: ProjectCreationLocation, right: ProjectCreationLocation): boolean =>
  left.kind === right.kind && (left.kind === 'home' || left.workspaceId === (right as typeof left).workspaceId);

export const projectLocationDescriptor = (location: ProjectLocationDisplay): ProjectLocationDescriptor => {
  if (location.kind === 'workspace') {
    return {
      label: location.workspaceName ?? translate(getLanguage(), 'library.locationConnected'),
      detail: translate(getLanguage(), 'library.locationOnDisk'),
    };
  }
  if (location.kind === 'temporary') {
    return {
      label: translate(getLanguage(), 'library.locationTemporary'),
      detail: translate(getLanguage(), 'library.locationTemporaryDetail'),
    };
  }
  /* Desktop's Home is a folder in Tau's app data; the web's lives in browser storage. */
  return {
    label: translate(getLanguage(), 'library.locationHome'),
    detail: translate(getLanguage(), isDesktopTarget() ? 'library.locationOnComputer' : 'library.locationInBrowser'),
  };
};

export const projectLocationFullLabel = (descriptor: ProjectLocationDescriptor): string =>
  `${descriptor.label} ${descriptor.detail}`;

export const projectCreationLocationAccessibleName = (descriptor: ProjectLocationDescriptor): string =>
  translate(getLanguage(), 'library.createIn', { location: descriptor.label });

export const projectCreationLocationErrorCopy = (
  code: WorkspaceDirectoryRequiredCode,
): { readonly message: string; readonly actionLabel?: string } => {
  switch (code) {
    case 'permission': {
      return { message: 'Access to this folder is required before creating the project.', actionLabel: 'Grant access' };
    }
    case 'missing':
    case 'disconnected': {
      return {
        message: 'This project location is no longer connected.',
        actionLabel: 'Manage locations',
      };
    }
    case 'unsupported': {
      return { message: 'Home is the only project location available in this browser.' };
    }
  }
};
