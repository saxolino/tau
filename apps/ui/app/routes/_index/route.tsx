import type { MetaFunction } from 'react-router';
import { SinopiaHome } from '#routes/_index/sinopia-home.js';
import type { Handle } from '#types/matches.types.js';
import { metaConfig } from '#constants/meta.constants.js';

export const meta: MetaFunction = () => [
  { title: metaConfig.name },
  { name: 'description', content: metaConfig.description },
];

/* The home lays out its own scrolling main area beside the agent lane, as the project page does. */
export const handle: Handle = {
  enablePageWrapper: true,
};

/** Session-neutral app home; the marketing site (`apps/www`) is served by the edge before this app. */
export default function WebHome(): React.JSX.Element {
  return <SinopiaHome />;
}
