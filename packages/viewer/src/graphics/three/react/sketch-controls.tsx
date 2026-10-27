import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Plane,
  Raycaster,
  ShapeUtils,
  Vector2,
  Vector3,
} from 'three';
import type { Object3D } from 'three';
import { fromRenderPoint } from '@taucad/spatial';
import { useCameraRig, useGraphics, useRenderFrame } from '#hooks/use-graphics.jsx';
import { manualHandleColor, manualSelectionColor } from '#graphics/three/overlay-colors.constants.js';
import { useThreeGraphicsBackend } from '#graphics/three/three-graphics-backend-context.jsx';
import {
  createGltfFatLineMaterial,
  createGltfFatLineSegmentsFromPositions,
} from '#graphics/three/materials/gltf-edges.js';
import { SceneOverlay } from '#graphics/three/scene-overlay.jsx';
import { setRaycasterFromCamera } from '#graphics/three/utils/raycaster-from-camera.js';
import { createRafCoalescer } from '#graphics/three/utils/raf-coalescer.js';
import { resolveSectionViewRaycastClip } from '#graphics/three/use-section-view.js';
import { planarFacePixelScale } from '#graphics/three/react/planar-face-gesture.js';
import { directEditEdges, pickDirectEditEdge } from '#graphics/three/react/direct-edit-geometry.js';
import {
  projectModelEdges,
  sketchEntitySamples,
  sketchSnapPoints,
  snapSketchPoint,
  toSketchPoint,
} from '#graphics/three/react/sketch-geometry.js';
import type { SketchSnap, SketchVec2, SketchVec3 } from '#graphics/three/react/sketch-geometry.js';
import { sketchGhostGeometry, sketchToRenderMatrix } from '#graphics/three/react/sketch-ghost-geometry.js';
import type { SketchTool } from '#graphics/three/react/sketch-tool.js';

/** Grid steps in millimetres; the finest one at least this many pixels apart is drawn and snapped to. */
const gridSteps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50] as const;
const gridMinimumPixels = 8;
/** How far, in pixels, the pointer reaches for a snap. */
const snapPixels = 9;
/** A press that moves less than this is a click; more is the camera's drag. */
const clickPixels = 5;
const doubleClickMilliseconds = 400;

type Polyline = ReadonlyArray<readonly [number, number, number]>;

/** Fat lines through sketch-millimetre polylines, placed by `matrix`; transient render resources. */
function useSketchLines({
  polylines,
  matrix,
  color,
  width,
  opacity = 1,
}: Readonly<{ polylines: readonly Polyline[]; matrix: Matrix4; color: number; width: number; opacity?: number }>):
  | Readonly<{ object: Object3D; setResolution: (width: number, height: number) => void }>
  | undefined {
  const backend = useThreeGraphicsBackend();
  const lines = useMemo(() => {
    const positions: number[] = [];
    for (const polyline of polylines) {
      for (let index = 0; index < polyline.length - 1; index++) {
        positions.push(...polyline[index]!, ...polyline[index + 1]!);
      }
    }
    if (positions.length === 0) {
      return undefined;
    }
    const material = createGltfFatLineMaterial({ backend, resolution: new Vector2(1, 1), edgeColor: color });
    material.linewidth = width;
    material.depthTest = false;
    material.depthWrite = false;
    material.toneMapped = false;
    material.transparent = opacity < 1;
    material.opacity = opacity;
    if ('edgePresentationLineWidth' in material) {
      material.edgePresentationLineWidth = width;
    }
    const line = createGltfFatLineSegmentsFromPositions({ backend, positions: new Float32Array(positions), material });
    if (!line) {
      material.dispose();
      return undefined;
    }
    line.matrixAutoUpdate = false;
    line.renderOrder = 960;
    return { line, material };
  }, [polylines, backend, color, width, opacity]);
  useLayoutEffect(() => {
    if (lines) {
      lines.line.matrix.copy(matrix);
      lines.line.matrixWorldNeedsUpdate = true;
    }
  }, [lines, matrix]);
  useEffect(
    () => () => {
      lines?.line.geometry.dispose();
      lines?.material.dispose();
    },
    [lines],
  );
  const setResolution = useCallback(
    (x: number, y: number) => {
      const material = lines?.material;
      if (material && 'resolution' in material && (material.resolution.x !== x || material.resolution.y !== y)) {
        material.resolution.set(x, y);
      }
    },
    [lines],
  );
  return lines ? { object: lines.line, setResolution } : undefined;
}

