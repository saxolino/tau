import { describe, expect, it } from 'vitest';
import {
  geoSpecDefaultRunBudget,
  geoSpecMaxRunBudget,
  geoSpecRunBudgetHeadroom,
  mutatingRpcNames,
  readOnlyRpcNames,
  resolveGeoSpecRunBudget,
  rpcName,
  rpcNames,
} from '#constants/rpc.constants.js';

describe('rpc.constants', () => {
  describe('mutatingRpcNames / readOnlyRpcNames partition invariant', () => {
    it('partitions every rpcName into exactly one of the two sets', () => {
      const unclassified: string[] = [];
      const doubleClassified: string[] = [];

      for (const name of rpcNames) {
        const inMutating = mutatingRpcNames.has(name);
        const inReadOnly = readOnlyRpcNames.has(name);

        if (inMutating && inReadOnly) {
          doubleClassified.push(name);
        } else if (!inMutating && !inReadOnly) {
          unclassified.push(name);
        }
      }

      expect(
        unclassified,
        `New RPCs must be added to mutatingRpcNames or readOnlyRpcNames: ${unclassified.join(', ')}`,
      ).toEqual([]);
      expect(doubleClassified, `RPCs cannot appear in both partitions: ${doubleClassified.join(', ')}`).toEqual([]);
    });

    it('mutatingRpcNames + readOnlyRpcNames sizes equal rpcNames length', () => {
      expect(mutatingRpcNames.size + readOnlyRpcNames.size).toBe(rpcNames.length);
    });

    it('classifies every canonical mutating RPC', () => {
      expect(mutatingRpcNames.has(rpcName.createFile)).toBe(true);
      expect(mutatingRpcNames.has(rpcName.deleteFile)).toBe(true);
      expect(mutatingRpcNames.has(rpcName.appendFile)).toBe(true);
      expect(mutatingRpcNames.has(rpcName.editFile)).toBe(true);
    });

    it('classifies read-only RPCs out of the mutating set', () => {
      expect(mutatingRpcNames.has(rpcName.readFile)).toBe(false);
      expect(mutatingRpcNames.has(rpcName.grep)).toBe(false);
      expect(mutatingRpcNames.has(rpcName.listDirectory)).toBe(false);
      expect(mutatingRpcNames.has(rpcName.evaluateModel)).toBe(false);
      expect(readOnlyRpcNames.has(rpcName.resolveSkill)).toBe(true);
    });
  });

  describe('resolveGeoSpecRunBudget', () => {
    it('keeps the host budget when the call names no testTimeout', () => {
      expect(resolveGeoSpecRunBudget(geoSpecDefaultRunBudget)).toBe(geoSpecDefaultRunBudget);
    });

    it('raises the budget to cover a testTimeout plus its headroom', () => {
      expect(resolveGeoSpecRunBudget(60_000, 120_000)).toBe(120_000 + geoSpecRunBudgetHeadroom);
    });

    it('never lowers the host budget for a short testTimeout', () => {
      expect(resolveGeoSpecRunBudget(geoSpecDefaultRunBudget, 1000)).toBe(geoSpecDefaultRunBudget);
    });

    it('caps every budget at the schema maximum', () => {
      expect(resolveGeoSpecRunBudget(geoSpecDefaultRunBudget, geoSpecMaxRunBudget)).toBe(geoSpecMaxRunBudget);
      expect(resolveGeoSpecRunBudget(10 * geoSpecMaxRunBudget)).toBe(geoSpecMaxRunBudget);
    });
  });
});
