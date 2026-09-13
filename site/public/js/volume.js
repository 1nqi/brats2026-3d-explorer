import * as THREE from "../vendor/three/three.min.js";

// Ray-marched MRI volume, drawn after the mesh pass. Rays stop at the depth the meshes wrote,
// so tumour surfaces and slice planes occlude the volume correctly.
//
// Solid mode: the head is the 0.5 level of the smoothed head mask; a removed octant (the cut)
// exposes the scan on exact planar faces, tinted by the voxel labels.
// Glass mode: emission-absorption through the head.
// Box mode: solid inside the ROI box (with the cut), glass ghost outside it.

export const LABEL_GLSL = /* glsl */ `
uniform vec2 uWindow;
uniform float uLabelMix;
uniform vec3 uLabelVis;
uniform vec3 uColET;
uniform vec3 uColNETC;
uniform vec3 uColCC;

float windowed(float v) {
  return clamp((v - uWindow.x) / max(uWindow.y - uWindow.x, 1e-3), 0.0, 1.0);
}

vec3 tintLabel(vec3 c, sampler3D aux, vec3 p, vec3 dims) {
  if (uLabelMix <= 0.0) return c;
  ivec3 ip = clamp(ivec3(floor(p)), ivec3(0), ivec3(dims) - 1);
  int l = int(texelFetch(aux, ip, 0).g * 255.0 + 0.5);
  if (l == 1) return mix(c, uColET, uLabelMix * uLabelVis.x);
  if (l == 2) return mix(c, uColNETC, uLabelMix * uLabelVis.y);
  if (l == 3) return mix(c, uColCC, uLabelMix * uLabelVis.z);
  return c;
}
`;

const VERT = /* glsl */ `
out vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FRAG = /* glsl */ `
precision highp float;
precision highp sampler3D;
precision highp sampler2D;

in vec3 vWorld;
out vec4 outColor;

uniform sampler3D uVol;
uniform sampler3D uAux;
uniform sampler2D uDepth;
uniform vec3 uDims;
uniform mat4 uSceneToVoxel;
uniform mat3 uVoxelToSceneRot;
uniform vec3 uCamDir;
uniform vec2 uResolution;
uniform float uNear;
uniform float uFar;

uniform float uOpacity;
uniform float uGlass;
uniform float uGlassDensity;
uniform float uGhostDensity;
uniform vec3 uSkin;
uniform vec3 uLight;

// Removed regions (the cut octant, the floor under the skull base, the defaced face). Each is
// the intersection of three half-spaces dot(n, p) > w in voxel space; an unused plane is
// (0, 0, 0, -1), which every point satisfies.
uniform int uCutCount;
uniform vec4 uPlanes[15];

uniform float uBoxOn;
uniform float uBoxSolid;
uniform vec3 uBoxMin;
uniform vec3 uBoxMax;

${LABEL_GLSL}

const int MAX_STEPS = 720;

float maskAt(vec3 p) { return texture(uAux, p / uDims).r; }
float valueAt(vec3 p) { return texture(uVol, p / uDims).r; }
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

// Slab test that also reports the entry face normal (pointing back towards the ray origin).
vec2 rayBox(vec3 o, vec3 d, vec3 bmin, vec3 bmax, out vec3 nEntry) {
  vec3 inv = 1.0 / d;
  vec3 t0 = (bmin - o) * inv;
  vec3 t1 = (bmax - o) * inv;
  vec3 lo = min(t0, t1);
  vec3 hi = max(t0, t1);
  nEntry = vec3(0.0);
  if (lo.x >= lo.y && lo.x >= lo.z) nEntry.x = -sign(d.x);
  else if (lo.y >= lo.z) nEntry.y = -sign(d.y);
  else nEntry.z = -sign(d.z);
  return vec2(max(max(lo.x, lo.y), lo.z), min(min(hi.x, hi.y), hi.z));
}

