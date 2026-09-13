import * as THREE from "../vendor/three/three.min.js";
import { LABEL_GLSL, labelUniforms } from "./volume.js";

// Orthogonal slice planes that sample the current 3D volume, and flat "sheets" that show
// 2D images (the four contrasts, the specialist's six channels).

const PLANE_VERT = /* glsl */ `
out vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const PLANE_FRAG = /* glsl */ `
precision highp float;
precision highp sampler3D;
in vec3 vWorld;
out vec4 outColor;
uniform sampler3D uVol;
uniform sampler3D uAux;
uniform mat4 uSceneToVoxel;
uniform vec3 uDims;
uniform float uOpacity;
${LABEL_GLSL}
void main() {
  vec3 p = (uSceneToVoxel * vec4(vWorld, 1.0)).xyz;
  vec3 tp = p / uDims;
  if (any(lessThan(tp, vec3(0.0))) || any(greaterThan(tp, vec3(1.0)))) discard;
  float v = textureLod(uVol, tp, 0.0).r;
  float edge = smoothstep(0.1, 0.45, textureLod(uAux, tp, 0.0).r) * smoothstep(0.0, 0.015, v);
  float a = uOpacity * edge;
  if (a <= 0.002) discard;
  vec3 c = tintLabel(vec3(windowed(v)), uAux, p, uDims);
  outColor = vec4(c * a, a);
}
`;

const SHEET_VERT = /* glsl */ `
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// uKind 0: MRI slice (8-bit, 0 = outside the head), 1: binary mask, 2: signed distance.
const SHEET_FRAG = /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uImg;
uniform vec4 uRect;
uniform int uKind;
uniform float uOpacity;
uniform float uFramed;
uniform float uSdtScale;
uniform float uSdtClip;
void main() {
  vec2 uv = uRect.xy + vUv * uRect.zw;
  float v = texture(uImg, uv).r;
  vec3 c;
  float a = uOpacity;
  if (uKind == 0) {
    float inside = smoothstep(0.0, 0.01, v);
    c = vec3(v);
    if (uFramed > 0.5) c = mix(vec3(0.03, 0.035, 0.045), c, inside);
    else a *= inside;
  } else if (uKind == 1) {
    c = mix(vec3(0.03, 0.035, 0.045), vec3(0.93), step(0.5, v));
  } else {
    float s = v * 255.0 / uSdtScale - uSdtClip;
    float g = (s + uSdtClip) / (2.0 * uSdtClip);
    c = vec3(0.03 + 0.8 * g * g);
    float w = max(fwidth(s), 1e-3);
    float ring = abs(fract(s / 5.0 + 0.5) - 0.5) * 5.0;
    c = mix(c, vec3(1.0), (1.0 - smoothstep(0.0, 1.2 * w, ring)) * 0.3);
    c = mix(c, vec3(1.0), (1.0 - smoothstep(0.0, 1.6 * w, abs(s))) * 0.95);
  }
  if (uFramed > 0.5) {
    vec2 e = min(vUv, 1.0 - vUv);
    float fw = 1.5 * max(fwidth(vUv.x), fwidth(vUv.y));
    c = mix(c, vec3(0.8), (1.0 - smoothstep(0.0, fw, min(e.x, e.y))) * 0.7);
  }
  if (a <= 0.002) discard;
  outColor = vec4(c * a, a);
}
`;

export function createSlicePlanes(space, auxTexture, colors) {
  const uniforms = {
    uVol: { value: null },
    uAux: { value: auxTexture },
    uSceneToVoxel: { value: space.sceneToVoxel.clone() },
    uDims: { value: space.dims.clone() },
    uOpacity: { value: 0 },
    ...labelUniforms(colors),
  };
  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: PLANE_VERT,
    fragmentShader: PLANE_FRAG,
    uniforms,
    side: THREE.DoubleSide,
    transparent: true,
    premultipliedAlpha: true,
  });
  const { x: ni, y: nj, z: nk } = space.dims;
  const axial = new THREE.Mesh(new THREE.PlaneGeometry(ni, nj), material);
  axial.rotation.x = -Math.PI / 2;
  const coronal = new THREE.Mesh(new THREE.PlaneGeometry(ni, nk), material);
  const sagittal = new THREE.Mesh(new THREE.PlaneGeometry(nj, nk), material);
  sagittal.rotation.y = Math.PI / 2;
  const group = new THREE.Group();
  group.add(axial, coronal, sagittal);
  group.renderOrder = 0;

  return {
    group,
    uniforms,
    material,
    setIndex(i, j, k) {
      const c = space.toScene(i, j, k);
      axial.position.set(0, c.y, 0);
      coronal.position.set(0, 0, c.z);
      sagittal.position.set(c.x, 0, 0);
    },
    setOpacity(value) {
      uniforms.uOpacity.value = value;
      group.visible = value > 0.002;
      material.depthWrite = value > 0.98;
    },
  };
}

export function createDataTexture(data, width, height) {
  const texture = new THREE.DataTexture(data, width, height, THREE.RedFormat, THREE.UnsignedByteType);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;
  return texture;
}

// A horizontal sheet (axial orientation): u follows i (left), v follows j (posterior).
export function createSheet(texture, width, height, { kind = 0, rect = [0, 0, 1, 1], framed = false, sdtScale = 6.35, sdtClip = 20 } = {}) {
  const uniforms = {
    uImg: { value: texture },
    uRect: { value: new THREE.Vector4(...rect) },
    uKind: { value: kind },
    uOpacity: { value: 0 },
    uFramed: { value: framed ? 1 : 0 },
    uSdtScale: { value: sdtScale },
    uSdtClip: { value: sdtClip },
  };
  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: SHEET_VERT,
    fragmentShader: SHEET_FRAG,
    uniforms,
    side: THREE.DoubleSide,
    transparent: true,
    premultipliedAlpha: true,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.visible = false;
  return {
    mesh,
    uniforms,
    setOpacity(value) {
      uniforms.uOpacity.value = value;
      mesh.visible = value > 0.002;
      material.depthWrite = value > 0.98;
    },
  };
}
