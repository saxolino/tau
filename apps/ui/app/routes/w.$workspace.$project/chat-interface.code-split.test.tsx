// @vitest-environment jsdom
/**
 * B-27, D-UI-16: SinopiaCAD has one workspace shell for computers and tablets, loaded on demand; a phone loads
 * neither that shell nor any panel and gets the supported-devices notice (`chat-interface.tsx`). The separate
 * mobile shell with one tab at a time is gone, so no panel is loaded until the desktop shell itself mounts them.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChatInterface } from '#routes/w.$workspace.$project/chat-interface.js';

const loaded = vi.hoisted(() => new Set<string>());

/* Each factory runs only when its module is imported, so `loaded` records which modules a render needed. */
const panel = vi.hoisted(() => (name: string, label: string) => () => {
  loaded.add(name);
  return { [name]: () => label };
});

const viewport = vi.hoisted(() => ({ current: 'phone' as 'phone' | 'tablet' | 'desktop' }));
vi.mock('#hooks/use-cad-viewport.js', () => ({ useCadViewport: () => viewport.current }));
vi.mock('#providers/part-thumbnail-provider.js', () => ({
  PartThumbnailProvider: ({ children }: { children: React.ReactNode }): React.ReactNode => children,
}));
vi.mock('#components/geometry/cad/part-gallery.js', () => ({
  PartGalleryProvider: ({ children }: { children: React.ReactNode }): React.ReactNode => children,
}));
vi.mock('#routes/w.$workspace.$project/chat-interface-desktop.js', panel('ChatInterfaceDesktop', 'Desktop shell'));
vi.mock('#routes/w.$workspace.$project/use-chat-interface-state.js', () => ({
  useChatInterfaceState: () => ({
    activeTab: 'chat',
    handleTabChange: vi.fn(),
    drawerOpen: true,
    handleDrawerChange: vi.fn(),
    snapPoints: [0.5, 1],
    activeSnapPoint: 0.5,
    handleSnapChange: vi.fn(),
  }),
}));
vi.mock('#routes/w.$workspace.$project/focused-chat-gate.js', () => ({
  ChatHistoryGate: ({ children }: { children: React.ReactNode }): React.ReactNode => children,
  ChatInterfaceSessionGate: ({ children }: { children: React.ReactNode }): React.ReactNode => children,
}));
vi.mock('#routes/w.$workspace.$project/chat-viewer-dockview.js', () => ({ ViewerDockview: () => null }));
vi.mock('#routes/w.$workspace.$project/chat-history.js', panel('ChatHistory', 'Chat history'));
vi.mock('#routes/w.$workspace.$project/chat-file-tree.js', panel('ChatFileTree', 'Files'));
vi.mock('#routes/w.$workspace.$project/chat-parameters.js', panel('ChatParameters', 'Parameters'));
vi.mock('#routes/w.$workspace.$project/chat-editor-layout.js', panel('ChatEditorLayout', 'Editor'));
vi.mock('#routes/w.$workspace.$project/chat-details.js', panel('ChatDetails', 'Details'));
vi.mock('#routes/w.$workspace.$project/chat-converter.js', panel('ChatConverter', 'Converter'));
vi.mock('#routes/w.$workspace.$project/project-share-action.js', panel('ProjectShareWorkbenchPanel', 'Share'));
vi.mock('#routes/w.$workspace.$project/chat-revisions.js', panel('ChatRevisions', 'Revisions'));
vi.mock('#routes/w.$workspace.$project/project-unavailable-overlay.js', () => ({
  ProjectUnavailableOverlay: () => null,
}));
vi.mock('#routes/w.$workspace.$project/project-manifest-issue-banner.js', () => ({
  ProjectManifestIssueBanner: () => null,
}));
vi.mock('#routes/w.$workspace.$project/chat-interface-nav.js', () => ({ ChatInterfaceNav: () => null }));
vi.mock('#routes/w.$workspace.$project/workspace-skeleton.js', () => ({ WorkspaceSkeleton: () => null }));

describe('ChatInterface code splitting (B-27, D-UI-16)', () => {
  /* `loaded` only grows (a module factory runs once), so the phone case runs first and proves nothing was imported. */
  it('loads neither the workspace shell nor any panel on a phone', async () => {
    viewport.current = 'phone';
    render(<ChatInterface />);

    expect(await screen.findByText('SinopiaCAD works on computers and tablets from 7 inches up.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Sinopia' })).toHaveAttribute('href', 'https://sinopialab.com');
    expect([...loaded]).toEqual([]);
  });

  it.each(['tablet', 'desktop'] as const)('loads only the workspace shell, not its panels, on a %s', async (kind) => {
    viewport.current = kind;
    render(<ChatInterface />);

    expect(await screen.findByText('Desktop shell')).toBeInTheDocument();
    expect([...loaded]).toEqual(['ChatInterfaceDesktop']);
  });
});
