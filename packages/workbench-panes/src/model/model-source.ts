import type { ComponentType } from 'react';
import type { PaneviewApi } from 'dockview-react';
import type { GeometryComponentManifest, GeometryComponentNode, GeometryComponentReference } from '@taucad/types';
import { englishPartPropertiesLabels } from '@taucad/viewer/cad/part-properties-panel';
import type { PartPropertiesLabels } from '@taucad/viewer/cad/part-properties-panel';
import type { PartThumbnailState } from '@taucad/viewer/cad/part-thumbnail-state';
import type { GraphicsRef } from '#host/workbench-host.jsx';

/**
 * Every word the Model pane shows, in the host's language. The pane's own weight count, which a host replaces with
 * {@link ModelSource.weightSummary}, stays in English.
 *
 * @public
 */
export type ModelPaneLabels = Readonly<{
  filter: string;
  filterPlaceholder: string;
  /** The Properties section's title. */
  properties: string;
  /** The component list's accessible name, by its entry's title. */
  components: (entryTitle: string) => string;
  showHiddenComponents: string;
  showHiddenComponentsIn: (entryTitle: string) => string;
  /** The row actions' tooltips. */
  showPart: string;
  hidePart: string;
  isolatePart: string;
  removeIsolation: string;
  /** The row actions' accessible names, by the component's name. */
  show: (name: string) => string;
  hide: (name: string) => string;
  isolate: (name: string) => string;
  removeIsolationFor: (name: string) => string;
  /** A row thumbnail's accessible name. */
  preview: (name: string) => string;
  previewLoading: string;
  previewUnavailable: string;
  noComponents: string;
  rendererClosed: string;
  noMatches: string;
  /** The Properties panel's words. */
  part: PartPropertiesLabels;
}>;

/**
 * The English words the Model pane uses unless its host passes its own.
 *
 * @public
 */
export const englishModelPaneLabels: ModelPaneLabels = {
  filter: 'Filter parts',
  filterPlaceholder: 'Filter parts…',
  properties: 'Properties',
  components: (entryTitle) => `Model components for ${entryTitle}`,
  showHiddenComponents: 'Show hidden components',
  showHiddenComponentsIn: (entryTitle) => `Show hidden components in ${entryTitle}`,
  showPart: 'Show part',
  hidePart: 'Hide part',
  isolatePart: 'Isolate part',
  removeIsolation: 'Remove isolation',
  show: (name) => `Show ${name}`,
  hide: (name) => `Hide ${name}`,
  isolate: (name) => `Isolate ${name}`,
  removeIsolationFor: (name) => `Remove isolation for ${name}`,
  preview: (name) => `Preview ${name}`,
  previewLoading: 'Preview loading',
  previewUnavailable: 'Preview unavailable',
  noComponents: 'No model components available',
  rendererClosed: 'Open renderer to inspect components',
  noMatches: 'No matching parts',
  part: englishPartPropertiesLabels,
};

/**
 * One component of one entry: what a reveal request names.
 *
 * @public
 */
export type ModelComponentTarget = Readonly<{
  /** Project-relative path of the entry the component belongs to. */
  entryPath: string;
  /** The model-interaction unit id of that entry. */
  unitId: string;
  /** The component's id in the unit's manifest. */
  componentId: string;
}>;

/**
 * What a part-thumbnail capability is asked for: one entry's tree, its selection and the rows on screen.
 *
 * @public
 */
export type ModelThumbnailRequest = Readonly<{
  entryPath: string;
  unitId: string;
  graphicsRef: GraphicsRef;
  manifest: GeometryComponentManifest | undefined;
  /** The unit's selection, last selected last. */
  selectedComponentIds: readonly string[];
  /** The component rows currently scrolled into view, at most 127. */
  visibleComponentIds: readonly string[];
}>;

/**
 * The part thumbnails of one entry, and the controls the rows and the properties panel drive.
 *
 * @public
 */
export type ModelThumbnails = Readonly<{
  /** Thumbnail state by component id. */
  previews: ReadonlyMap<string, PartThumbnailState>;
  /** Render the component's thumbnail again; the last selected component when no id is given. */
  retry: (componentId?: string) => void;
  /** The thumbnail's bytes failed to decode as an image. */
  failDecode: (componentId: string, bytes: Uint8Array<ArrayBuffer>) => void;
  /** The thumbnail's bytes decoded and are on screen. */
  markDecoded: (componentId: string, bytes: Uint8Array<ArrayBuffer>) => void;
}>;

