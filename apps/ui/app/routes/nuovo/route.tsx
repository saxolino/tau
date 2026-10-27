import type { MetaFunction } from 'react-router';
import { NuovoDaSinopia } from '#routes/nuovo/nuovo-da-sinopia.js';
import type { Handle } from '#types/matches.types.js';

export const meta: MetaFunction = () => [{ title: 'Dalla parte al CAD · SinopiaCAD' }];

/* The page scrolls as one column on a tablet; the picture and the card sit side by side on a computer. */
export const handle: Handle = {
  enableOverflowY: true,
};

/** «/cad/nuovo»: a part isolated in Sinopia, recognised and built as a parametric piece. */
export default function NuovoRoute(): React.JSX.Element {
  return <NuovoDaSinopia />;
}
