/**
 * Search-parameter names that drive UI state.
 *
 * The closed union is the point: a parameter that is read in one place and
 * written in another gets one spelling here instead of two string literals
 * that drift. Names are the literal query keys, so they keep whatever casing
 * already shipped in URLs people have bookmarked.
 */
export const searchParameterName = {
  /* Library */
  // Whether the project library also lists trashed projects.
  trash: 'trash',
  // Project collection sort field and direction.
  sort: 'sort',

  /* Community */
  // The Community search text, absent when empty.
  query: 'q',
  // The Community kernel filter, absent for every kernel.
  kernel: 'kernel',

  /* Parts */
  // The Parts category filter, absent for all categories.
  partCategory: 'category',

  /* Entry links from Sinopia («Apri nel CAD») */
  // The Sinopia project to start a new CAD from on the home («Da un progetto Sinopia»).
  sinopiaProject: 'project',
  // The CAD model of the account to open (`cad_models.id`).
  sinopiaModel: 'model',
  // With `model`: the section to open it on (`foto`: the sample photo, asked by Sinopia's «Fai lo shooting»).
  sinopiaSection: 'sezione',
  // «/cad/nuovo» (a part isolated in Sinopia → recognised family): the image asset, the part, its mask, its type,
  // the library component and a measure the designer knows (`<mm>:<what>`).
  sinopiaAsset: 'asset',
  sinopiaPart: 'part',
  sinopiaMask: 'mask',
  sinopiaPartType: 'partType',
  sinopiaLibrary: 'library',
  // «/cad/nuovo» from a supplier-catalogue card: `supplier_products.id` (no project, no asset, no part).
  sinopiaSupplier: 'supplier',
  sinopiaMeasure: 'measure',
  // «/cad/nuovo» dalla card «Parte isolata»: l'asset della vista già generata nello Studio, riusata come vista
  // principale solo se i suoi metadati dicono che lo è (stessa parte, stessa famiglia).
  sinopiaView: 'view',
  // Development only: a recorded recognition («prova»), no Sinopia read and no paid call.
  recognitionTrial: 'prova',

  /* Dialogs */
  // The open settings dialog section, absent when the dialog is closed.
  settings: 'settings',
  // The setting to reveal inside the opened settings section, e.g. `credit-balance`.
  settingsTarget: 'setting',
  // The remote-compute pairing code being redeemed.
  pair: 'pair',

  /* Machines */
  machine: 'machine',
  machineHost: 'machineHost',
  machineJob: 'job',
  machineStatus: 'status',

  /* Project route */
  // The focused chat within the open project.
  chat: 'chat',
  // The project archive in place of the chat transcript.
  archivedChats: 'archivedChats',
  // The open workbench panel, e.g. `share`.
  workbench: 'workbench',
  // The selected share provider within the share panel.
  shareProvider: 'shareProvider',
  // Consume-once marker that the project was just opened from Tau Cloud.
  cloudOpen: 'cloudOpen',

  /* Diagnostics */
  // Per-page graphics backend override, e.g. `webgl` or `webgpu`.
  graphicsBackend: 'graphicsBackend',

  /* Returns from an external flow */
  // Consume-once billing action id returned from Checkout.
  paymentAction: 'payment_action',
  // Consume-once marker that the desktop app opened the import route.
  desktopOpen: 'desktop-open',

  /* Import */
  // The git ref to import, defaulting to the repository's main branch.
  ref: 'ref',
  // The entry file to open after an import.
  main: 'main',
} as const;

/**
 * Union of all search-parameter names.
 *
 * Not `ConstantRecord`, which `cookieName` uses: that helper requires every
 * value to be the kebab-case form of its key, and these names are the query
 * keys already live in bookmarked URLs (`shareProvider`, `payment_action`).
 * Renaming them to satisfy a type helper would break those links.
 */
export type SearchParameterName = (typeof searchParameterName)[keyof typeof searchParameterName];
