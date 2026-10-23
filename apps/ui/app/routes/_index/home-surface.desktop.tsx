import type { MetaFunction } from 'react-router';
import { SinopiaHome } from '#routes/_index/sinopia-home.js';
import type { Handle } from '#types/matches.types.js';
import { metaConfig } from '#constants/meta.constants.js';

export const meta: MetaFunction = () => [
  { title: metaConfig.name },
  { name: 'description', content: metaConfig.description },
];

export const handle: Handle = {
  enablePageWrapper: true,
};

/** The desktop app's home: the same home as the web, without Tau's examples gallery (Community is hidden). */
export default function DesktopHome(): React.JSX.Element {
  return <SinopiaHome />;
}
