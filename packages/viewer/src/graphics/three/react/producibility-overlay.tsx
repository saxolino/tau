import { useEffect, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { Color, DoubleSide, Mesh, MeshBasicMaterial } from 'three';
import type { Object3D } from 'three';
import { useRenderFrame } from '#hooks/use-graphics.jsx';
import {
  producibilityBlockColor,
  producibilityOkColor,
  producibilityOverlayOpacity,
  producibilityWarningColor,
} from '#graphics/three/overlay-colors.constants.js';
import { installSectionClip } from '#graphics/three/materials/section-clip.js';
import { useSectionClip } from '#graphics/three/react/section-clipping-group.jsx';
import {
  componentFaceSurfaces,
  producibilityPieceGeometry,
} from '#graphics/three/react/producibility-overlay-geometry.js';
import type { ProducibilityOverlay } from '#graphics/three/react/producibility-overlay.types.js';
import { SceneOverlay } from '#graphics/three/scene-overlay.jsx';

/**
 * The producibility veil (E1): the faces a check points at in the status tints, or a piece's draft map, drawn over the
 * piece's own material. Built after the commit that attaches the topology face spans to the presented meshes, and only
 * for the artifact the face ids were measured on. Transient render resources only.
 *
 * @internal
 * @returns The veil, or nothing.
 */
export function ProducibilityOverlayMesh({
  overlay,
  artifactKey,
  scene,
}: Readonly<{ overlay?: ProducibilityOverlay; artifactKey: string; scene?: Object3D }>): React.JSX.Element | undefined {
  const clipping = useSectionClip();
  const renderFrame = useRenderFrame();
  const invalidate = useThree((state) => state.invalidate);
  const [meshes, setMeshes] = useState<readonly Mesh[]>([]);
  useEffect(() => {
    if (!scene || !overlay || (overlay.artifactKey !== undefined && overlay.artifactKey !== artifactKey)) {
      // oxlint-disable-next-line react/set-state-in-effect -- The veil follows the presented scene, read after commit.
      setMeshes([]);
      return undefined;
    }
    const tints = {
      block: new Color(producibilityBlockColor),
      warning: new Color(producibilityWarningColor),
      ok: new Color(producibilityOkColor),
    };
    const built = overlay.pieces.flatMap((piece) => {
      const geometry = producibilityPieceGeometry(componentFaceSurfaces(scene, piece.componentId), piece, tints);
      if (!geometry) {
        return [];
      }
      const material = new MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: producibilityOverlayOpacity,
        side: DoubleSide,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -4,
        toneMapped: false,
      });
      installSectionClip(material, clipping);
      const mesh = new Mesh(geometry, material);
      mesh.raycast = () => undefined;
      mesh.renderOrder = 899;
      return [mesh];
    });
    setMeshes(built);
    invalidate();
    return () => {
      for (const mesh of built) {
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
      invalidate();
    };
    // The render frame moves the presented scene; the face spans follow it.
  }, [scene, overlay, artifactKey, clipping, renderFrame, invalidate]);
  if (meshes.length === 0) {
    return undefined;
  }
  return (
    <SceneOverlay overlayActive>
      {meshes.map((mesh) => (
        <primitive key={mesh.uuid} object={mesh} />
      ))}
    </SceneOverlay>
  );
}
