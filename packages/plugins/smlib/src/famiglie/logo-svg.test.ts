// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ErroreLogo, leggiLogoSvg, trattoMinimoLogo } from '#famiglie/logo-svg.js';

const svg = (corpo: string): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${corpo}</svg>`;
const codiceErrore = (testo: string): string | undefined => {
  try {
    leggiLogoSvg(testo);
    return undefined;
  } catch (error) {
    return error instanceof ErroreLogo ? error.codice : String(error);
  }
};
const areaDi = (punti: ReadonlyArray<readonly [number, number]>): number =>
  Math.abs(
    punti.reduce(
      (somma, [x, y], k) => somma + x * punti[(k + 1) % punti.length]![1] - punti[(k + 1) % punti.length]![0] * y,
      0,
    ) / 2,
  );

describe('logo da SVG', () => {
  it('should read a ring-shaped path as an outer contour and a hole, Y up', () => {
    const logo = leggiLogoSvg(svg('<path d="M0 0H40V30H0Z M10 10V20H30V10Z"/>'));
    expect(logo.larghezza).toBe(40);
    expect(logo.altezza).toBe(30);
    expect(logo.contorni.map(({ buco }) => buco).toSorted()).toEqual([false, true]);
    const esterno = logo.contorni.find(({ buco }) => !buco)!;
    const buco = logo.contorni.find(({ buco: b }) => b)!;
    expect(areaDi(esterno.punti) - areaDi(buco.punti)).toBeCloseTo(1000, 6);
    // Esterni antiorari: la prima coppia di lati gira a sinistra.
    const [a, b, c] = esterno.punti as [number, number][];
    expect((b![0] - a![0]) * (c![1] - b![1]) - (b![1] - a![1]) * (c![0] - b![0])).toBeGreaterThan(0);
  });

  it('should flatten curves and arcs, relative commands included', () => {
    const cerchio = leggiLogoSvg(svg('<path d="M50 10a40 40 0 1 1 0 80a40 40 0 1 1 0 -80z"/>'));
    const areaCerchio = areaDi(cerchio.contorni[0]!.punti);
    expect(areaCerchio / (Math.PI * 1600)).toBeGreaterThan(0.99);
    expect(areaCerchio / (Math.PI * 1600)).toBeLessThan(1);
    const curva = leggiLogoSvg(svg('<path d="M0 0 C 20 40, 60 40, 80 0 S 60 -40 40 -20 Q 20 -30 0 0 Z"/>'));
    expect(curva.contorni).toHaveLength(1);
    expect(curva.contorni[0]!.punti.length).toBeGreaterThan(30);
    const forme = leggiLogoSvg(svg('<rect x="0" y="0" width="20" height="10"/><circle cx="50" cy="5" r="5"/>'));
    expect(forme.contorni.map(({ buco }) => buco)).toEqual([false, false]);
    expect(forme.larghezza).toBeCloseTo(55, 6);
  });

  it('should refuse an open contour, a self-intersecting one and an SVG with nothing to fill', () => {
    expect(codiceErrore(svg('<path d="M0 0 L40 0 L40 30"/>'))).toBe('SVG_APERTO');
    expect(codiceErrore(svg('<polyline points="0,0 40,0 40,30"/>'))).toBe('SVG_APERTO');
    // Cravatta: due lati che si incrociano.
    expect(codiceErrore(svg('<path d="M0 0 L40 30 L40 0 L0 30 Z"/>'))).toBe('SVG_AUTOINTERSECANTE');
    // Due contorni che si incrociano fra loro.
    expect(
      codiceErrore(svg('<rect x="0" y="0" width="30" height="30"/><rect x="20" y="20" width="30" height="30"/>')),
    ).toBe('SVG_AUTOINTERSECANTE');
    expect(codiceErrore(svg('<path d="M0 0H40V30H0Z" fill="none" stroke="black"/>'))).toBe('SVG_VUOTO');
    expect(codiceErrore('<div>no</div>')).toBe('SVG_NON_VALIDO');
    expect(codiceErrore(svg('<path d="L 1 1"/>'))).toBe('SVG_NON_VALIDO');
  });

  it('should warn about transforms it does not apply', () => {
    const logo = leggiLogoSvg(svg('<g transform="scale(2)"><rect width="10" height="10"/></g>'));
    expect(logo.avvisi.join(' ')).toContain('transform');
  });

  it('should estimate the thinnest stroke from the contours and the scale', () => {
    // Barra 100 × 2: spessa 2 unità; a 0,2 mm per unità il tratto è 0,4 mm.
    const barra = leggiLogoSvg(svg('<rect x="0" y="0" width="100" height="2"/>'));
    expect(trattoMinimoLogo(barra, 0.2)).toBeCloseTo(0.4, 2);
    // Una cornice con tratto 4 e un tratto da 1: vince il più sottile.
    const misto = leggiLogoSvg(
      svg('<path d="M0 0H60V40H0Z M4 4V36H56V4Z"/><rect x="70" y="0" width="1" height="40"/>'),
    );
    expect(trattoMinimoLogo(misto, 1)).toBeCloseTo(1, 2);
    // Un buco non è un tratto: una piastra piena con un foro largo non è sottile.
    const foro = leggiLogoSvg(svg('<path d="M0 0H60V60H0Z M10 10V50H50V10Z"/>'));
    expect(trattoMinimoLogo(foro, 1)).toBeCloseTo(10, 1);
  });
});

describe('logo salvato', () => {
  it('should rewrite the logo as a clean compact SVG that reads back to the same shape', async () => {
    const { svgDaLogo } = await import('#famiglie/logo-svg.js');
    const sporco = svg(
      '<script>alert(1)</script><path d="M0 0H40V30H0Z M10 10V20H30V10Z" onclick="x()"/><image href="http://e.x/a.png"/>',
    );
    const logo = leggiLogoSvg(sporco);
    const pulito = svgDaLogo(logo);
    expect(pulito).not.toMatch(/script|onclick|image|http:\/\/e\.x/u);
    const riletto = leggiLogoSvg(pulito);
    expect(riletto.larghezza).toBe(40);
    expect(riletto.contorni.map(({ buco }) => buco).toSorted()).toEqual([false, true]);
  });

  it('should simplify a heavy outline to fit the limit, and refuse one that cannot fit', async () => {
    const { svgDaLogo } = await import('#famiglie/logo-svg.js');
    const punti = Array.from(
      { length: 800 },
      (_, k) => `${50 + 40 * Math.cos((k / 800) * 2 * Math.PI)} ${50 + 40 * Math.sin((k / 800) * 2 * Math.PI)}`,
    );
    const logo = leggiLogoSvg(svg(`<polygon points="${punti.join(' ')}"/>`));
    const testo = svgDaLogo(logo, 6000);
    expect(testo.length).toBeLessThanOrEqual(6000);
    expect(leggiLogoSvg(testo).contorni).toHaveLength(1);
    expect(() => svgDaLogo(logo, 120)).toThrow(ErroreLogo);
  });
});

describe('SVG di esportazione', () => {
  it('should ignore defs, clip paths, masks, patterns, symbols, markers and comments', () => {
    const logo = leggiLogoSvg(
      svg(
        '<!-- <rect width="9" height="9"/> --><defs><clipPath id="c"><rect width="100" height="100"/></clipPath><style>.a{fill:none}</style></defs>' +
          '<g clip-path="url(#c)"><path d="M10 10H60V40H10Z"/></g><mask id="m"><rect width="5" height="5"/></mask><symbol><circle r="3"/></symbol>',
      ),
    );
    expect(logo.contorni).toHaveLength(1);
    expect(logo.contorni[0]!.buco).toBe(false);
    expect(logo.larghezza).toBe(50);
  });

  it('should read fill none from a group and from a style class, and say it', () => {
    const daGruppo = svg('<g fill="none"><rect width="9" height="9"/></g><rect x="20" width="10" height="10"/>');
    const logo = leggiLogoSvg(daGruppo);
    expect(logo.contorni).toHaveLength(1);
    expect(logo.avvisi.join(' ')).toContain('senza riempimento');
    const daClasse = svg(
      '<style>.contorno{fill:none;stroke:#000}</style><path class="contorno" d="M0 0H9V9Z"/><rect x="20" width="10" height="10"/>',
    );
    expect(leggiLogoSvg(daClasse).contorni).toHaveLength(1);
    // Un figlio con riempimento proprio dentro un gruppo senza riempimento resta.
    expect(leggiLogoSvg(svg('<g fill="none"><rect width="9" height="9" fill="#000"/></g>')).contorni).toHaveLength(1);
  });

  it('should refuse a logo with too many points', () => {
    const punti = Array.from(
      { length: 4100 },
      (_, k) => `${50 + 40 * Math.cos((k / 4100) * 2 * Math.PI)},${50 + 40 * Math.sin((k / 4100) * 2 * Math.PI)}`,
    );
    expect(codiceErrore(svg(`<polygon points="${punti.join(' ')}"/>`))).toBe('SVG_NON_VALIDO');
  });
});
