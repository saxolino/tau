/* eslint-disable @typescript-eslint/naming-convention -- snake_case is expected for webmanifest */
import type { WebAppManifest } from 'web-app-manifest';
import type { LoaderFunction } from 'react-router';
import { metaConfig } from '#constants/meta.constants.js';

export const loader: LoaderFunction = () => {
  return Response.json(
    {
      short_name: metaConfig.name,
      name: metaConfig.name,
      description: metaConfig.description,
      orientation: 'portrait',
      start_url: '/',
      display: 'standalone',
      // @see https://developer.mozilla.org/en-US/docs/Web/Manifest/Reference/display_override
      display_override: ['fullscreen', 'minimal-ui'],
      // SinopiaCAD: Sinopia's ivory page (`--background` in light mode).
      background_color: '#f5f3ef',
      theme_color: '#f5f3ef',
      icons: [
        {
          src: '/android-chrome-192x192.png',
          sizes: '192x192',
          type: 'image/png',
        },
        {
          src: '/android-chrome-512x512.png',
          sizes: '512x512',
          type: 'image/png',
        },
      ],
    } satisfies WebAppManifest,
    {
      headers: {
        'Cache-Control': 'public, max-age=600',
        'Content-Type': 'application/manifest+json',
      },
    },
  );
};
