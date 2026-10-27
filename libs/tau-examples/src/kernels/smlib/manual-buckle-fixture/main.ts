/* oxlint-disable eslint/new-cap -- SMLib exposes functional shape and placement constructors. */
import {
  Align,
  Box,
  Cylinder,
  Part,
  Polygon,
  Pos,
  Rot,
  Z,
} from '@classcad/smlibwasm';
import type { Material, ShapeConfig } from '@taucad/smlib/model';

/** Dimensions in millimetres for the two-piece manual-edit acceptance model. */
export const defaultParams = {
  strapWidth: 25,
  strapClearance: 1,
  openingLength: 36,
  railWidth: 4,
  thickness: 4,
  cornerRadius: 5,
  barRadius: 1.6,
  pinWidth: 3,
  pinThickness: 2,
  hingeClearance: 0.4,
};

/** Native names stay stable when an agent or user changes dimensions. */
export const partNames = { frame: 'Telaio fibbia', pin: 'Ardiglione' } as const;

const validate = (p: typeof defaultParams): void => {
  if (!Object.values(p).every((value) => Number.isFinite(value) && value > 0)) {
    throw new RangeError('Buckle dimensions must be finite and positive.');
  }
  const innerWidth = p.strapWidth + p.strapClearance;
  if (
    p.railWidth < 2 ||
    p.cornerRadius <= p.railWidth ||
    p.cornerRadius * 2 >=
      Math.min(
        innerWidth + 2 * p.railWidth,
        p.openingLength + 2 * p.railWidth,
      ) ||
    p.barRadius * 2 > p.thickness ||
    p.pinWidth >= innerWidth / 2 ||
    p.barRadius + p.hingeClearance + 0.9 >= p.openingLength / 4
  ) {
    throw new RangeError(
      'Buckle frame, crossbar and pin dimensions are incompatible.',
    );
  }
};

/** A circular crossbar or hinge eye, centred on X and at the frame mid-height. */
const barrel = (radius: number, length: number, height: number): Part =>
  Pos(0, 0, height).mul(
    Rot(0, 90, 0).mul(Cylinder(radius, length, { align: Align.CENTER })),
  );

/** A frame with an integral crossbar and a separate pin; no animation alters authored coordinates. */
export default function main(p = defaultParams): ShapeConfig[] {
  validate(p);
  const openingWidth = p.strapWidth + p.strapClearance;
  const outerWidth = openingWidth + 2 * p.railWidth;
  const outerLength = p.openingLength + 2 * p.railWidth;
  const standing = [Align.CENTER, Align.CENTER, Align.MIN];
  let outside = Box(outerWidth, outerLength, p.thickness, { align: standing });
  outside = outside.fillet(outside.edges().parallelTo(Z), p.cornerRadius);
  let opening = Box(openingWidth, p.openingLength, p.thickness + 2, {
    align: standing,
  });
  opening = opening.fillet(
    opening.edges().parallelTo(Z),
    p.cornerRadius - p.railWidth,
  );
  const frame = outside
    .cut(Pos(0, 0, -1).mul(opening))
    .fuse(barrel(p.barRadius, openingWidth + 2, p.thickness / 2));

  const eyeInnerRadius = p.barRadius + p.hingeClearance;
  const eyeOuterRadius = eyeInnerRadius + 0.9;
  const eye = barrel(eyeOuterRadius, p.pinWidth, p.thickness / 2).cut(
    barrel(eyeInnerRadius, p.pinWidth + 2, p.thickness / 2),
  );
  const tipLength = outerLength / 2 - 0.5;
  const shank: unknown = Pos(0, 0, p.thickness / 2 + eyeOuterRadius - 0.4).mul(
    Polygon(
      [-p.pinWidth / 2, 0],
      [p.pinWidth / 2, 0],
      [p.pinWidth / 2, tipLength - 3],
      [0.6, tipLength],
      [-0.6, tipLength],
      [-p.pinWidth / 2, tipLength - 3],
      { align: null },
    ).extrude(p.pinThickness),
  );
  if (!(shank instanceof Part)) {
    throw new TypeError('The buckle pin profile must produce a solid.');
  }
  const pin = eye.fuse(shank);
  const material: Material = {
    pbrMetallicRoughness: {
      baseColorFactor: [0.76, 0.57, 0.29, 1],
      metallicFactor: 1,
      roughnessFactor: 0.32,
    },
  };
  return [
    { name: partNames.frame, shape: frame, material },
    { name: partNames.pin, shape: pin, material },
  ];
}
