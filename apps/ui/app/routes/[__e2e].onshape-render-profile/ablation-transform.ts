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
      'const scenePass = pass(scene, camera);',
      `const scenePass = pass(scene, camera,
      tauAblation.has('sceneSamples') ? { samples: Number(tauAblation.get('sceneSamples')) } : {});
    scene.userData.calibrationScenePass = scenePass;`,
    );
    replace('if (withAo) {', "if (withAo || tauAblation.get('abl') === 'mrt') {");
    replace(
      'if (!withAo) {',
      `if (!withAo) {
      if (tauAblation.get('abl') === 'mrt') scenePass.getTexture('normal').type = UnsignedByteType;`,
    );
    replace(
      'outputQuad = createOutputQuad(createViewportFxaa(antialiasInput));\n      return',
      `outputQuad = createOutputQuad(tauAblation.get('aa') === 'off'
        ? renderOutput(scenePassColor, toneMapping, LinearSRGBColorSpace)
        : createViewportFxaa(antialiasInput));\n      return`,
    );
    replace(
      'denoiseNode.upsample(denoiseInput, screenUV),',
      `tauAblation.get('abl') === 'raw-ao' ? aoTexture.sample(screenUV).r
        : tauAblation.get('abl') === 'filtered-ao' ? denoiseInput.sample(screenUV).r
        : denoiseNode.upsample(denoiseInput, screenUV),`,
    );
    replace(
      'outputQuad = createOutputQuad(createViewportFxaa(antialiasInput));',
      "outputQuad = createOutputQuad(tauAblation.get('aa') === 'off' ? composite : createViewportFxaa(antialiasInput));",
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
      `if (tauAblation.get('samples') === '0') Object.assign(options, { antialias: false, samples: 0 });
    if (tauAblation.get('nodegl') === '1') Object.assign(options, { forceWebGL: true, reversedDepthBuffer: false });
    const renderer = new ThreeWebGPURenderer(options);`,
    );
    replace(
      'if (renderer.coordinateSystem !== THREE.WebGPUCoordinateSystem) {',
      "if (tauAblation.get('nodegl') !== '1' && renderer.coordinateSystem !== THREE.WebGPUCoordinateSystem) {",
    );
    replace(
      'renderer.setTransparentSort(reversedDepthTransparentSort);',
      'if (renderer.reversedDepthBuffer) renderer.setTransparentSort(reversedDepthTransparentSort);',
    );
  } else if (file.endsWith('/graphics/three/scene-overlay.tsx')) {
    replace('restoreDepth();', "if (tauAblation.get('depthRestore') !== 'off') restoreDepth();");
  } else if (file.endsWith('/graphics/three/materials/infinite-grid-material.node.ts')) {
    replace(
      'material.outputNode = compositeOverViewportSrgb(material.colorNode.rgb, material.colorNode.a, viewportTexture());\n  material.blending = NoBlending;',
      `if (tauAblation.get('overlayBlend') !== 'linear') {
        material.outputNode = compositeOverViewportSrgb(material.colorNode.rgb, material.colorNode.a, viewportTexture());
        material.blending = NoBlending;
      }`,
    );
  } else if (file.endsWith('/graphics/three/materials/line2.material.ts')) {
    replace(
      'if (self.transparent && self.useViewportSrgbBlend !== false) {',
      "if (self.transparent && self.useViewportSrgbBlend !== false && tauAblation.get('overlayBlend') !== 'linear') {",
    );
  } else if (file.endsWith('/[__e2e].onshape-render-profile/route.tsx')) {
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
      ablation: Object.fromEntries(tauAblation),
      scenePassSamples: scene.userData.calibrationScenePass?.renderTarget.samples,
      geometryHash:`,
    );
  } else {
    return undefined;
  }
  return prelude + code;
}