/** A transient translucent mesh placed by `matrix`; the geometry and material are owned and disposed here. */
function usePlacedMesh(
  geometry: BufferGeometry | undefined,
  matrix: Matrix4,
  look: Readonly<{ color: number; opacity: number; depthTest?: boolean; renderOrder: number }>,
): Mesh | undefined {
  const { color, opacity, depthTest = false, renderOrder } = look;
  const mesh = useMemo(() => {
    if (!geometry) {
      return undefined;
    }
    const placed = new Mesh(
      geometry,
      new MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        side: DoubleSide,
        depthTest,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    placed.matrixAutoUpdate = false;
    placed.raycast = () => undefined;
    placed.renderOrder = renderOrder;
    return placed;
  }, [geometry, color, opacity, depthTest, renderOrder]);
  useLayoutEffect(() => {
    if (mesh) {
      mesh.matrix.copy(matrix);
      mesh.matrixWorldNeedsUpdate = true;
    }
  }, [mesh, matrix]);
  useEffect(
    () => () => {
      mesh?.material.dispose();
    },
    [mesh],
  );
  useEffect(
    () => () => {
      geometry?.dispose();
    },
    [geometry],
  );
  return mesh;
}

/** The millimetre grid of the plane: minor lines at `step`, every tenth stronger. */
function gridGeometry(step: number, extent: number): Readonly<{ minor: BufferGeometry; major: BufferGeometry }> {
  const minor: number[] = [];
  const major: number[] = [];
  const count = Math.min(Math.ceil(extent / step), 400);
  const reach = count * step;
  for (let index = -count; index <= count; index++) {
    const value = index * step;
    const target = index % 10 === 0 ? major : minor;
    target.push(value, -reach, 0, value, reach, 0, -reach, value, 0, reach, value, 0);
  }
  const build = (positions: number[]): BufferGeometry => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    return geometry;
  };
  return { minor: build(minor), major: build(major) };
}

// Each viewport frame runs synchronously; these temporaries never escape the marker placement.
const markerPlacement = new Matrix4();
const markerScale = new Matrix4();

const toTuple = ({ x, y }: SketchVec2, height = 0): readonly [number, number, number] => [x, y, height];

/**
 * The sketch on the model: the plane's veil and millimetre grid, the entities, the closed regions, the ghost of the
 * operation, and the snapped pointer. Pointer clicks on the plane draw; a drag still turns the camera. Transient render
 * resources only: the host owns the sketch and commits it.
 * @internal
 */
