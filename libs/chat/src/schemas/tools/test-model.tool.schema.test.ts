import { describe, expect, it } from 'vitest';
import { geoSpecMaxRunBudget, geoSpecMaxWorkUnitLimit } from '#constants/rpc.constants.js';
import { toolDescriptions } from '#constants/tool-description.constants.js';
import {
  geoSpecFailureCategorySchema,
  geoSpecRunFilterInputSchema,
  testModelOutputSchema,
} from '#schemas/tools/test-model.tool.schema.js';

const timedOut = {
  failures: [
    {
      id: 'GEOSPEC_RUN_TIMEOUT',
      requirement: 'The GeoSpec run must finish within its run budget',
      reason: 'GeoSpec run exceeded its 180000 ms browser run budget.',
      suggestion: 'Re-run the unfinished requirements.',
      category: 'timeout',
      targetFile: 'main.geospec.ts',
    },
  ],
  passes: [{ id: 'main.geospec.ts:bounds', requirement: 'bounds', targetFile: 'main.geospec.ts' }],
  passed: 1,
  total: 2,
  runStatus: 'inconclusive',
  timeout: {
    errorCode: 'OPERATION_TIMEOUT',
    code: 'GEOSPEC_RUN_TIMEOUT',
    budget: 180_000,
    elapsed: 180_004,
    phase: 'running',
    file: 'main.geospec.ts',
    requirement: 'shade > is one piece',
  },
};

describe('testModelOutputSchema', () => {
  it('should carry a run timeout with its budget, elapsed time and the requirement in flight', () => {
    expect(testModelOutputSchema.parse(timedOut)).toStrictEqual(timedOut);
  });

  it('should refuse a timeout that is not the operation-timeout code', () => {
    expect(
      testModelOutputSchema.safeParse({ ...timedOut, timeout: { ...timedOut.timeout, errorCode: 'UNKNOWN' } }).success,
    ).toBe(false);
  });

  it('should refuse a failure category outside the refusal vocabulary', () => {
    const [failure] = timedOut.failures;
    expect(
      testModelOutputSchema.safeParse({ ...timedOut, failures: [{ ...failure, category: 'weaken' }] }).success,
    ).toBe(false);
  });

  it.each(['analysis-limit', 'resource-limit', 'work-budget', 'unsupported-evidence'])(
    'should name the %s refusal cause',
    (category) => {
      expect(geoSpecFailureCategorySchema.parse(category)).toBe(category);
    },
  );
});

describe('geoSpecRunFilterInputSchema testTimeout', () => {
  it('should accept the longest run budget and refuse anything above it', () => {
    expect(geoSpecRunFilterInputSchema.safeParse({ testTimeout: geoSpecMaxRunBudget }).success).toBe(true);
    expect(geoSpecRunFilterInputSchema.safeParse({ testTimeout: geoSpecMaxRunBudget + 1 }).success).toBe(false);
  });

  it('should describe the per-test timeout separately from the run budget', () => {
    const description = geoSpecRunFilterInputSchema.shape.testTimeout.description ?? '';
    expect(description).toContain('GEOSPEC_TEST_TIMEOUT');
    expect(description).toContain('does not shorten the run');
    expect(description).not.toContain('Equivalent to CLI');
  });
});

describe('geoSpecRunFilterInputSchema workUnitLimit', () => {
  it('should accept a positive integer budget up to the engine bound and refuse anything else', () => {
    expect(geoSpecRunFilterInputSchema.safeParse({ workUnitLimit: geoSpecMaxWorkUnitLimit }).success).toBe(true);
    expect(geoSpecRunFilterInputSchema.safeParse({ workUnitLimit: geoSpecMaxWorkUnitLimit + 1 }).success).toBe(false);
    expect(geoSpecRunFilterInputSchema.safeParse({ workUnitLimit: 0 }).success).toBe(false);
    expect(geoSpecRunFilterInputSchema.safeParse({ workUnitLimit: 1.5 }).success).toBe(false);
  });

  it('should point a work-budget refusal at this option', () => {
    expect(geoSpecRunFilterInputSchema.shape.workUnitLimit.description).toContain('work-budget');
  });
});

describe('test_model description', () => {
  it('should tell the agent that only geometry failures are decided claims and how a timeout reads', () => {
    expect(toolDescriptions.test_model).toContain("category: 'geometry'");
    expect(toolDescriptions.test_model).toContain('OPERATION_TIMEOUT');
  });
});
