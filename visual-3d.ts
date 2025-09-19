/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// tslint:disable:organize-imports
// tslint:disable:ban-malformed-import-paths
// tslint:disable:no-new-decorators

import {LitElement, css, html} from 'lit';
import {customElement, property} from 'lit/decorators.js';
import {Analyser} from './analyser';

import * as THREE from 'three';
import {EXRLoader} from 'three/addons/loaders/EXRLoader.js';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {ShaderPass} from 'three/addons/postprocessing/ShaderPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {FXAAShader} from 'three/addons/shaders/FXAAShader.js';
import {fs as backdropFS, vs as backdropVS} from './backdrop-shader';
import {vs as sphereVS} from './sphere-shader';

/**
 * 3D live audio visual.
 */
@customElement('gdm-live-audio-visuals-3d')
export class GdmLiveAudioVisuals3D extends LitElement {
  private inputAnalyser!: Analyser;
  private outputAnalyser!: Analyser;
  private camera!: THREE.PerspectiveCamera;
  private backdrop!: THREE.Mesh;
  private composer!: EffectComposer;
  private sphere!: THREE.Mesh;
  private prevTime = 0;
  private rotation = new THREE.Vector3(0, 0, 0);
  private bloomPass!: UnrealBloomPass;
  private particles!: THREE.Points;
  private particleOriginalPositions!: Float32Array;
  private particleVelocities!: Float32Array;
  private cameraTarget = new THREE.Vector3(2, -2, 5);

  private _outputNode!: AudioNode;

  @property()
  set outputNode(node: AudioNode) {
    this._outputNode = node;
    this.outputAnalyser = new Analyser(this._outputNode);
  }

  get outputNode() {
    return this._outputNode;
  }

  private _inputNode!: AudioNode;

  @property()
  set inputNode(node: AudioNode) {
    this._inputNode = node;
    this.inputAnalyser = new Analyser(this._inputNode);
  }

  get inputNode() {
    return this._inputNode;
  }

  private canvas!: HTMLCanvasElement;

