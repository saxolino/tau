// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { isSinopiaAuthReturn, rememberSinopiaReturn, takeSinopiaReturn } from '#lib/sinopia-oauth-return.js';

const verifierKey = 'sb-zixducvzqlgpvurbqfuz-auth-token-code-verifier';
const now = Date.parse('2026-10-23T18:00:00.000Z');
const at = (path: string): URL => new URL(path, 'https://cad.sinopialab.com');

afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

describe('isSinopiaAuthReturn', () => {
  it('should recognise the way back from a round trip this tab started', () => {
    rememberSinopiaReturn(at('/w/studio/scarpa'), now);

    expect(isSinopiaAuthReturn(at('/w/studio/scarpa?code=abc'), verifierKey, now)).toBe(true);
    expect(isSinopiaAuthReturn(at('/w/studio/scarpa?error=access_denied'), verifierKey, now)).toBe(true);
    expect(isSinopiaAuthReturn(at('/w/studio/scarpa#error=server_error'), verifierKey, now)).toBe(true);
  });

  it('should recognise it from the PKCE verifier when the tab forgot the return', () => {
    localStorage.setItem(verifierKey, JSON.stringify('verifier'));

    expect(isSinopiaAuthReturn(at('/?code=abc'), verifierKey, now)).toBe(true);
  });

  it('should leave alone an address that only happens to carry a code, or a return that has expired', () => {
    expect(isSinopiaAuthReturn(at('/?code=abc'), verifierKey, now)).toBe(false);

    rememberSinopiaReturn(at('/'), now);

    expect(isSinopiaAuthReturn(at('/'), verifierKey, now)).toBe(false);
    expect(isSinopiaAuthReturn(at('/?code=abc'), verifierKey, now + 10 * 60_000)).toBe(false);
  });
});

describe('takeSinopiaReturn', () => {
  it('should go back to the remembered address, search and hash included, once', () => {
    rememberSinopiaReturn(at('/w/studio/scarpa?chat=uno#vista'), now);

    expect(takeSinopiaReturn(at('/w/studio/scarpa'), now)).toBe('/w/studio/scarpa?chat=uno#vista');
    expect(takeSinopiaReturn(at('/w/studio/scarpa?code=abc'), now)).toBe('/w/studio/scarpa');
  });

  it("should keep the address and drop Supabase Auth's parameters when the memory is for another page", () => {
    rememberSinopiaReturn(at('/altro'), now);

    expect(
      takeSinopiaReturn(at('/w/studio/scarpa?chat=uno&code=abc&sb_flow_id=f&error=x&error_description=y#vista'), now),
    ).toBe('/w/studio/scarpa?chat=uno#vista');
    expect(takeSinopiaReturn(at('/w/studio/scarpa#error=server_error&error_description=y'), now)).toBe(
      '/w/studio/scarpa',
    );
  });

  it('should never remember a path that leaves the origin', () => {
    rememberSinopiaReturn({ pathname: '//evil.example/', search: '', hash: '' }, now);

    expect(takeSinopiaReturn(at('/?code=abc'), now)).toBe('/');
  });
});
