import { lazy, memo, Suspense } from 'react';
import { useCadViewport } from '#hooks/use-cad-viewport.js';
import { CadPhoneNotice } from '#components/layout/cad-phone-notice.js';
import { PartThumbnailProvider } from '#providers/part-thumbnail-provider.js';
import { PartGalleryProvider } from '#components/geometry/cad/part-gallery.js';
import { WorkspaceSkeleton } from '#routes/w.$workspace.$project/workspace-skeleton.js';

/* The CAD layout is shared by computer and tablet. Unsupported phones render
 * their notice before loading the workspace chunk. */
const ChatInterfaceDesktop = lazy(async () => {
  const module = await import('#routes/w.$workspace.$project/chat-interface-desktop.js');
  return { default: module.ChatInterfaceDesktop };
});

/**
 * CAD interface with the supported-device boundary before the workspace mounts
 */
export const ChatInterface = memo(function (): React.JSX.Element {
  const viewport = useCadViewport();
  if (viewport === 'phone') {
    return <CadPhoneNotice />;
  }

  return (
    <PartThumbnailProvider>
      <PartGalleryProvider>
        <Suspense fallback={<WorkspaceSkeleton />}>
          <ChatInterfaceDesktop />
        </Suspense>
      </PartGalleryProvider>
    </PartThumbnailProvider>
  );
});
