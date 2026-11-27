import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { scene, camera } from './engine';

/**
 * Cartoon post-processing: ink outlines found from depth discontinuities, a
 * gentle bloom on anything brighter than white (magic, fire, sparks, lit
 * windows), then tone/colour output.
 */

const INK_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform vec2 uTexel;
uniform float uNear;
uniform float uFar;
uniform vec3 uInk;
uniform float uStrength;
uniform float uWidth;
uniform vec4 uShock[3];
uniform float uAspect;
varying vec2 vUv;

float linearDepth(vec2 uv) {
  float z = texture2D(tDepth, uv).x * 2.0 - 1.0;
  return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
}

void main() {
  // Shockwaves: a ring that pushes the picture outward as it expands.
  vec2 off = vec2(0.0);
  float rs = 0.0;
  for (int i = 0; i < 3; i++) {
    vec4 s = uShock[i];
    if (s.w <= 0.0) continue;
    vec2 dv = vUv - s.xy;
    dv.x *= uAspect;
    float dist = length(dv);
    float x = (dist - s.z) / 0.045;
    float ring = exp(-x * x) * s.w;
    vec2 dir = dist > 0.0001 ? dv / dist : vec2(0.0);
    dir.x /= uAspect;
    off += dir * ring * 0.022;
    rs += ring;
  }
  vec2 uv = vUv - off;
  vec4 col = texture2D(tDiffuse, uv);
  if (rs > 0.002) {
    col.r = texture2D(tDiffuse, uv - off * 0.45).r;
    col.b = texture2D(tDiffuse, uv + off * 0.45).b;
    col.rgb += min(rs, 1.0) * 0.06 * vec3(1.0, 0.92, 0.8);
  }
  float d = linearDepth(uv);
  vec2 o = uTexel * uWidth;
  // Only the nearer side of an edge draws ink, so lines hug the silhouette.
  float edge = 0.0;
  edge = max(edge, linearDepth(uv + vec2(o.x, 0.0)) - d);
  edge = max(edge, linearDepth(uv - vec2(o.x, 0.0)) - d);
  edge = max(edge, linearDepth(uv + vec2(0.0, o.y)) - d);
  edge = max(edge, linearDepth(uv - vec2(0.0, o.y)) - d);
  edge = max(edge, linearDepth(uv + o * 0.7) - d);
  edge = max(edge, linearDepth(uv - o * 0.7) - d);
  edge = max(edge, linearDepth(uv + vec2(o.x, -o.y) * 0.7) - d);
  edge = max(edge, linearDepth(uv + vec2(-o.x, o.y) * 0.7) - d);
  float rel = edge / max(d, 0.001);
  float ink = smoothstep(0.007, 0.02, rel);
  ink *= 1.0 - smoothstep(uFar * 0.32, uFar * 0.5, d);
  col.rgb = mix(col.rgb, uInk * col.rgb, ink * uStrength);
  #ifdef INK_DEBUG
  col.rgb = vec3(ink, fract(d * 0.1), 0.0);
  #endif
  gl_FragColor = col;
}
`;

const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

class InkPass extends Pass {
  readonly uniforms = {
    tDiffuse: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    uTexel: { value: new THREE.Vector2(1, 1) },
    uNear: { value: 0.5 },
    uFar: { value: 260 },
    uInk: { value: new THREE.Color(0.12, 0.07, 0.1) },
    uStrength: { value: 0.92 },
    uWidth: { value: 1.4 },
    uShock: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
    uAspect: { value: 1 },
  };
  private quad: FullScreenQuad;

  constructor() {
    super();
    this.quad = new FullScreenQuad(
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: QUAD_VERT,
        fragmentShader: INK_FRAG,
        depthTest: false,
        depthWrite: false,
        defines: new URLSearchParams(location.search).has('inkdebug') ? { INK_DEBUG: '' } : {},
      }),
    );
  }

  setSize(w: number, h: number): void {
    this.uniforms.uTexel.value.set(1 / w, 1 / h);
    this.uniforms.uAspect.value = w / Math.max(1, h);
  }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    this.uniforms.tDiffuse.value = readBuffer.texture;
    this.uniforms.tDepth.value = readBuffer.depthTexture;
    this.uniforms.uNear.value = camera.near;
    this.uniforms.uFar.value = camera.far;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  dispose(): void {
    this.quad.dispose();
  }
}

interface Shock {
  x: number;
  y: number;
  t: number;
  life: number;
  power: number;
}
const shocks: Shock[] = [];
const _sv = new THREE.Vector3();

let composer: EffectComposer | null = null;
let bloom: UnrealBloomPass | null = null;
let ink: InkPass | null = null;
let failed = false;

export const Post = {
  init(renderer: THREE.WebGLRenderer, lowSpec: boolean): void {
    try {
      const size = renderer.getDrawingBufferSize(new THREE.Vector2());
      const rt = new THREE.WebGLRenderTarget(size.x, size.y, {
        type: THREE.HalfFloatType,
        samples: Number(new URLSearchParams(location.search).get('msaa') ?? (lowSpec ? 2 : 4)),
        depthTexture: new THREE.DepthTexture(size.x, size.y),
      });
      composer = new EffectComposer(renderer, rt);
      // The ping-pong buffer must not share the depth texture it is sampled from.
      composer.renderTarget2.depthTexture = new THREE.DepthTexture(size.x, size.y);
      composer.addPass(new RenderPass(scene, camera));
      ink = new InkPass();
      ink.uniforms.uWidth.value = Math.max(1.6, renderer.getPixelRatio() * 1.4);
      composer.addPass(ink);
      if (!lowSpec) {
        bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.45, 0.55, 0.92);
        composer.addPass(bloom);
      }
      composer.addPass(new OutputPass());
    } catch (e) {
      console.warn('Post-processing unavailable, rendering directly', e);
      composer = null;
      failed = true;
    }
  },

  resize(w: number, h: number, pixelRatio: number): void {
    if (!composer) return;
    composer.setPixelRatio(pixelRatio);
    composer.setSize(w, h);
    if (ink) ink.uniforms.uWidth.value = Math.max(1.6, pixelRatio * 1.4);
  },

  /** A screen-space shockwave ripple from a world position (big explosions). */
  shock(x: number, y: number, z: number, power: number): void {
    if (!ink) return;
    _sv.set(x, y, z).project(camera);
    if (_sv.z > 1 || Math.abs(_sv.x) > 1.3 || Math.abs(_sv.y) > 1.3) return;
    if (shocks.length >= 3) shocks.shift();
    shocks.push({ x: _sv.x * 0.5 + 0.5, y: _sv.y * 0.5 + 0.5, t: 0, life: 0.55, power });
  },

  /** Advance the shockwaves (real time, so they also play during hit-stop). */
  update(dt: number): void {
    if (!ink) return;
    for (let i = shocks.length - 1; i >= 0; i--) {
      shocks[i].t += dt;
      if (shocks[i].t >= shocks[i].life) shocks.splice(i, 1);
    }
    const u = ink.uniforms.uShock.value;
    for (let i = 0; i < 3; i++) {
      const s = shocks[i];
      if (!s) {
        u[i].set(0, 0, 0, 0);
        continue;
      }
      const k = s.t / s.life;
      u[i].set(s.x, s.y, 0.02 + (1 - (1 - k) ** 2) * 0.32 * (0.6 + s.power * 0.5), s.power * (1 - k) ** 1.5);
    }
  },

  /** Brighter bloom at night so torches, magic and fire glow. */
  setNight(n: number): void {
    if (bloom) bloom.strength = 0.42 + n * 0.28;
  },

  render(renderer: THREE.WebGLRenderer): void {
    if (composer && !failed) {
      try {
        composer.render();
        return;
      } catch (e) {
        console.warn('Post-processing failed, rendering directly', e);
        failed = true;
      }
    }
    renderer.render(scene, camera);
  },
};
