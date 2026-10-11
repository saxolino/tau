import { createRoot } from 'react-dom/client';
import { ColorProvider } from '#hooks/use-color.js';
import { KeyboardProvider } from '@taucad/ui/components/keyboard';
import { RenderingProfile } from '#routes/[__e2e].onshape-render-profile/route.js';
import '#styles/global.css';

createRoot(document.querySelector('#root')!).render(
  <ColorProvider>
    <KeyboardProvider>
      <RenderingProfile />
    </KeyboardProvider>
  </ColorProvider>,
);
