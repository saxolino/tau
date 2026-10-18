import { Color, Fog, FogExp2, Material, Matrix4, OrthographicCamera, Vector2, Vector3 } from 'three';
import type { Scene, ShaderMaterial, Texture, WebGLRenderer, WebGLRenderTarget } from 'three';
import type { Pass } from 'postprocessing';
// @ts-expect-error -- n8ao 1.10.2 does not publish TypeScript declarations.
import { DepthType, N8AOPostPass } from 'n8ao';
import type { ThreeCamera } from '@taucad/three/camera';
import { sceneTransparencyRevision } from '#graphics/three/utils/scene-transparency-revision.js';

type FullscreenTriangle = { readonly material: ShaderMaterial; render(renderer: WebGLRenderer): void };

type N8AoPass = Pass & {
  configuration: {
    aoRadius: number;
    denoiseRadius: number;
    distanceFalloff: number;
    intensity: number;
    screenSpaceRadius: boolean;
    renderMode: number;
    transparencyAware: boolean;
    halfRes: boolean;
    aoTones: number;
    biasOffset: number;
    biasMultiplier: number;
    color: Color;
    colorMultiply: boolean;
    denoiseIterations: number;
    depthBufferType: number;
    gammaCorrection: boolean;
  };
  camera: ThreeCamera;
  width: number;
  height: number;
  autosetGamma: boolean;
  samples: Vector3[];
  samplesDenoise: Vector2[];
  bluenoise: Texture;
  depthTexture: Texture | undefined;
  writeTargetInternal: WebGLRenderTarget;
  readTargetInternal: WebGLRenderTarget;
  outputTargetInternal: WebGLRenderTarget;
  accumulationRenderTarget: WebGLRenderTarget;
  depthDownsampleTarget?: WebGLRenderTarget;
  transparencyRenderTargetDWFalse?: WebGLRenderTarget;
  transparencyRenderTargetDWTrue?: WebGLRenderTarget;
  effectShaderQuad: FullscreenTriangle;
  poissonBlurQuad: FullscreenTriangle;
  effectCompositerQuad: FullscreenTriangle;
  copyQuad: FullscreenTriangle;
  accumulationQuad: FullscreenTriangle;
  depthCopyPass?: FullscreenTriangle;
  depthDownsampleQuad?: FullscreenTriangle;
  detectTransparency(): void;
  configureTransparencyTarget(): void;
  configureHalfResTargets(): void;
  // eslint-disable-next-line @typescript-eslint/naming-convention -- Exact method name from the guarded N8AO dependency.
  configureAOPass(depthBufferType: number, orthographic: boolean): void;
  configureDenoisePass(depthBufferType: number, orthographic: boolean): void;
  configureEffectCompositer(depthBufferType: number, orthographic: boolean): void;
  renderTransparency(renderer: WebGLRenderer): void;
};

// Render orchestration adapted from N8AO 1.10.2 src/N8AOPostPass.js; shaders stay upstream.
// https://github.com/N8python/n8ao/blob/d3dd84bdb4e66b1f78bc7946e98b50f4e90dd19e/src/N8AOPostPass.js
// Its distributed LICENSE is CC0-1.0 (package.json labels it ISC). The source-map hash
// and depth constants are guarded by n8ao-pass.test.ts. No workspace patch is needed here.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The untyped dependency constructor is constrained to the fields verified by the installed-source test.
const n8AoConstructor = N8AOPostPass as unknown as new (scene: Scene, camera: ThreeCamera) => N8AoPass;
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Guarded exported constants from the same untyped dependency.
const depthTypes = DepthType as { Default: number; Log: number; Reverse: number };

/** Assign native shader uniforms without replacing their owned uniform objects. */
const setUniforms = (quad: FullscreenTriangle, values: Readonly<Record<string, unknown>>): void => {
  for (const name of Object.keys(values)) {
    quad.material.uniforms[name]!.value = values[name];
  }
};