// Ray interval inside removed region r, and the plane normal where the ray leaves it. That
// normal points into the removed region, so it is the outward normal of the solid beyond.
vec2 rayRegion(vec3 o, vec3 d, int r, out vec3 nExit) {
  float t0 = -1e6;
  float t1 = 1e6;
  nExit = vec3(0.0);
  for (int q = 0; q < 3; q++) {
    vec4 plane = uPlanes[r * 3 + q];
    float num = dot(plane.xyz, o) - plane.w;
    float den = dot(plane.xyz, d);
    if (abs(den) < 1e-7) {
      if (num <= 0.0) return vec2(1.0, 0.0);
      continue;
    }
    float t = -num / den;
    if (den > 0.0) {
      t0 = max(t0, t);
    } else if (t < t1) {
      t1 = t;
      nExit = plane.xyz;
    }
  }
  return vec2(t0, t1);
}

struct Span { float a; float b; vec3 n; bool face; };
const int MAX_REGIONS = 5;
const int MAX_SPANS = 6;

// Splits [a, b] into the ordered spans that survive every removed box. A span that starts
// where a removed box ends carries that box face, so the solid shows a planar cut there.
int carve(vec3 o, vec3 d, float a, float b, vec3 nA, bool faceA, int regions, inout Span spans[MAX_SPANS]) {
  spans[0] = Span(a, b, nA, faceA);
  int count = b > a ? 1 : 0;
  for (int r = 0; r < MAX_REGIONS; r++) {
    if (r >= regions) break;
    vec3 nExit;
    vec2 c = rayRegion(o, d, r, nExit);
    if (c.x >= c.y) continue;
    Span next[MAX_SPANS];
    int m = 0;
    for (int s = 0; s < MAX_SPANS; s++) {
      if (s >= count) break;
      Span sp = spans[s];
      if (c.y <= sp.a || c.x >= sp.b) {
        if (m < MAX_SPANS) { next[m] = sp; m++; }
        continue;
      }
      if (c.x > sp.a && m < MAX_SPANS) { next[m] = Span(sp.a, c.x, sp.n, sp.face); m++; }
      if (c.y < sp.b && m < MAX_SPANS) { next[m] = Span(c.y, sp.b, nExit, true); m++; }
    }
    for (int s = 0; s < MAX_SPANS; s++) {
      if (s >= m) break;
      spans[s] = next[s];
    }
    count = m;
  }
  return count;
}

vec3 faceColor(vec3 p, vec3 nVox) {
  float v = valueAt(p);
  vec3 c = vec3(windowed(v));
  c = tintLabel(c, uAux, p, uDims);
  // the smoothed shell reaches slightly past the scanned tissue; paint that rim like the shell
  c = mix(uSkin * 0.62, c, smoothstep(0.0, 0.012, v));
  vec3 n = normalize(uVoxelToSceneRot * nVox);
  return c * (0.82 + 0.18 * max(dot(n, uLight), 0.0));
}

vec3 skinColor(vec3 p, vec3 dirW) {
  vec3 g = vec3(
    maskAt(p + vec3(1.0, 0.0, 0.0)) - maskAt(p - vec3(1.0, 0.0, 0.0)),
    maskAt(p + vec3(0.0, 1.0, 0.0)) - maskAt(p - vec3(0.0, 1.0, 0.0)),
    maskAt(p + vec3(0.0, 0.0, 1.0)) - maskAt(p - vec3(0.0, 0.0, 1.0))
  );
  vec3 n = normalize(uVoxelToSceneRot * -normalize(g + vec3(1e-6)));
  vec3 v = -dirW;
  float diff = max(dot(n, uLight), 0.0);
  float hemi = 0.5 + 0.5 * n.y;
  float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  float spec = pow(max(dot(n, normalize(uLight + v)), 0.0), 42.0);
  return uSkin * (0.16 + 0.6 * diff + 0.2 * hemi) + vec3(0.1 * spec) + uSkin * 0.1 * rim;
}

