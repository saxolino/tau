import { websiteOrigin } from '#lib/website-origin.js';

/**
 * SinopiaCAD's own legal documents, published by Sinopia on sinopialab.com. They replace Tau's
 * privacy, terms and cookie pages; their sections differ from Tau's, so a Tau anchor is dropped.
 */
export const sinopiaLegalUrls = {
  privacy: 'https://sinopialab.com/privacy-policy',
  terms: 'https://sinopialab.com/beta/condizioni',
  cookies: 'https://sinopialab.com/cookie-policy',
} as const;

const isSinopiaLegalPage = (name: string): name is keyof typeof sinopiaLegalUrls =>
  Object.hasOwn(sinopiaLegalUrls, name);

/**
 * Link to a legal page. Privacy, terms and cookies resolve to Sinopia's documents; any other page
 * (Tau's open-source notices) stays on the upstream website (`apps/www`).
 *
 * @param page - Page and optional anchor, for example `privacy#9.2.1-ai-service-improvement`.
 * @returns Sinopia's page for privacy, terms and cookies; otherwise `/legal/<page>` on the website origin.
 */
export const legalUrl = (page: string): string => {
  const name = page.split('#', 1)[0] ?? page;
  return isSinopiaLegalPage(name) ? sinopiaLegalUrls[name] : `${websiteOrigin()}/legal/${page}`;
};
