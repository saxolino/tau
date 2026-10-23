import { afterEach, describe, expect, it, vi } from 'vitest';
import { reportToApi } from '#runtime/observability/report-to-api.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

/* SinopiaCAD: Sinopia's function has no telemetry ingest, so the sink sends nothing at all. */
describe('reportToApi', () => {
  it('should send no request to the telemetry ingest', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    reportToApi({
      reportUrl: 'https://api.test/v1/telemetry/ingest',
      name: 'agent.turn',
      duration: 12,
      detail: { agentId: 'tau' },
    });
    await Promise.resolve();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