// First opaque hit inside [a, b]; a planar face if the segment starts inside the head.
vec4 solidSegment(vec3 o, vec3 d, vec3 dirW, float a, float b, vec3 nFace, bool hasFace) {
  if (b <= a) return vec4(0.0);
  vec3 p0 = o + d * (a + 0.02);
  if (hasFace && maskAt(p0) > 0.5) return vec4(faceColor(p0, nFace), 1.0);
  float tPrev = a;
  float t = a + 0.5;
  for (int i = 0; i < MAX_STEPS; i++) {
    if (t > b) break;
    float m = maskAt(o + d * t);
    if (m > 0.5) {
      float lo = tPrev;
      float hi = t;
      for (int k = 0; k < 5; k++) {
        float mid = 0.5 * (lo + hi);
        if (maskAt(o + d * mid) > 0.5) hi = mid; else lo = mid;
      }
      return vec4(skinColor(o + d * hi, dirW), 1.0);
    }
    tPrev = t;
    t += m < 0.08 ? 1.6 : 0.5;
  }
  return vec4(0.0);
}

vec4 glassSegment(vec3 o, vec3 d, float a, float b, float density, float jitter) {
  vec4 acc = vec4(0.0);
  if (b <= a || density <= 0.0) return acc;
  float t = a + jitter;
  for (int i = 0; i < MAX_STEPS; i++) {
    if (t >= b || acc.a > 0.97) break;
    vec3 p = o + d * t;
    float m = maskAt(p);
    if (m > 0.02) {
      float g = windowed(valueAt(p));
      float alpha = clamp(density * m * (0.05 + 0.95 * g * g), 0.0, 1.0);
      vec3 col = mix(vec3(0.30, 0.36, 0.45), vec3(0.92, 0.95, 0.99), g);
      acc.rgb += (1.0 - acc.a) * col * alpha;
      acc.a += (1.0 - acc.a) * alpha;
      t += 1.0;
    } else {
      t += 2.0;
    }
  }
  return acc;
}

vec4 over(vec4 front, vec4 back) {
  return vec4(front.rgb + (1.0 - front.a) * back.rgb, front.a + (1.0 - front.a) * back.a);
}

vec4 solidCarved(vec3 o, vec3 d, vec3 dirW, float a, float b, vec3 nA, bool faceA) {
  Span spans[MAX_SPANS];
  int count = carve(o, d, a, b, nA, faceA, uCutCount, spans);
  for (int s = 0; s < MAX_SPANS; s++) {
    if (s >= count) break;
    vec4 hit = solidSegment(o, d, dirW, spans[s].a, spans[s].b, spans[s].n, spans[s].face);
    if (hit.a > 0.5) return hit;
  }
  return vec4(0.0);
}

// Glass keeps the whole head: only the first region (the cut octant) removes anything.
vec4 glassCarved(vec3 o, vec3 d, float a, float b, float density, float jitter) {
  Span spans[MAX_SPANS];
  int count = carve(o, d, a, b, vec3(0.0), false, min(uCutCount, 1), spans);
  vec4 acc = vec4(0.0);
  for (int s = 0; s < MAX_SPANS; s++) {
    if (s >= count || acc.a > 0.97) break;
    acc = over(acc, glassSegment(o, d, spans[s].a, spans[s].b, density, jitter));
  }
  return acc;
}