/**
 * Which part a part gallery opens on, and where focus returns when it closes.
 *
 * @public
 */
export type ModelPartGalleryRequest = Readonly<{
  graphicsRef: GraphicsRef;
  unitId: string;
  componentId: string;
  source: 'explorer';
  origin?: HTMLElement;
}>;

/**
 * What a host's component action menu receives for one row.
 *
 * @public
 */
export type ModelComponentActionMenuProps = Readonly<{
  manifest: GeometryComponentManifest;
  node: GeometryComponentNode;
  graphicsRef: GraphicsRef;
  unitId: string;
  source: 'explorer';
  isFocused: boolean;
  isIsolated: boolean;
  hasHiddenComponents: boolean;
  hasOpacityOverrides: boolean;
  opacity: number;
  preview?: PartThumbnailState;
  onRetryPreview?: () => void;
  onPreviewDecodeError?: () => void;
  onPreviewDecoded?: () => void;
}>;

/**
 * A host's per-row component menu: the row's trigger button, and the right-click menu content the pane draws inside
 * `@taucad/ui` `ContextMenu`.
 *
 * @public
 */
export type ModelComponentActions = Readonly<{
  Dropdown: ComponentType<ModelComponentActionMenuProps & Readonly<{ actionButtonClassName: string }>>;
  ContextContent: ComponentType<ModelComponentActionMenuProps>;
}>;

/**
 * A saved section layout: expansion and size by section id (an entry path, or `properties`).
 *
 * @public
 */
export type ModelPanelLayout = Readonly<{
  savedState: Readonly<Record<string, Readonly<{ isExpanded: boolean; size?: number }>>>;
  /** Called once the sections are laid out, so the host can follow later layout changes. */
  connectApi: (api: PaneviewApi) => void;
}>;

/**
 * What the Model pane needs from its host beyond the shared units. Each host (the Tau app, the agent plugin viewer)
 * implements it over its own state. Every field is an optional capability; the pane leaves out what a host lacks.
 * Selection, hover, visibility, isolation and opacity always go through the entry's graphics actor.
 *
 * @public
 */
export type ModelSource = Readonly<{
  /**
   * Which model-interaction unit a section shows. `entry` (the default) derives it from the entry path; `presented`
   * follows the unit the entry's graphics actor presents, for a host whose model may have no source file.
   */
  unitIdentity?: 'entry' | 'presented';
  /** A hook that keeps the section layout across mounts. Without it every section opens at its default size. */
  usePanelLayout?: () => ModelPanelLayout;
  /**
   * A hook that renders part thumbnails. Without it part rows stay compact and show no preview. The pane calls it
   * on every render of a section, so a host must not add or remove it while the pane is mounted.
   */
  useThumbnails?: (request: ModelThumbnailRequest) => ModelThumbnails;
  /** Opens the part gallery. Without it a thumbnail is not a button. */
  openPartGallery?: (request: ModelPartGalleryRequest) => void;
  /** The per-row component menu. Without it a row has no menu button and no right-click menu. */
  componentActions?: ModelComponentActions;
  /**
   * The host's reveal channel: other surfaces ask the pane to reveal a component through `subscribe`, and the pane
   * asks through `request`. Without it the pane reveals its own requests directly.
   */
  reveal?: Readonly<{
    subscribe: (listener: (target: ModelComponentTarget) => void) => () => void;
    request: (target: ModelComponentTarget) => void;
  }>;
  /** Called when an entry's selected component changes, with its reference, or `undefined` when it is cleared. */
  onSelect?: (reference: GeometryComponentReference | undefined) => void;
  /** The pane's words in the host's language. Absent, English ({@link englishModelPaneLabels}). */
  labels?: ModelPaneLabels;
  /**
   * The name a row and the Properties panel show for a component, as the host names its pieces. Absent, the
   * manifest's name. The filter matches either.
   */
  componentName?: (node: GeometryComponentNode) => string;
  /**
   * The name an entry shows (its section header, the Properties panel), given every listed entry, main first, for a
   * host that keeps file names out of sight. Absent, the entry's path.
   */
  entryTitle?: (entryPath: string, entryPaths: readonly string[]) => string;
  /** List a lone entry's components without a section header: one model, one list. Absent, every entry has one. */
  hideLoneEntryHeader?: boolean;
  /**
   * The weight line under an entry's components, from its manifest; `undefined` shows no line, for a weight that is
   * not known. Absent, the pane counts the parts whose weight it knows and lists the others.
   */
  weightSummary?: (manifest: GeometryComponentManifest) => string | undefined;
}>;
