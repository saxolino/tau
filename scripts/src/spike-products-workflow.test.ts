import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

type Step = { name?: string; uses?: string; run?: string; if?: string; with?: Record<string, unknown> };
type Job = { uses?: string; needs?: string[]; steps?: Step[]; if?: string; 'continue-on-error'?: boolean };
type Workflow = { jobs: Record<string, Job> };
const root = resolve(import.meta.dirname, '../..');
const workflow = (name: string): Workflow =>
  load(readFileSync(resolve(root, '.github/workflows', name), 'utf8')) as Workflow;
const producer = workflow('spike-geospec-products.yml').jobs['products']!;
const producerSteps = producer.steps!;

describe('spike GeoSpec prerequisites', () => {
  it.each([
    ['spike-s12.yml', 's12', 'products'],
    ['spike-publish-dry-run.yml', 'cli-pack-install', 'cli-products'],
  ])('should consume verified same-run products before building in %s', (file, consumerName, producerName) => {
    const { jobs } = workflow(file);
    const consumer = jobs[consumerName]!;
    expect(jobs[producerName]?.uses).toBe('./.github/workflows/spike-geospec-products.yml');
    expect(consumer.needs).toContain(producerName);
    expect(consumer['continue-on-error']).toBeUndefined();
    expect(consumer.if ?? '').not.toContain('always()');
    const steps = consumer.steps!;
    const download = steps.findIndex((step) => step.uses?.startsWith('actions/download-artifact@'));
    const verify = steps.findIndex((step) => step.run?.includes('-t require-geospec-'));
    const build = steps.findIndex(
      (step) => (step.run ?? '').includes('ui:build:serve') || (step.run ?? '').includes('-t build'),
    );
    expect(download).toBeGreaterThan(-1);
    expect(verify).toBeGreaterThan(download);
    expect(build).toBeGreaterThan(verify);
    const upload = producerSteps.find((step) => step.uses?.startsWith('actions/upload-artifact@'))!;
    expect(steps[download]?.with?.['name']).toBe(upload.with?.['name']);
    expect(steps[download]?.with?.['run-id']).toBeUndefined();
    if (consumerName === 'cli-pack-install') {
      expect(steps[verify]?.run).toContain('-t require-geospec-delivery');
    }
    expect(steps.some((step) => step.uses?.includes('geospec-artifact-from-main'))).toBe(false);
    expect(steps.some((step) => step.run?.includes('head_sha'))).toBe(false);
  });

  it('should prepare and verify source-matched delivery for both cache hits and misses before publishing', () => {
    const restore = producerSteps.findIndex((step) => step.with?.['mode'] === 'restore');
    const build = producerSteps.findIndex((step) => step.uses === './.github/actions/geospec-producer');
    const verify = producerSteps.findIndex((step) => step.run?.includes('-t require-geospec-delivery'));
    const upload = producerSteps.findIndex((step) => step.uses?.startsWith('actions/upload-artifact@'));
    expect(producerSteps[restore]?.if).toBe("steps.cached.outputs.cache-hit == 'true'");
    expect(producerSteps[build]?.if).toBeUndefined();
    expect(verify).toBeGreaterThan(restore);
    expect(verify).toBeGreaterThan(build);
    expect(producerSteps[verify]?.if).toBeUndefined();
    expect(upload).toBeGreaterThan(verify);
    expect(producerSteps[upload]?.if).toBeUndefined();
    expect(producerSteps[upload]?.with?.['if-no-files-found']).toBe('error');
  });

  it('should transport the complete shared artifact inventory without changing its cache version', () => {
    const transport = load(readFileSync(resolve(root, '.github/actions/geospec-transport/action.yml'), 'utf8')) as {
      runs: { steps: Step[] };
    };
    const cachePaths = transport.runs.steps.find((step) => step.uses?.startsWith('actions/cache/restore@'))!.with?.[
      'path'
    ];
    const uploadPaths = producerSteps.find((step) => step.uses?.startsWith('actions/upload-artifact@'))!.with?.['path'];
    expect(uploadPaths).toBe(cachePaths);
    expect(producerSteps.some((step) => step.run?.includes('ci-artifacts.mjs product-key'))).toBe(true);
  });
});