/** Owns spatial N8AO and publishes its composite target for the viewer's output pass. */
export class ManagedN8AoPass extends n8AoConstructor {
  // The base constructor calls detectTransparency before finishing its target setup.
  // Defer detection to the first render to avoid allocating the transparency targets twice.
  private readonly isReady: boolean;
  private isDisposed = false;
  private isRendering = false;
  private classifiedThisFrame = false;
  private transparencyRevision: number | undefined;
  private readonly resolution = new Vector2();
  private readonly aoResolution = new Vector2();
  private readonly cameraPosition = new Vector3();
  private readonly projectionView = new Matrix4();
  private readonly biasAdjustment = new Vector2();
  private readonly aoColor = new Color();

  public constructor(scene: Scene, camera: ThreeCamera) {
    super(scene, camera);
    // The terminal pass reads outputTargetInternal directly; no composer swap or copy.
    this.needsSwap = false;
    this.isReady = true;
  }

  // oxlint-disable-next-line eslint/max-params -- Preserve postprocessing Pass.render's upstream signature.
  public override render(
    renderer: WebGLRenderer,
    inputBuffer: WebGLRenderTarget,
    _outputBuffer: WebGLRenderTarget,
    _deltaTime?: number,
    _stencilTest?: boolean,
  ): void {
    const xrEnabled = renderer.xr.enabled;
    const { autoClear } = renderer;
    renderer.xr.enabled = false;
    this.isRendering = true;
    this.classifiedThisFrame = false;
    try {
      const depthType = renderer.capabilities.logarithmicDepthBuffer
        ? depthTypes.Log
        : renderer.capabilities.reversedDepthBuffer
          ? depthTypes.Reverse
          : depthTypes.Default;
      if (this.configuration.depthBufferType !== depthType) {
        this.configuration.depthBufferType = depthType;
        const orthographic = this.camera instanceof OrthographicCamera;
        this.configureAOPass(depthType, orthographic);
        this.configureDenoisePass(depthType, orthographic);
        this.configureEffectCompositer(depthType, orthographic);
      }
      this.detectTransparency();
      this.camera.updateMatrixWorld();
      if (this.configuration.transparencyAware) {
        this.renderTransparency(renderer);
      }
      const output = this.outputTargetInternal.texture;
      if (output.type !== inputBuffer.texture.type || output.format !== inputBuffer.texture.format) {
        output.type = inputBuffer.texture.type;
        output.format = inputBuffer.texture.format;
        output.needsUpdate = true;
      }
      this.camera.getWorldPosition(this.cameraPosition);
      this.resolution.set(this.width, this.height);
      this.aoResolution
        .copy(this.resolution)
        .multiplyScalar(this.configuration.halfRes ? 0.5 : 1)
        .floor();
      const radius =
        this.configuration.aoRadius * (this.configuration.halfRes && this.configuration.screenSpaceRadius ? 0.5 : 1);
      this.renderSpatialAo(renderer, inputBuffer, radius);
      this.renderComposite(renderer, inputBuffer, radius);
    } finally {
      renderer.autoClear = autoClear;
      renderer.xr.enabled = xrEnabled;
      this.isRendering = false;
    }
  }

  public override detectTransparency(): void {
    if (!this.isReady) {
      return;
    }
    const revision = sceneTransparencyRevision(this.scene);
    if (this.isRendering && this.classifiedThisFrame) {
      return;
    }
    if (this.isRendering) {
      this.classifiedThisFrame = true;
    }
    if (this.isRendering && revision !== undefined && revision === this.transparencyRevision) {
      return;
    }

    let hasTransparency = false;
    this.scene.traverseVisible((object) => {
      if (!('material' in object)) {
        return;
      }
      const materials: unknown[] = Array.isArray(object.material) ? object.material : [object.material];
      if (
        materials.some(
          (material) =>
            material instanceof Material &&
            material.visible &&
            ((material.transparent && object.userData['treatAsOpaque'] !== true) ||
              object.userData['cannotReceiveAO'] === true),
        )
      ) {
        hasTransparency = true;
      }
    });
    // Isolation changes material transparency in place. Owned scenes notify semantic
    // changes; unknown scenes retain classification on each requested frame.
    this.configuration.transparencyAware = hasTransparency;
    this.transparencyRevision = revision;
  }

