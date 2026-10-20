/**
 * Calibration-server-only source experiment. No product module imports this file.
 * Each unique source anchor is checked, so an upstream edit fails rather than
 * silently measuring a different graph. URL choices are fixed until page reload.
 */
export function transformRenderingAblation(source: string, id: string): string | undefined {
  const file = id.split('?')[0] ?? id;
  let code = source;
  const replace = (before: string, after: string): void => {
    if (code.split(before).length !== 2) {
      throw new Error(`Rendering ablation anchor drift in ${file}: ${before}`);
    }
    code = code.replace(before, after);
  };
  const prelude = `const tauAblation = new URLSearchParams(globalThis.location.search);\n`;
  if (file.endsWith('/graphics/three/post-processing-webgpu.tsx')) {
    replace(
      'const compactFrame = toneMapping === NeutralToneMapping;',
      "const compactFrame = tauAblation.get('frameStorage') !== 'half' && toneMapping === NeutralToneMapping;",
    );
    replace(
      'const compactNormals = gpuRenderer.coordinateSystem !== WebGLCoordinateSystem;',
      "const compactNormals = tauAblation.get('normalStorage') === 'rgba' ? false : tauAblation.get('normalStorage') === 'rg' ? true : gpuRenderer.coordinateSystem !== WebGLCoordinateSystem;",
    );
    replace(
      'const scenePass = pass(scene, camera, { samples: 0 });',
      `const scenePass = pass(scene, camera,
      tauAblation.has('sceneSamples') ? { samples: Number(tauAblation.get('sceneSamples')) } : { samples: 0 });
    scene.userData.calibrationScenePass = scenePass;`,
    );
    replace('if (withAo) {', "if (withAo || tauAblation.get('abl') === 'mrt') {");
    replace(
      'if (!withAo) {',
      `if (!withAo) {
      if (tauAblation.get('abl') === 'mrt') scenePass.getTexture('normal').type = UnsignedByteType;`,
    );
    replace(
      'denoiseInput.sample(screenUV).r,',
      `tauAblation.get('abl') === 'raw-ao' ? aoTexture.sample(screenUV).r
        : tauAblation.get('abl') === 'bilateral-ao' ? denoiseNode.upsample(denoiseInput, screenUV)
        : denoiseInput.sample(screenUV).r,`,
    );
    replace(
      "const withAo = aoAllowed && aoEnabled && displayMode !== 'no-ao';",
      `const withAo = aoAllowed && aoEnabled && displayMode !== 'no-ao'
        && !['beauty', 'mrt'].includes(tauAblation.get('abl') ?? '');`,
    );
  } else if (file.endsWith('/graphics/three/post-processing.tsx')) {
    replace(
      "gl.toneMapping = backend === 'webgpu' ? NoToneMapping : rendererToneMappingModes[toneMapping];",
      "gl.toneMapping = backend === 'webgpu' && tauAblation.get('abl') !== 'direct' ? NoToneMapping : rendererToneMappingModes[toneMapping];",
    );
    replace(
      "if (backend === 'webgpu') {",
      "if (tauAblation.get('abl') === 'direct') return <MainSceneFallback />;\n  if (backend === 'webgpu') {",
    );
  } else if (file.endsWith('/graphics/three/renderer.ts')) {
    replace(
      'const renderer = new ThreeWebGPURenderer(options);',
      `if (['0', '4'].includes(tauAblation.get('samples') ?? '')) Object.assign(options, { antialias: tauAblation.get('samples') === '4', samples: Number(tauAblation.get('samples')) });
    if (tauAblation.get('nodegl') === '1') Object.assign(options, { forceWebGL: true, reversedDepthBuffer: false });
    const renderer = new ThreeWebGPURenderer(options);`,
    );
    replace(
      'if (renderer.coordinateSystem !== THREE.WebGPUCoordinateSystem) {',
      "if (tauAblation.get('nodegl') !== '1' && renderer.coordinateSystem !== THREE.WebGPUCoordinateSystem) {",
    );
    code =
      `import { installAllocationLedger } from '/app/routes/[__e2e].onshape-render-profile/allocation-ledger.ts';\n` +
      code;
    replace(
      "if (useCase === 'viewport') {\n      // NodeRenderer",
      "if (tauAblation.has('ledger')) installAllocationLedger(renderer, tauAblation.get('passCost') ?? undefined);\n    if (useCase === 'viewport') {\n      // NodeRenderer",
    );
    replace(
      'renderer.setTransparentSort(reversedDepthTransparentSort);',
      'if (renderer.reversedDepthBuffer) renderer.setTransparentSort(reversedDepthTransparentSort);',
    );
  } else if (file.endsWith('/graphics/three/react/model-emphasis-overlay.tsx')) {
    replace('croppedMask = true,', "croppedMask = tauAblation.get('maskRegion') !== 'full',");
    replace('fuseNativeClear = true,', "fuseNativeClear = tauAblation.get('nativeClear') !== 'separate',");
    replace('boundedComposite = true,', "boundedComposite = tauAblation.get('compositeRegion') !== 'full',");
    replace(
      "depthTexture: backend === 'webgpu' ? null : new DepthTexture(1, 1, UnsignedIntType),",
      "depthTexture: backend === 'webgpu' && tauAblation.get('maskDepthStorage') !== 'resolved' ? null : new DepthTexture(1, 1, UnsignedIntType),",
    );
    replace(
      'previousTarget.samples <= 1 &&',
      "tauAblation.get('maskDepth') !== 'separate' && previousTarget.samples <= 1 &&",
    );
    replace(
      'const both = set.hover.length > 0 && set.selected.length > 0;',
      "const both = tauAblation.get('maskStorage') === 'rgba' || (set.hover.length > 0 && set.selected.length > 0);",
    );
  } else if (file.endsWith('/graphics/three/react/gltf-mesh.tsx')) {
    replace(
      'setModelEmphasisSet(rootScene, emphasised);',
      `const calibrationMode = tauAblation.get('emphasis');
      const calibrationMeshes = calibrationMode ? getComponentInventory(scene).filter((object): object is Mesh => isSurfaceObject(object)) : [];
      const calibrationIndex = Number(tauAblation.get('emphasisIndex') ?? 0);
      if (!Number.isSafeInteger(calibrationIndex) || calibrationIndex < 0 || (calibrationMeshes.length > 0 && calibrationIndex >= calibrationMeshes.length)) throw new Error('Invalid calibration emphasisIndex');
      const calibrationEmphasis = calibrationMode ? {
        hover: calibrationMode === 'hover' || calibrationMode === 'both' ? calibrationMeshes.slice(1, 2) : [],
        selected: calibrationMode === 'selected' || calibrationMode === 'both' ? calibrationMeshes.slice(calibrationIndex, calibrationIndex + 1) : [],
      } : emphasised;
      if (calibrationMode) rootScene.userData.calibrationEmphasis = { mode: calibrationMode, selectedIndex: calibrationIndex, hover: calibrationEmphasis.hover.map((mesh) => mesh.name), selected: calibrationEmphasis.selected.map((mesh) => mesh.name) };
      setModelEmphasisSet(rootScene, calibrationEmphasis);`,
    );
  } else if (file.endsWith('/graphics/three/scene-overlay.tsx')) {
    replace('restoreDepth();', "if (tauAblation.get('depthRestore') !== 'off') restoreDepth();");
  } else if (file.endsWith('/[__e2e].onshape-render-profile/route.tsx')) {
    code =
      `import { readAllocationLedgers, resetAllocationCosts } from '/app/routes/[__e2e].onshape-render-profile/allocation-ledger.ts';\n` +
      code;
    replace(
      'if (current.frame >= 30 && current.samples.length < 300) {',
      "if (tauAblation.has('passCost') && current.frame === 30) resetAllocationCosts();\n      if (current.frame >= 30 && current.samples.length < 300) {",
    );
    replace(
      'current.drainStarted = now;',
      "current.drainStarted = now;\n        if (tauAblation.has('passCost')) resetAllocationCosts(false);",
    );
    replace(
      'current.gpuPassRanges.slice(0, 16)',
      "current.gpuPassRanges.slice(0, tauAblation.has('ledger') ? undefined : 16)",
    );
    replace('enableGrid={overlay}', "enableGrid={overlay && tauAblation.get('overlay') !== 'axes'}");
    replace('enableAxes={overlay}', "enableAxes={overlay && tauAblation.get('overlay') !== 'grid'}");
    replace(
      'const [overlay, setOverlay] = useState(false);',
      "const [overlay, setOverlay] = useState(tauAblation.has('overlay'));",
    );
    replace(
      "useState('f6-authored-planetary')",
      "useState(tauAblation.has('abl') ? 'f8-native-build123d-planetary' : 'f6-authored-planetary')",
    );
    replace('span: 0.22,', "span: tauAblation.get('view') === 'close' ? 0.09 : 0.22,");
    replace(
      'const [edges, setEdges] = useState(true);',
      "const [edges, setEdges] = useState(tauAblation.get('edges') !== 'off');",
    );
    replace(
      'const [viewportWidth, setViewportWidth] = useState(1276);',
      "const [viewportWidth, setViewportWidth] = useState(tauAblation.has('abl') ? 2560 : 1276);",
    );
    replace(
      'const [viewportHeight, setViewportHeight] = useState(798);',
      "const [viewportHeight, setViewportHeight] = useState(tauAblation.has('abl') ? 1440 : 798);",
    );
    replace("graphicsBackend: 'webgl',", "graphicsBackend: tauAblation.has('abl') ? 'webgpu' : 'webgl',");
    replace(
      '...metadata,\n      geometryHash:',
      `...metadata,
      emphasis: scene.userData.calibrationEmphasis,
      allocationLedger: tauAblation.has('ledger') ? readAllocationLedgers() : undefined,
      ablation: Object.fromEntries(tauAblation),
      scenePassSamples: scene.userData.calibrationScenePass?.renderTarget.samples,
      geometryHash:`,
    );
  } else {
    return undefined;
  }
  return prelude + code;
}
