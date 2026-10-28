// Buff 角色着色特效：把 buff.vfx 元数据（[{type,color,intensity,speed}]）聚合成每单位一组 uniform，
// 通过 onBeforeCompile 注入 MeshStandardMaterial（机器人/精灵）；VRM(MToon) 无法注入，退化为自发光脉冲。
import * as THREE from 'three';
import { VFX_TYPES } from '../engine/model.js';

const KEYS = Object.keys(VFX_TYPES);
const N = KEYS.length;
const IDX = Object.fromEntries(KEYS.map((k, i) => [k, i]));

export function createUnitFx(height) {
  return {
    height,
    uTime: { value: 0 },
    uH: { value: Math.max(0.3, height) },
    uI: { value: new Float32Array(N) },
    uS: { value: new Float32Array(N).fill(1) },
    uC: { value: Array.from({ length: N }, () => new THREE.Color(1, 1, 1)) },
    active: false,
  };
}

const NOISE = /* glsl */`
float fxHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float fxNoise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(fxHash(i), fxHash(i + vec2(1, 0)), f.x), mix(fxHash(i + vec2(0, 1)), fxHash(i + vec2(1, 1)), f.x), f.y);
}`;

// 每种特效的 GLSL 片段，返回加到自发光上的颜色；可用变量：I(强度) S(速度) C(颜色) hh(0..1 高度) fres(边缘) t(时间) wp(世界坐标)
const GLSL = {
  glow: `add += C * I * (0.3 + fres * 1.8) * (0.85 + 0.15 * sin(t * 3.0 * S));`,
  flash: `{ float k = 0.5 + 0.5 * sin(t * 10.0 * S); add += C * I * k * k * k * 1.4; }`,
  bleed: `{
    float col = floor((wp.x + wp.z) * 7.0), r = fxHash(vec2(col, 3.0));
    float y = fract(hh * 0.9 - t * (0.25 + 0.35 * r) * S + r);
    float streak = pow(1.0 - y, 5.0) * step(0.35, r);
    float blot = smoothstep(0.55, 0.85, fxNoise(vec2(wp.x + wp.z, hh * 2.0) * 3.0 + t * 0.2 * S));
    add += C * I * (streak * 1.6 + blot * 0.5 + fres * 0.25);
  }`,
  burn: `{
    float n = fxNoise(vec2((wp.x + wp.z) * 5.0, hh * 4.0 - t * 2.5 * S));
    add += C * I * smoothstep(0.35, 0.9, n) * (1.0 - hh * 0.55) * 2.0 + C * I * fres * 0.4;
  }`,
  poison: `{
    float n = fxNoise(vec2(wp.x + wp.z, hh) * 7.0 + vec2(0.0, -t * S));
    add += C * I * (smoothstep(0.62, 0.72, n) * 1.4 + (0.5 + 0.5 * sin(t * 3.0 * S)) * fres * 0.8);
  }`,
  frost: `{
    float sp = step(0.975, fxHash(floor(wp.xy * 18.0) + floor(wp.zy * 18.0) + floor(t * 4.0 * S)));
    add += C * I * (fres * 1.6 + sp * 2.0 + 0.12);
  }`,
  shock: `{
    float a = step(0.86, fxHash(vec2(floor(t * 18.0 * S), floor(hh * 12.0))));
    add += C * I * (a * 2.6 + fres * 0.4);
  }`,
};

const FRAG_FX = /* glsl */`
uniform float uFxTime, uFxH;
uniform float uFxI[${N}], uFxS[${N}];
uniform vec3 uFxC[${N}];
varying vec3 vFxW;
${NOISE}
vec3 unitFx(vec3 nrm, vec3 vpos){
  float t = uFxTime, hh = clamp(vFxW.y / uFxH, 0.0, 1.2);
  vec3 wp = vFxW, add = vec3(0.0);
  float fres = pow(1.0 - clamp(abs(dot(normalize(nrm), normalize(vpos))), 0.0, 1.0), 2.5);
  ${KEYS.map((k, i) => `if (uFxI[${i}] > 0.001) { float I = uFxI[${i}], S = uFxS[${i}]; vec3 C = uFxC[${i}]; ${GLSL[k]} }`).join('\n  ')}
  return min(add * 0.4, vec3(0.8)); // 泛光会放大自发光：整体压低并限幅，避免过曝成白块
}`;

export function patchMaterial(mat, fx) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uFxTime = fx.uTime; sh.uniforms.uFxH = fx.uH;
    sh.uniforms.uFxI = fx.uI; sh.uniforms.uFxS = fx.uS; sh.uniforms.uFxC = fx.uC;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFxW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvFxW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_FX)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += unitFx(normal, vViewPosition);');
  };
  mat.customProgramCacheKey = () => 'unitfx-v1';
  mat.needsUpdate = true;
}

const tmp = new THREE.Color();
// 聚合单位当前所有 Buff 的 vfx；返回是否有任何特效
export function updateUnitFx(fx, u, time) {
  fx.uTime.value = time;
  const I = fx.uI.value, S = fx.uS.value, C = fx.uC.value;
  I.fill(0);
  if (u.alive) for (const b of u.buffs) for (const e of b.def.vfx || []) {
    const i = IDX[e.type]; if (i === undefined) continue;
    const k = (e.intensity ?? 1) * (1 + Math.min(b.stacks - 1, 4) * 0.12);
    if (k > I[i]) { I[i] = k; S[i] = e.speed ?? 1; C[i].set(e.color || b.def.color || '#ffffff'); }
  }
  fx.active = I.some(v => v > 0);
  return fx.active;
}

// VRM 退化：把特效近似成自发光（返回要叠加的颜色）
export function fallbackEmissive(fx, time, out = tmp) {
  out.setRGB(0, 0, 0);
  const I = fx.uI.value, C = fx.uC.value, S = fx.uS.value;
  for (let i = 0; i < N; i++) {
    if (I[i] <= 0) continue;
    const s = S[i], k = I[i];
    let w = 0.3;
    switch (KEYS[i]) {
      case 'flash': { const q = 0.5 + 0.5 * Math.sin(time * 10 * s); w = q * q * q * 1.2; break; }
      case 'shock': w = Math.sin(time * 18 * s) > 0.7 ? 1.6 : 0.1; break;
      case 'burn': w = 0.35 + 0.25 * Math.sin(time * 9 * s + Math.sin(time * 3.1)); break;
      case 'bleed': w = 0.25 + 0.15 * Math.sin(time * 2 * s); break;
      default: w = 0.3 + 0.12 * Math.sin(time * 3 * s);
    }
    out.r += C[i].r * k * w; out.g += C[i].g * k * w; out.b += C[i].b * k * w;
  }
  out.r = Math.min(0.8, out.r * 0.4); out.g = Math.min(0.8, out.g * 0.4); out.b = Math.min(0.8, out.b * 0.4);
  return out;
}