void main() {
  vec3 dirW = normalize(vWorld - cameraPosition);
  vec3 o = (uSceneToVoxel * vec4(cameraPosition, 1.0)).xyz;
  vec3 d = normalize((uSceneToVoxel * vec4(dirW, 0.0)).xyz);
  d += vec3(equal(d, vec3(0.0))) * 1e-6;

  float depth = texture(uDepth, gl_FragCoord.xy / uResolution).r;
  float tDepth = 1e6;
  if (depth < 0.999999) {
    float viewZ = (uNear * uFar) / ((uFar - uNear) * depth - uFar);
    tDepth = -viewZ / max(dot(dirW, uCamDir), 1e-4);
  }

  vec3 nVol;
  vec2 kv = rayBox(o, d, vec3(0.0), uDims, nVol);
  bool outside = kv.x > 0.0;
  kv.x = max(kv.x, 0.0);
  kv.y = min(kv.y, tDepth);
  if (kv.y <= kv.x) discard;

  float jitter = hash(gl_FragCoord.xy);
  vec4 color;

  if (uBoxOn > 0.5) {
    vec3 nBox;
    vec2 kb = rayBox(o, d, uBoxMin, uBoxMax, nBox);
    float bA = max(kb.x, kv.x);
    float bB = min(kb.y, kv.y);
    float ghost = uGhostDensity;
    if (bA >= bB) {
      color = glassCarved(o, d, kv.x, kv.y, ghost, jitter);
    } else {
      bool boxFace = kb.x >= kv.x;
      vec4 front = glassCarved(o, d, kv.x, bA, ghost, jitter);
      vec4 inside = uBoxSolid > 0.001
        ? solidCarved(o, d, dirW, bA, bB, boxFace ? nBox : nVol, boxFace || outside)
        : vec4(0.0);
      if (uBoxSolid < 0.999) inside = mix(glassCarved(o, d, bA, bB, uGlassDensity, jitter), inside, uBoxSolid);
      vec4 back = inside.a > 0.99 ? vec4(0.0) : glassCarved(o, d, bB, kv.y, ghost, jitter);
      color = over(front, over(inside, back));
    }
  } else {
    vec4 solid = uGlass < 0.999 ? solidCarved(o, d, dirW, kv.x, kv.y, nVol, outside) : vec4(0.0);
    vec4 glass = uGlass > 0.001 ? glassCarved(o, d, kv.x, kv.y, uGlassDensity, jitter) : vec4(0.0);
    color = mix(solid, glass, uGlass);
  }

  color *= uOpacity;
  if (color.a <= 0.002) discard;
  outColor = color;
}
`;

export function createVolumeTexture(data, dims, format = THREE.RedFormat) {
  const texture = new THREE.Data3DTexture(data, dims[0], dims[1], dims[2]);
  texture.format = format;
  texture.type = THREE.UnsignedByteType;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = texture.wrapR = THREE.ClampToEdgeWrapping;
  texture.unpackAlignment = 1;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

export function labelUniforms(colors) {
  return {
    uWindow: { value: new THREE.Vector2(0.0, 1.0) },
    uLabelMix: { value: 0.55 },
    uLabelVis: { value: new THREE.Vector3(1, 1, 1) },
    uColET: { value: colors.et.clone() },
    uColNETC: { value: colors.netc.clone() },
    uColCC: { value: colors.cc.clone() },
  };
}

export function createVolume(space, auxTexture, colors) {
  const uniforms = {
    uVol: { value: null },
    uAux: { value: auxTexture },
    uDepth: { value: null },
    uDims: { value: space.dims.clone() },
    uSceneToVoxel: { value: space.sceneToVoxel.clone() },
    uVoxelToSceneRot: { value: space.rotation.clone() },
    uCamDir: { value: new THREE.Vector3(0, 0, -1) },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uNear: { value: 1 },
    uFar: { value: 3000 },
    uOpacity: { value: 1 },
    uGlass: { value: 0 },
    uGlassDensity: { value: 0.035 },
    uGhostDensity: { value: 0.035 },
    uSkin: { value: new THREE.Vector3(0.83, 0.82, 0.8) },
    uLight: { value: new THREE.Vector3(0.3, 0.8, 0.5).normalize() },
    uCutCount: { value: 0 },
    uPlanes: { value: Array.from({ length: 15 }, () => new THREE.Vector4(0, 0, 0, -1)) },
    uBoxOn: { value: 0 },
    uBoxSolid: { value: 0 },
    uBoxMin: { value: new THREE.Vector3() },
    uBoxMax: { value: new THREE.Vector3() },
    ...labelUniforms(colors),
  };
  const material = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms,
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    premultipliedAlpha: true,
    blending: THREE.NormalBlending,
  });
  const s = space.sceneSize;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(s.x, s.y, s.z), material);
  mesh.frustumCulled = false;
  return { mesh, uniforms, material };
}