  static styles = css`
    canvas {
      width: 100% !important;
      height: 100% !important;
      position: absolute;
      inset: 0;
      image-rendering: pixelated;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
  }

  private init() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x100c14);

    const backdrop = new THREE.Mesh(
      new THREE.IcosahedronGeometry(10, 5),
      new THREE.RawShaderMaterial({
        uniforms: {
          resolution: {value: new THREE.Vector2(1, 1)},
          rand: {value: 0},
        },
        vertexShader: backdropVS,
        fragmentShader: backdropFS,
        glslVersion: THREE.GLSL3,
      }),
    );
    backdrop.material.side = THREE.BackSide;
    scene.add(backdrop);
    this.backdrop = backdrop;

    const camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000,
    );
    camera.position.set(2, -2, 5);
    this.camera = camera;

    const renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: !true,
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio / 1);

    const geometry = new THREE.IcosahedronGeometry(1, 10);

    new EXRLoader().load('piz_compressed.exr', (texture: THREE.Texture) => {
      texture.mapping = THREE.EquirectangularReflectionMapping;
      const exrCubeRenderTarget = pmremGenerator.fromEquirectangular(texture);
      sphereMaterial.envMap = exrCubeRenderTarget.texture;
      sphere.visible = true;
    });

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();

    const sphereMaterial = new THREE.MeshStandardMaterial({
      color: 0x000010,
      metalness: 0.5,
      roughness: 0.1,
      emissive: 0x000010,
      emissiveIntensity: 1.5,
    });

    sphereMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.time = {value: 0};
      shader.uniforms.inputData = {value: new THREE.Vector4()};
      shader.uniforms.outputData = {value: new THREE.Vector4()};

      sphereMaterial.userData.shader = shader;

      shader.vertexShader = sphereVS;
    };

    const sphere = new THREE.Mesh(geometry, sphereMaterial);
    scene.add(sphere);
    sphere.visible = false;

    this.sphere = sphere;

    const renderPass = new RenderPass(scene, camera);

    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      1.5,
      0.4,
      0.85,
    );
    this.bloomPass = bloomPass;

    const fxaaPass = new ShaderPass(FXAAShader);

    const composer = new EffectComposer(renderer);
    composer.addPass(renderPass);
    // composer.addPass(fxaaPass);
    composer.addPass(bloomPass);

    this.composer = composer;

    const particleCount = 5000;
    const particleGeometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    this.particleOriginalPositions = new Float32Array(particleCount * 3);
    this.particleVelocities = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    const baseColor = new THREE.Color(0x4dd0e1); // Cyan

    for (let i = 0; i < particleCount; i++) {
      const i3 = i * 3;
      // Position particles in a spherical shell
      const r = 4 + Math.random() * 4;
      const phi = Math.acos(2 * Math.random() - 1);
      const theta = Math.random() * Math.PI * 2;

      const x = r * Math.cos(theta) * Math.sin(phi);
      const y = r * Math.sin(theta) * Math.sin(phi);
      const z = r * Math.cos(phi);

      positions[i3] = x;
      positions[i3 + 1] = y;
      positions[i3 + 2] = z;

      this.particleOriginalPositions[i3] = x;
      this.particleOriginalPositions[i3 + 1] = y;
      this.particleOriginalPositions[i3 + 2] = z;

      this.particleVelocities[i3] = 0;
      this.particleVelocities[i3 + 1] = 0;
      this.particleVelocities[i3 + 2] = 0;

      baseColor.toArray(colors, i3);
    }

    particleGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(positions, 3),
    );
    particleGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const particleMaterial = new THREE.PointsMaterial({
      size: 0.05,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      transparent: true,
      opacity: 0.7,
      sizeAttenuation: true,
    });

    this.particles = new THREE.Points(particleGeometry, particleMaterial);
    scene.add(this.particles);

    function onWindowResize() {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      const dPR = renderer.getPixelRatio();
      const w = window.innerWidth;
      const h = window.innerHeight;
      backdrop.material.uniforms.resolution.value.set(w * dPR, h * dPR);
      renderer.setSize(w, h);
      composer.setSize(w, h);
      fxaaPass.material.uniforms['resolution'].value.set(
        1 / (w * dPR),
        1 / (h * dPR),
      );
    }

    window.addEventListener('resize', onWindowResize);
    onWindowResize();

    this.animation();
  }

  private getAudioFeatures(data: Uint8Array) {
    const bass = (data[0] + data[1] + data[2] + data[3]) / 4;
    const mids =
      (data[4] + data[5] + data[6] + data[7] + data[8] + data[9] + data[10]) /
      7;
    const highs = (data[11] + data[12] + data[13] + data[14] + data[15]) / 5;
    let volume = 0;
    for (let i = 0; i < data.length; i++) {
      volume += data[i];
    }
    volume /= data.length;
    return {bass, mids, highs, volume};
  }

  private animation() {
    requestAnimationFrame(() => this.animation());

    this.inputAnalyser.update();
    this.outputAnalyser.update();

    const inputFeatures = this.getAudioFeatures(this.inputAnalyser.data);
    const outputFeatures = this.getAudioFeatures(this.outputAnalyser.data);

    const normSummedBass =
      (inputFeatures.bass + outputFeatures.bass) / (255 * 2);
    const normSummedMids =
      (inputFeatures.mids + outputFeatures.mids) / (255 * 2);
    const normSummedHighs =
      (inputFeatures.highs + outputFeatures.highs) / (255 * 2);
    const normSummedVolume =
      (inputFeatures.volume + outputFeatures.volume) / (255 * 2);

    const t = performance.now();
    const dt = Math.min(1.0, (t - this.prevTime) / (1000 / 60));
    this.prevTime = t;
    const backdropMaterial = this.backdrop.material as THREE.RawShaderMaterial;
    const sphereMaterial = this.sphere.material as THREE.MeshStandardMaterial;

    backdropMaterial.uniforms.rand.value = Math.random() * 10000;

    if (this.particles) {
      const positions = this.particles.geometry.attributes.position
        .array as Float32Array;
      const velocities = this.particleVelocities;
      const colors = this.particles.geometry.attributes.color
        .array as Float32Array;

      const bassBlast = normSummedBass * 15.0;
      const springFactor = 0.02;
      const damping = 0.97;

      for (let i = 0; i < positions.length; i += 3) {
        const i3 = i;
        const p = new THREE.Vector3(
          positions[i3],
          positions[i3 + 1],
          positions[i3 + 2],
        );
        const v = new THREE.Vector3(
          velocities[i3],
          velocities[i3 + 1],
          velocities[i3 + 2],
        );
        const o = new THREE.Vector3(
          this.particleOriginalPositions[i3],
          this.particleOriginalPositions[i3 + 1],
          this.particleOriginalPositions[i3 + 2],
        );

        // Spring force towards original position
        const springForce = o.clone().sub(p).multiplyScalar(springFactor);
        v.add(springForce);

        // Bass explosion
        if (bassBlast > 0.1) {
          const fromCenter = p.clone().normalize();
          v.add(fromCenter.multiplyScalar(bassBlast * dt * Math.random()));
        }

        // Apply damping
        v.multiplyScalar(damping);

        // Update position
        p.add(v.clone().multiplyScalar(dt));

        positions[i3] = p.x;
        positions[i3 + 1] = p.y;
        positions[i3 + 2] = p.z;

        velocities[i3] = v.x;
        velocities[i3 + 1] = v.y;
        velocities[i3 + 2] = v.z;

        // Update color
        const baseColor = new THREE.Color(0x4dd0e1);
        const flashColor = new THREE.Color(0xffffff);
        const colorMix = Math.min(1.0, normSummedVolume * 2.5);
        const finalColor = baseColor.clone().lerp(flashColor, colorMix);

        finalColor.toArray(colors, i3);
      }
      this.particles.geometry.attributes.position.needsUpdate = true;
      this.particles.geometry.attributes.color.needsUpdate = true;
      (this.particles.material as THREE.PointsMaterial).size =
        0.02 + normSummedHighs * 0.1;
    }

    if (sphereMaterial.userData.shader) {
      // Sphere scale now reacts to bass for a pulsing effect.
      const scale = 1 + normSummedBass * 0.5;
      this.sphere.scale.setScalar(scale);

      // Emissive intensity also driven by bass.
      sphereMaterial.emissiveIntensity = 1.0 + normSummedBass * 4.0;

      // Emissive color shifts with frequency content and input/output ratio.
      const totalVolForColor = inputFeatures.volume + outputFeatures.volume;
      const baseEmissive = new THREE.Color(0x000010);
      let targetEmissive = baseEmissive.clone();

      if (totalVolForColor > 10) {
        const inputRatio = inputFeatures.volume / totalVolForColor;

        const inputColor = new THREE.Color().setHSL(
          0.6 + (inputFeatures.highs / 255) * 0.2, // Blue -> Cyan on highs
          0.8,
          0.5 + (inputFeatures.mids / 255) * 0.2, // Brighter on mids
        );
        const outputColor = new THREE.Color().setHSL(
          0.8 - (outputFeatures.highs / 255) * 0.2, // Purple -> Magenta on highs
          0.8,
          0.5 + (outputFeatures.mids / 255) * 0.2, // Brighter on mids
        );

        targetEmissive.lerp(outputColor, 1 - inputRatio);
        targetEmissive.lerp(inputColor, inputRatio);
      }
      sphereMaterial.emissive.lerp(targetEmissive, 0.1);

      // Bloom effect is now dynamic.
      this.bloomPass.strength = 1.0 + normSummedHighs * 2.5;
      this.bloomPass.radius = 0.4 + normSummedMids * 0.4;
      this.bloomPass.threshold = Math.max(0.1, 0.7 - normSummedBass * 0.6); // Bass lowers threshold.

      // Cinematic camera rotation and zoom.
      this.rotation.y += dt * 0.0002 + dt * 0.001 * normSummedMids;
      this.rotation.x = -0.1 + Math.sin(t * 0.0002) * 0.1;

      const euler = new THREE.Euler(
        this.rotation.x,
        this.rotation.y,
        this.rotation.z,
      );
      const quaternion = new THREE.Quaternion().setFromEuler(euler);

      const zoom = 5 - normSummedBass * 1.5;
      const vector = new THREE.Vector3(0, 0, zoom);
      vector.applyQuaternion(quaternion);

      this.cameraTarget.copy(vector);
      this.camera.position.lerp(this.cameraTarget, 0.02 * dt);
      this.camera.lookAt(this.sphere.position);

      // Update shader uniforms.
      sphereMaterial.userData.shader.uniforms.time.value += dt * 0.05;
      sphereMaterial.userData.shader.uniforms.inputData.value.set(
        inputFeatures.bass / 255,
        inputFeatures.mids / 255,
        inputFeatures.highs / 255,
        inputFeatures.volume / 255,
      );
      sphereMaterial.userData.shader.uniforms.outputData.value.set(
        outputFeatures.bass / 255,
        outputFeatures.mids / 255,
        outputFeatures.highs / 255,
        outputFeatures.volume / 255,
      );
    }

    this.composer.render();
  }

  protected firstUpdated() {
    this.canvas = this.shadowRoot!.querySelector('canvas') as HTMLCanvasElement;
    this.init();
  }

  protected render() {
    return html`<canvas></canvas>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'gdm-live-audio-visuals-3d': GdmLiveAudioVisuals3D;
  }
}