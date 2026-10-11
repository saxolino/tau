/**
 * The shared printer store for a host beside one project folder (agent plugin UI blueprint W11): which project its
 * prints name, and that only one host holds the store at a time.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { bambuSimulatorMachine } from '@taucad/bambu';

import { openLocalMachines } from '#local-machines.js';

describe('openLocalMachines', () => {
  let scratch: string;
  let project: string;
  let storeRoot: string;

  beforeEach(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'tau-local-machines-'));
    project = join(scratch, 'project');
    storeRoot = join(scratch, 'machines');
    await mkdir(project);
  });

  afterEach(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  const open = async () =>
    openLocalMachines({
      workspaceRoot: project,
      providers: [bambuSimulatorMachine()],
      actorId: 'test',
      storeRoot,
      onWarning: () => undefined,
    });

  it("should serve the store's providers and name the folder's project", async () => {
    await writeFile(join(project, 'tau.json'), JSON.stringify({ id: 'proj_abcdefghijklmnopqrstu' }));
    const machines = await open();
    try {
      expect(machines?.projectId).toBe('proj_abcdefghijklmnopqrstu');
      const facet = machines?.facet;
      if (facet?.available !== true) {
        throw new Error('The store was not served.');
      }
      const { signal } = new AbortController();
      const providers = await facet.listProviders({ signal });
      expect(providers.length).toBe(1);
      const bindings = await facet.list({ signal });
      expect(bindings.entries).toEqual([]);
    } finally {
      await machines?.close();
    }
  });

  it('should leave a folder without tau.json unnamed, so nothing in it can be printed', async () => {
    const machines = await open();
    try {
      expect(machines?.projectId).toBeUndefined();
    } finally {
      await machines?.close();
    }
  });

  it('should refuse a second holder of the store until the first closes', async () => {
    const first = await open();
    expect(first).toBeDefined();
    expect(await open()).toBeUndefined();
    await first?.close();
    const again = await open();
    expect(again).toBeDefined();
    await again?.close();
  });
});