export function SketchControls({
  tool,
  scene,
  getMeshes,
}: Readonly<{ tool: SketchTool; scene: Object3D; getMeshes: () => readonly Mesh[] }>): React.JSX.Element {
  const renderFrame = useRenderFrame();
  const graphics = useGraphics();
  const cameraRig = useCameraRig();
  const get = useThree((state) => state.get);
  const { frame } = tool;
  const matrix = useMemo(() => sketchToRenderMatrix(frame, renderFrame), [frame, renderFrame]);
  const inverse = useMemo(() => matrix.clone().invert(), [matrix]);
  const renderPlane = useMemo(() => {
    const origin = new Vector3().setFromMatrixPosition(matrix);
    const normal = new Vector3().setFromMatrixColumn(matrix, 2).normalize();
    return new Plane().setFromNormalAndCoplanarPoint(normal, origin);
  }, [matrix]);
  const projected = useMemo(() => {
    const toModel = (point: Vector3): SketchVec3 => {
      const metres = fromRenderPoint({ renderFrame, point: [point.x, point.y, point.z] });
      return [metres[0] * 1000, metres[1] * 1000, metres[2] * 1000];
    };
    return projectModelEdges(
      directEditEdges(scene).map((edge) => [toModel(edge.a), toModel(edge.b)] as const),
      frame,
    );
  }, [scene, frame, renderFrame]);
  const snapPoints = useMemo(
    () => [...sketchSnapPoints(tool.entities), ...projected.points],
    [tool.entities, projected.points],
  );
  const [gridStep, setGridStep] = useState(1);
  const [snap, setSnap] = useState<SketchSnap>();
  const millimetresPerPixel = useRef(0.1);
  const latest = useRef({ tool, snapPoints, projected, gridStep, inverse, renderPlane });
  useLayoutEffect(() => {
    latest.current = { tool, snapPoints, projected, gridStep, inverse, renderPlane };
  });

  // The camera turns to look straight at a newly chosen plane, its local Y up, framing the plane's extent.
  useEffect(() => {
    const { origin, normal, yDir } = latest.current.tool.frame;
    cameraRig.actorRef.send({
      type: 'setView',
      target: [origin[0] / 1000, origin[1] / 1000, origin[2] / 1000],
      direction: [...normal],
      up: [...yDir],
      verticalSpan: (latest.current.tool.extent * 2.4) / 1000,
    });
    get().invalidate();
  }, [tool.frameKey, cameraRig, get]);

  // Drawing on the plane is not choosing a piece: the model's hover stays off while the sketch is open.
  useEffect(() => {
    graphics.send({ type: 'beginViewerModelHoverSuppression', reason: 'toolOverlay', source: 'viewer' });
    return () => {
      graphics.send({ type: 'endViewerModelHoverSuppression', reason: 'toolOverlay', source: 'viewer' });
    };
  }, [graphics]);

  useEffect(() => {
    const { gl, events } = get();
    const element = events.connected instanceof HTMLElement ? events.connected : gl.domElement;
    const raycaster = new Raycaster();
    const ndcOf = (event: PointerEvent): Vector2 => {
      const rect = gl.domElement.getBoundingClientRect();
      return new Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
    };
    const snapAt = (event: PointerEvent): SketchSnap | undefined => {
      const { current } = latest;
      setRaycasterFromCamera(raycaster, ndcOf(event), get().camera);
      const hit = raycaster.ray.intersectPlane(current.renderPlane, new Vector3());
      if (!hit) {
        return undefined;
      }
      const local = hit.applyMatrix4(current.inverse);
      return snapSketchPoint({
        raw: { x: local.x, y: local.y },
        tolerance: snapPixels * millimetresPerPixel.current,
        points: current.snapPoints,
        segments: current.projected.segments,
        reference: current.tool.reference,
        grid: current.gridStep,
      });
    };
    let press: { x: number; y: number; id: number } | undefined;
    let lastClick: { x: number; y: number; time: number } | undefined;
    // One hover report per frame: the host re-renders on each.
    const hover = createRafCoalescer<SketchSnap>((snapped) => {
      latest.current.tool.onPointer({ type: 'move', snap: snapped, gridStep: latest.current.gridStep });
    });
    const move = (event: PointerEvent): void => {
      if (latest.current.tool.mode !== 'draw' || (event.buttons !== 0 && press === undefined)) {
        return;
      }
      if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > clickPixels) {
        // A drag turns the camera; the sketch neither follows nor clicks.
        press = undefined;
        return;
      }
      const snapped = snapAt(event);
      if (snapped) {
        setSnap(snapped);
        hover.schedule(snapped);
        get().invalidate();
      }
    };
    const down = (event: PointerEvent): void => {
      if (event.button === 0 && event.isPrimary) {
        press = { x: event.clientX, y: event.clientY, id: event.pointerId };
      }
    };
    const up = (event: PointerEvent): void => {
      const started = press;
      press = undefined;
      if (
        !started ||
        started.id !== event.pointerId ||
        Math.hypot(event.clientX - started.x, event.clientY - started.y) > clickPixels
      ) {
        return;
      }
      const { current } = latest;
      if (current.tool.mode === 'pickEdge') {
        const { camera, size } = get();
        setRaycasterFromCamera(raycaster, ndcOf(event), camera);
        const edge = pickDirectEditEdge({
          edges: directEditEdges(scene),
          raycaster,
          camera,
          height: size.height,
          meshes: getMeshes(),
          clipping: resolveSectionViewRaycastClip(graphics.getSnapshot().context, renderFrame),
        });
        if (edge) {
          current.tool.onPickEdge?.({
            componentId: edge.componentId,
            edgeId: edge.edgeId,
            point: fromRenderPoint({ renderFrame, point: [edge.point.x, edge.point.y, edge.point.z] }),
          });
        }
        return;
      }
      if (current.tool.mode !== 'draw') {
        return;
      }
      const snapped = snapAt(event);
      if (!snapped) {
        return;
      }
      // The click lands where the last hover said it would.
      hover.flush();
      const now = performance.now();
      const isDouble =
        lastClick !== undefined &&
        now - lastClick.time < doubleClickMilliseconds &&
        Math.hypot(event.clientX - lastClick.x, event.clientY - lastClick.y) <= clickPixels;
      lastClick = isDouble ? undefined : { x: event.clientX, y: event.clientY, time: now };
      current.tool.onPointer({ type: isDouble ? 'doubleClick' : 'click', snap: snapped, gridStep: current.gridStep });
      get().invalidate();
    };
    const leave = (): void => {
      setSnap(undefined);
    };
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerdown', down);
    element.addEventListener('pointerup', up);
    element.addEventListener('pointerleave', leave);
    return () => {
      hover.cancel();
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerdown', down);
      element.removeEventListener('pointerup', up);
      element.removeEventListener('pointerleave', leave);
    };
  }, [get, scene, getMeshes, graphics, renderFrame]);

  // The plane: a faint veil, its border and the grid.
  const extent = Math.max(tool.extent, gridStep * 10);
  const veilGeometry = useMemo(() => {
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      'position',
      new Float32BufferAttribute(
        [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0].map((value, index) =>
          index % 3 === 2 ? 0 : value * extent,
        ),
        3,
      ),
    );
    return geometry;
  }, [extent]);
  const veil = usePlacedMesh(veilGeometry, matrix, { color: manualSelectionColor, opacity: 0.07, renderOrder: 880 });
  const grid = useMemo(() => gridGeometry(gridStep, extent), [gridStep, extent]);
  const gridLines = useMemo(() => {
    const make = (geometry: BufferGeometry, opacity: number): LineSegments => {
      const line = new LineSegments(
        geometry,
        new LineBasicMaterial({
          color: manualHandleColor,
          transparent: true,
          opacity,
          depthTest: false,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      line.matrixAutoUpdate = false;
      line.raycast = () => undefined;
      line.renderOrder = 881;
      return line;
    };
    return [make(grid.minor, 0.14), make(grid.major, 0.3)] as const;
  }, [grid]);
  useLayoutEffect(() => {
    for (const line of gridLines) {
      line.matrix.copy(matrix);
      line.matrixWorldNeedsUpdate = true;
    }
  }, [gridLines, matrix]);
  useEffect(
    () => () => {
      for (const line of gridLines) {
        line.geometry.dispose();
        (line.material as LineBasicMaterial).dispose();
      }
    },
    [gridLines],
  );
  const border = useMemo<Polyline[]>(
    () => [
      [
        [-extent, -extent, 0],
        [extent, -extent, 0],
        [extent, extent, 0],
        [-extent, extent, 0],
        [-extent, -extent, 0],
      ],
    ],
    [extent],
  );
  const borderLines = useSketchLines({
    polylines: border,
    matrix,
    color: manualSelectionColor,
    width: 1.5,
    opacity: 0.7,
  });

  // What is drawn, what is being drawn, the axis and the curves of another sketch.
  const drawn = useMemo<Polyline[]>(
    () => tool.entities.map((entity) => sketchEntitySamples(entity).map((point) => toTuple(point))),
    [tool.entities],
  );
  const drawnLines = useSketchLines({ polylines: drawn, matrix, color: manualHandleColor, width: 2.5 });
  const pending = useMemo<Polyline[]>(
    () => (tool.pending ?? []).map((entity) => sketchEntitySamples(entity).map((point) => toTuple(point))),
    [tool.pending],
  );
  const pendingLines = useSketchLines({ polylines: pending, matrix, color: manualSelectionColor, width: 2 });
  const extras = useMemo<Polyline[]>(() => {
    const result: Polyline[] = [];
    if (tool.axis) {
      const { start, end } = tool.axis;
      const length = Math.hypot(end.x - start.x, end.y - start.y) || 1;
      const reach = extent * 2;
      const along = { x: (end.x - start.x) / length, y: (end.y - start.y) / length };
      result.push([
        [start.x - along.x * reach, start.y - along.y * reach, 0],
        [start.x + along.x * reach, start.y + along.y * reach, 0],
      ]);
    }
    for (const curve of tool.curves ?? []) {
      result.push(
        curve.map((point) => {
          const local = toSketchPoint(point, frame);
          return [local.x, local.y, local.height] as const;
        }),
      );
    }
    return result;
  }, [tool.axis, tool.curves, frame, extent]);
  const extraLines = useSketchLines({ polylines: extras, matrix, color: manualHandleColor, width: 1.5, opacity: 0.85 });
  const guide = useMemo<Polyline[]>(
    () => (snap?.guide ? [[toTuple(snap.guide.from), toTuple(snap.guide.to)]] : []),
    [snap?.guide],
  );
  const guideLines = useSketchLines({ polylines: guide, matrix, color: manualSelectionColor, width: 1, opacity: 0.8 });

  // Closed regions: the profile the operation will use.
  const regionGeometry = useMemo(() => {
    const positions: number[] = [];
    for (const polygon of tool.regions ?? []) {
      if (polygon.length < 3) {
        continue;
      }
      for (const triangle of ShapeUtils.triangulateShape(
        polygon.map(({ x, y }) => new Vector2(x, y)),
        [],
      )) {
        for (const index of triangle) {
          positions.push(polygon[index]!.x, polygon[index]!.y, 0);
        }
      }
    }
    if (positions.length === 0) {
      return undefined;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    return geometry;
  }, [tool.regions]);
  const region = usePlacedMesh(regionGeometry, matrix, { color: manualSelectionColor, opacity: 0.3, renderOrder: 950 });

  // The ghost: added material sits outside the solid; removed material shows through as an X-ray.
  const ghostGeometry = useMemo(
    () =>
      tool.ghost
        ? sketchGhostGeometry(tool.ghost, (point) => {
            const local = toSketchPoint(point, frame);
            return new Vector3(local.x, local.y, local.height);
          })
        : undefined,
    [tool.ghost, frame],
  );
  const isCut = tool.ghost?.cut === true;
  const ghost = usePlacedMesh(ghostGeometry, matrix, {
    color: manualSelectionColor,
    opacity: isCut ? 0.4 : 0.32,
    depthTest: !isCut,
    renderOrder: 955,
  });

  // The snap marker keeps its size on screen.
  const marker = useMemo(() => {
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      'position',
      new Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, -1, 0, 1, 1, 0, 1, 1, 0, -1, 1, 0, -1, 1, 0, -1, -1, 0], 3),
    );
    const line = new LineSegments(
      geometry,
      new LineBasicMaterial({ color: manualHandleColor, depthTest: false, depthWrite: false, toneMapped: false }),
    );
    line.matrixAutoUpdate = false;
    line.raycast = () => undefined;
    line.renderOrder = 970;
    return line;
  }, []);
  useEffect(
    () => () => {
      marker.geometry.dispose();
      marker.material.dispose();
    },
    [marker],
  );

  useFrame(({ camera, size }) => {
    const origin = new Vector3().setFromMatrixPosition(matrix);
    const scale = planarFacePixelScale(camera, origin, size.height) * renderFrame.metersPerRenderUnit * 1000;
    if (Number.isFinite(scale) && scale > 0) {
      millimetresPerPixel.current = scale;
      const step = gridSteps.find((candidate) => candidate / scale >= gridMinimumPixels) ?? gridSteps.at(-1)!;
      if (step !== gridStep) {
        setGridStep(step);
      }
    }
    for (const lines of [borderLines, drawnLines, pendingLines, extraLines, guideLines]) {
      lines?.setResolution(size.width, size.height);
    }
    const shown = snap !== undefined && snap.kind !== 'free' && tool.mode === 'draw';
    marker.visible = shown;
    if (shown) {
      const half = millimetresPerPixel.current * (snap.kind === 'grid' ? 2.5 : 4.5);
      marker.matrix
        .copy(matrix)
        .multiply(markerPlacement.makeTranslation(snap.point.x, snap.point.y, 0))
        .multiply(markerScale.makeScale(half, half, 1));
      marker.matrixWorldNeedsUpdate = true;
    }
  });

  return (
    <SceneOverlay overlayActive>
      {veil ? <primitive object={veil} /> : null}
      <primitive object={gridLines[0]} />
      <primitive object={gridLines[1]} />
      {borderLines ? <primitive object={borderLines.object} /> : null}
      {region ? <primitive object={region} /> : null}
      {ghost ? <primitive object={ghost} /> : null}
      {extraLines ? <primitive object={extraLines.object} /> : null}
      {drawnLines ? <primitive object={drawnLines.object} /> : null}
      {pendingLines ? <primitive object={pendingLines.object} /> : null}
      {guideLines ? <primitive object={guideLines.object} /> : null}
      <primitive object={marker} />
    </SceneOverlay>
  );
}