  public override configureTransparencyTarget(): void {
    if (!this.configuration.transparencyAware && this.depthCopyPass) {
      // FullScreenTriangle.dispose also disposes geometry shared by every N8AO endpoint.
      this.depthCopyPass.material.dispose();
      this.depthCopyPass = undefined;
    }
    super.configureTransparencyTarget();
  }

  public override configureHalfResTargets(): void {
    if (!this.configuration.halfRes && this.depthDownsampleQuad) {
      // Half-resolution toggles must preserve the same shared fullscreen geometry.
      this.depthDownsampleQuad.material.dispose();
      this.depthDownsampleQuad = undefined;
    }
    super.configureHalfResTargets();
    if (this.depthDownsampleTarget) {
      // Upstream puts depthBuffer on its textures; this flag belongs to the MRT owner.
      this.depthDownsampleTarget.depthBuffer = false;
    }
  }

  public override dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this.isDisposed = true;
    for (const quad of [
      this.effectShaderQuad,
      this.poissonBlurQuad,
      this.effectCompositerQuad,
      this.copyQuad,
      this.accumulationQuad,
      this.depthCopyPass,
      this.depthDownsampleQuad,
    ]) {
      quad?.material.dispose();
    }
    // Pass.dispose only finds direct resources, missing N8AO's wrapped materials.
    // It would also dispose this borrowed texture, which belongs to EffectComposer.
    this.depthTexture = undefined;
    super.dispose();
  }

  private renderSpatialAo(renderer: WebGLRenderer, inputBuffer: WebGLRenderTarget, radius: number): void {
    const { configuration, camera } = this;
    if (configuration.halfRes) {
      setUniforms(this.depthDownsampleQuad!, {
        sceneDepth: this.depthTexture,
        resolution: this.resolution,
        near: camera.near,
        far: camera.far,
        projectionMatrixInv: camera.projectionMatrixInverse,
        viewMatrixInv: camera.matrixWorld,
        logDepth: configuration.depthBufferType === depthTypes.Log,
        ortho: camera instanceof OrthographicCamera,
      });
      renderer.setRenderTarget(this.depthDownsampleTarget!);
      this.depthDownsampleQuad!.render(renderer);
    }
    const depth = configuration.halfRes ? this.depthDownsampleTarget!.textures[0] : this.depthTexture;
    setUniforms(this.effectShaderQuad, {
      sceneDiffuse: inputBuffer.texture,
      sceneDepth: depth,
      sceneNormal: configuration.halfRes ? this.depthDownsampleTarget!.textures[1] : null,
      projMat: camera.projectionMatrix,
      viewMat: camera.matrixWorldInverse,
      projViewMat: this.projectionView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
      projectionMatrixInv: camera.projectionMatrixInverse,
      viewMatrixInv: camera.matrixWorld,
      cameraPos: this.cameraPosition,
      biasAdjustment: this.biasAdjustment.set(configuration.biasOffset, configuration.biasMultiplier),
      resolution: this.aoResolution,
      time: performance.now() / 1000,
      samples: this.samples,
      bluenoise: this.bluenoise,
      radius,
      distanceFalloff: configuration.distanceFalloff,
      near: camera.near,
      far: camera.far,
      ortho: camera instanceof OrthographicCamera,
      screenSpaceRadius: configuration.screenSpaceRadius,
      // Viewer AO is spatial: no history is reused across camera or model motion.
      frame: 0,
    });
    renderer.setRenderTarget(this.writeTargetInternal);
    this.effectShaderQuad.render(renderer);
    for (let index = 0; index < configuration.denoiseIterations; index++) {
      [this.writeTargetInternal, this.readTargetInternal] = [this.readTargetInternal, this.writeTargetInternal];
      setUniforms(this.poissonBlurQuad, {
        tDiffuse: this.readTargetInternal.texture,
        sceneDepth: depth,
        projMat: camera.projectionMatrix,
        viewMat: camera.matrixWorldInverse,
        projectionMatrixInv: camera.projectionMatrixInverse,
        viewMatrixInv: camera.matrixWorld,
        cameraPos: this.cameraPosition,
        resolution: this.aoResolution,
        time: performance.now() / 1000,
        blueNoise: this.bluenoise,
        radius: configuration.denoiseRadius * (configuration.halfRes ? 0.5 : 1),
        worldRadius: radius,
        distanceFalloff: configuration.distanceFalloff,
        index,
        poissonDisk: this.samplesDenoise,
        near: camera.near,
        far: camera.far,
        screenSpaceRadius: configuration.screenSpaceRadius,
      });
      renderer.setRenderTarget(this.writeTargetInternal);
      this.poissonBlurQuad.render(renderer);
    }
    if (configuration.halfRes) {
      // Native accumulation replaces alpha with 1 at frame zero. Half-res upsampling
      // reads .gba as a normal, so retain that behavior until separately qualified.
      const { autoClear } = renderer;
      renderer.autoClear = false;
      renderer.setRenderTarget(this.accumulationRenderTarget);
      setUniforms(this.accumulationQuad, { tDiffuse: this.writeTargetInternal.texture, frame: 0 });
      this.accumulationQuad.render(renderer);
      renderer.autoClear = autoClear;
    }
  }

  private renderComposite(renderer: WebGLRenderer, inputBuffer: WebGLRenderTarget, radius: number): void {
    const { configuration, camera } = this;
    setUniforms(this.effectCompositerQuad, {
      // eslint-disable-next-line @typescript-eslint/naming-convention -- Exact upstream shader uniform name.
      transparencyDWFalse: this.transparencyRenderTargetDWFalse?.texture ?? null,
      // eslint-disable-next-line @typescript-eslint/naming-convention -- Exact upstream shader uniform name.
      transparencyDWTrue: this.transparencyRenderTargetDWTrue?.texture ?? null,
      // eslint-disable-next-line @typescript-eslint/naming-convention -- Exact upstream shader uniform name.
      transparencyDWTrueDepth: this.transparencyRenderTargetDWTrue?.depthTexture ?? null,
      transparencyAware: configuration.transparencyAware,
      sceneDiffuse: inputBuffer.texture,
      sceneDepth: this.depthTexture,
      aoTones: configuration.aoTones,
      near: camera.near,
      far: camera.far,
      projectionMatrixInv: camera.projectionMatrixInverse,
      viewMatrixInv: camera.matrixWorld,
      ortho: camera instanceof OrthographicCamera,
      downsampledDepth: configuration.halfRes ? this.depthDownsampleTarget!.textures[0] : this.depthTexture,
      resolution: this.resolution,
      blueNoise: this.bluenoise,
      intensity: configuration.intensity,
      renderMode: configuration.renderMode,
      screenSpaceRadius: configuration.screenSpaceRadius,
      radius,
      distanceFalloff: configuration.distanceFalloff,
      gammaCorrection: this.autosetGamma ? this.renderToScreen : configuration.gammaCorrection,
      tDiffuse: configuration.halfRes ? this.accumulationRenderTarget.texture : this.writeTargetInternal.texture,
      color: this.aoColor.copy(configuration.color).convertSRGBToLinear(),
      colorMultiply: configuration.colorMultiply,
      cameraPos: this.cameraPosition,
      fog: this.scene.fog !== null,
    });
    if (this.scene.fog instanceof Fog) {
      setUniforms(this.effectCompositerQuad, {
        fogExp: false,
        fogNear: this.scene.fog.near,
        fogFar: this.scene.fog.far,
      });
    } else if (this.scene.fog instanceof FogExp2) {
      setUniforms(this.effectCompositerQuad, { fogExp: true, fogDensity: this.scene.fog.density });
    }
    renderer.setRenderTarget(this.outputTargetInternal);
    this.effectCompositerQuad.render(renderer);
  }
}
