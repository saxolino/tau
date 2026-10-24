import { formatConfigurations } from '@taucad/types/constants';
import type { FileExtension } from '@taucad/types';
import { getFileExtension } from '#utils/filesystem.utils.js';
import type { ConverterExportFormat, ConverterImportFormat } from '@taucad/converter/runtime';
import type { Language } from '#i18n/language.js';
import { formatNumber } from '#i18n/translate.js';

/**
 * Extract file format from filename extension
 */
export function getFormatFromFilename(filename: string): ConverterImportFormat {
  const extension = getFileExtension(filename);

  if (!extension) {
    throw new Error('File has no extension');
  }

  return extension as ConverterImportFormat;
}

/** Whether a runtime capability has user-facing converter metadata. */
export const isConfiguredConverterFormat = (format: string): format is FileExtension =>
  Object.hasOwn(formatConfigurations, format);

/**
 * Get human-readable display name for format
 */
export function formatDisplayName(format: FileExtension): string {
  return formatConfigurations[format].name;
}

/**
 * Format file size in human-readable format. Given a language, the number is written the way it writes numbers
 * (IT `2,5 MB`, EN `2.5 MB`) and bytes are `B`, the same in both.
 */
export function formatFileSize(bytes: number, language?: Language): string {
  const sizes = language === undefined ? ['Bytes', 'KB', 'MB', 'GB'] : ['B', 'KB', 'MB', 'GB'];
  if (bytes === 0) {
    return `0 ${sizes[0]}`;
  }

  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = Number.parseFloat((bytes / k ** i).toFixed(2));

  return `${language === undefined ? value : formatNumber(value, language, { maximumFractionDigits: 2 })} ${sizes[i]}`;
}

/**
 * Get file extension for output format
 */
export function getExtensionForFormat(format: ConverterExportFormat): string {
  return format;
}
