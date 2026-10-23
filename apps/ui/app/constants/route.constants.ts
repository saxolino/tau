import { Hammer, Printer, Import, Plug, Shuffle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { FeatureFlagName } from '#flags/flag.constants.js';
import { PartsIcon } from '#components/icons/parts.js';
import type { PlainMessageKey } from '#i18n/translate.js';

export type NavRoute = {
  /** English fallback for consumers that do not translate; the sidebar shows `titleKey` when it is set. */
  title: string;
  /** The message the sidebar translates at render. */
  titleKey?: PlainMessageKey;
  url: string;
  icon: LucideIcon;
  featureFlag?: FeatureFlagName;
  /** When set, clicking the item calls this instead of navigating to `url`. */
  action?: () => void;
};

export const navRoutes: {
  /** Rows shown directly below New Project. */
  navMain: NavRoute[];
  /** Rows listed under the sidebar's More menu. */
  navMore: NavRoute[];
} = {
  navMain: [
    {
      title: 'Projects',
      titleKey: 'shell.nav.projects',
      url: '/projects',
      icon: Hammer,
      // Items: [
      //   {
      //     title: 'History',
      //     url: '/projects/history',
      //   },
      //   {
      //     title: 'Starred',
      //     url: '/projects/starred',
      //   },
      //   {
      //     title: 'Settings',
      //     url: '/projects/settings',
      //   },
      // ],
    },
  ],
  navMore: [
    {
      title: 'Machines',
      titleKey: 'shell.nav.machines',
      featureFlag: 'machines',
      url: '/machines',
      icon: Printer,
    },
    // SinopiaCAD: Tau's Community gallery is hidden until Sinopia redesigns it; `/community` redirects home.
    {
      title: 'Parts',
      titleKey: 'shell.nav.parts',
      url: '/parts',
      icon: PartsIcon,
      featureFlag: 'partsWarehouse',
    },
    {
      title: 'Convert',
      titleKey: 'shell.nav.convert',
      url: '/convert',
      icon: Shuffle,
    },
    {
      title: 'Import',
      titleKey: 'shell.nav.import',
      url: '/import',
      icon: Import,
    },
    // {
    //   title: 'Workflows',
    //   url: '/workflows',
    //   icon: Workflow,
    // },
    {
      title: 'Plugins',
      titleKey: 'shell.nav.plugins',
      url: '/plugins',
      icon: Plug,
      featureFlag: 'pluginsStore',
    },
  ],
};
