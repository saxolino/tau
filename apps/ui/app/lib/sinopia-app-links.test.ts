import { afterEach, describe, expect, it, vi } from 'vitest';
import { sinopiaCreatorUrl, sinopiaShootingUrl } from '#lib/sinopia-app-links.js';
import { rememberSampleSectionRequest, takeSampleSectionRequest } from '#lib/sinopia-section-request.js';

const project = '1841f9d7-ee9a-4684-a6d0-742ba0e64b52';
const model = '30000000-0000-4000-8000-000000000001';
const photo = '40000000-0000-4000-8000-000000000001';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the gestures that continue on Sinopia', () => {
  it('«Porta nel Creator» opens the canvas of the model’s own project with the model to bring in', () => {
    vi.stubEnv('BASE_URL', '/cad/');
    expect(sinopiaCreatorUrl(project, model)).toBe(`/creator/${project}?cadModel=${model}`);
  });

  it('«Fai lo shooting» opens the project’s Shooting with the sample photo chosen and the model as its 3D', () => {
    vi.stubEnv('BASE_URL', '/cad/');
    expect(sinopiaShootingUrl(project, photo, model)).toBe(`/shooting/${project}?asset=${photo}&cad=${model}`);
  });

  it('outside sinopialab.com/cad the addresses are sinopialab.com’s, and malformed ids give none', () => {
    vi.stubEnv('BASE_URL', '/');
    expect(sinopiaCreatorUrl(project, model)).toBe(`https://sinopialab.com/creator/${project}?cadModel=${model}`);
    expect(sinopiaCreatorUrl('../x', model)).toBeUndefined();
    expect(sinopiaShootingUrl(project, 'not-a-photo', model)).toBeUndefined();
  });

  it('the «photo first» request opens the photo section once', () => {
    rememberSampleSectionRequest(model);
    expect(takeSampleSectionRequest(model)).toBe(true);
    expect(takeSampleSectionRequest(model)).toBe(false);
  });
});
