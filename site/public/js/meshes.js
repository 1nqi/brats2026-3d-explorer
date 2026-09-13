import * as THREE from "../vendor/three/three.min.js";

// Tumour sub-region surfaces from the quantised marching-cubes meshes in meshes.bin.

const VERT = /* glsl */ `
out vec3 vNormal;
out vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FRAG = /* glsl */ `
precision highp float;
in vec3 vNormal;
in vec3 vWorld;
out vec4 outColor;
uniform vec3 uColor;
uniform vec3 uTint;
uniform float uTintMix;
uniform float uOpacity;
uniform float uVisible;
uniform vec3 uLight;
void main() {
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  vec3 v = normalize(cameraPosition - vWorld);
  vec3 base = mix(uColor, uTint, uTintMix);
  float diff = max(dot(n, uLight), 0.0);
  float hemi = 0.5 + 0.5 * n.y;
  float fres = pow(1.0 - max(dot(n, v), 0.0), 2.4);
  float spec = pow(max(dot(n, normalize(uLight + v)), 0.0), 38.0);
  vec3 c = base * (0.22 + 0.62 * diff + 0.24 * hemi) + vec3(0.16 * spec) + base * 0.45 * fres;
  float a = clamp(uOpacity + (1.0 - uOpacity) * 0.6 * fres, 0.0, 1.0) * uVisible;
  if (a <= 0.002) discard;
  outColor = vec4(c * a, a);
}
`;

export function createTumorMeshes(manifest, buffer, space, colors) {
  const group = new THREE.Group();
  const meshes = {};
  const byName = { ET: colors.et, NETC: colors.netc, CC: colors.cc };
  const order = { NETC: 4, ET: 1, CC: 2 };

  for (const entry of manifest.meshes) {
    const geometry = new THREE.BufferGeometry();
    const [po, pl] = entry.position;
    const [no, nl] = entry.normal;
    const [io, il] = entry.index;
    geometry.setAttribute("position", new THREE.BufferAttribute(new Uint16Array(buffer.buffer, buffer.byteOffset + po, pl / 2), 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(new Int8Array(buffer.buffer, buffer.byteOffset + no, nl), 3, true));
    const IndexArray = entry.index_type === "uint16" ? Uint16Array : Uint32Array;
    geometry.setIndex(new THREE.BufferAttribute(new IndexArray(buffer.buffer, buffer.byteOffset + io, il / IndexArray.BYTES_PER_ELEMENT), 1));
    geometry.computeBoundingSphere();

    const uniforms = {
      uColor: { value: byName[entry.name].clone() },
      uTint: { value: colors.guard.clone() },
      uTintMix: { value: 0 },
      uOpacity: { value: 1 },
      uVisible: { value: 1 },
      uLight: { value: new THREE.Vector3(0.3, 0.8, 0.5).normalize() },
    };
    const material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms,
      transparent: true,
      premultipliedAlpha: true,
      side: THREE.FrontSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(space.voxelToScene).multiply(new THREE.Matrix4().makeScale(entry.position_scale, entry.position_scale, entry.position_scale));
    mesh.renderOrder = order[entry.name] ?? 3;
    mesh.name = entry.name;
    group.add(mesh);
    meshes[entry.name] = { mesh, uniforms, material };
  }

  return {
    group,
    meshes,
    // visible and opacity are 0..1; a translucent surface keeps writing depth for its front
    // faces so the volume behind it stops there.
    set(name, visible, opacity = 1) {
      const item = meshes[name];
      if (!item) return;
      item.uniforms.uVisible.value = visible;
      item.uniforms.uOpacity.value = opacity;
      item.mesh.visible = visible > 0.002;
      item.material.depthWrite = visible > 0.5;
    },
    setTint(mix) {
      for (const item of Object.values(meshes)) item.uniforms.uTintMix.value = mix;
    },
    setLight(direction) {
      for (const item of Object.values(meshes)) item.uniforms.uLight.value.copy(direction);
    },
  };
}
