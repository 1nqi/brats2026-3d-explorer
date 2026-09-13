import * as THREE from "../vendor/three/three.min.js";

// ROI boxes (drawn on top), the 800-voxel budget cube and the simulated proposal voxels.

const SOLID_VERT = /* glsl */ `
out vec3 vNormal;
void main() {
  mat4 m = modelMatrix;
  #ifdef USE_INSTANCING
  m = m * instanceMatrix;
  #endif
  vNormal = normalize(mat3(m) * normal);
  gl_Position = projectionMatrix * viewMatrix * m * vec4(position, 1.0);
}
`;

const SOLID_FRAG = /* glsl */ `
precision highp float;
in vec3 vNormal;
out vec4 outColor;
uniform vec3 uColor;
uniform float uOpacity;
uniform vec3 uLight;
void main() {
  vec3 n = normalize(vNormal);
  float diff = max(dot(n, uLight), 0.0);
  vec3 c = uColor * (0.35 + 0.55 * diff + 0.15 * (0.5 + 0.5 * n.y));
  float a = uOpacity;
  if (a <= 0.002) discard;
  outColor = vec4(c * a, a);
}
`;

function solidMaterial(color, opacity = 1) {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: SOLID_VERT,
    fragmentShader: SOLID_FRAG,
    uniforms: {
      uColor: { value: color.clone() },
      uOpacity: { value: opacity },
      uLight: { value: new THREE.Vector3(0.3, 0.8, 0.5).normalize() },
    },
    transparent: true,
    premultipliedAlpha: true,
  });
}

function wireBox(color) {
  const geometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
  const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0, depthTest: false, depthWrite: false });
  const lines = new THREE.LineSegments(geometry, material);
  lines.renderOrder = 10;
  lines.visible = false;
  return lines;
}

export function createOverlays(manifest, space, colors, proposalBuffer) {
  const overlay = new THREE.Group();
  const main = new THREE.Group();

  // ---- ROI: the tight tumour-core box grows by the 16-voxel margin ----
  const tight = space.boxToScene(manifest.roi.tight);
  const roi = space.boxToScene(manifest.roi.box);
  const roiLines = wireBox(0xeef2f6);
  const tightLines = wireBox(0xeef2f6);
  overlay.add(roiLines, tightLines);

  const placeBox = (lines, center, size) => {
    lines.position.copy(center);
    lines.scale.set(Math.max(size.x, 0.01), Math.max(size.y, 0.01), Math.max(size.z, 0.01));
  };
  placeBox(tightLines, tight.center, tight.size);

  // ---- budget cube: exactly 800 mm^3 ----
  const edge = Math.cbrt(800);
  const budget = new THREE.Group();
  const cubeMaterial = solidMaterial(colors.omega, 0.9);
  const cube = new THREE.Mesh(new THREE.BoxGeometry(edge, edge, edge), cubeMaterial);
  cube.renderOrder = 3;
  const cubeEdges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(edge, edge, edge)),
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }),
  );
  budget.add(cube, cubeEdges);
  budget.position.set(roi.max.x + 18, tight.center.y, tight.center.z);
  budget.visible = false;
  main.add(budget);

  // ---- simulated proposal voxels, ordered by distance to ET ----
  const count = proposalBuffer.length / 3;
  const voxelMaterial = solidMaterial(colors.omega, 1);
  const voxels = new THREE.InstancedMesh(new THREE.BoxGeometry(0.92, 0.92, 0.92), voxelMaterial, count);
  const m = new THREE.Matrix4();
  for (let n = 0; n < count; n++) {
    const p = space.toScene(proposalBuffer[3 * n] + 0.5, proposalBuffer[3 * n + 1] + 0.5, proposalBuffer[3 * n + 2] + 0.5);
    m.makeTranslation(p.x, p.y, p.z);
    voxels.setMatrixAt(n, m);
  }
  voxels.instanceMatrix.needsUpdate = true;
  voxels.count = 0;
  voxels.renderOrder = 2;
  voxels.frustumCulled = false;
  voxels.visible = false;
  main.add(voxels);

  const proposalAnchor = (n) => {
    const k = Math.max(0, Math.min(count - 1, Math.floor(n) - 1));
    return space.toScene(proposalBuffer[3 * k] + 0.5, proposalBuffer[3 * k + 1] + 0.5, proposalBuffer[3 * k + 2] + 0.5);
  };
  const firstVoxel = proposalAnchor(1);

  return {
    overlay,
    main,
    tight,
    roi,
    budget,
    budgetEdge: edge,
    proposalCapacity: count,
    firstVoxel,
    update(S, light) {
      const grow = S.roiGrow;
      const center = tight.center.clone().lerp(roi.center, grow);
      const size = tight.size.clone().lerp(roi.size, grow);
      placeBox(roiLines, center, size);
      roiLines.material.opacity = 0.9 * S.roiBox;
      roiLines.visible = S.roiBox > 0.002;
      tightLines.material.opacity = 0.35 * S.roiBox * grow;
      tightLines.visible = S.roiBox * grow > 0.002;

      cubeMaterial.uniforms.uOpacity.value = 0.85 * S.budget;
      cubeEdges.material.opacity = 0.9 * S.budget;
      budget.visible = S.budget > 0.002;
      cubeMaterial.uniforms.uLight.value.copy(light);

      const n = Math.round(S.proposalCount);
      voxels.count = Math.max(0, Math.min(count, n));
      const rejected = n > 800;
      voxelMaterial.uniforms.uColor.value.copy(rejected ? colors.et : colors.omega);
      voxelMaterial.uniforms.uOpacity.value = S.proposal * (rejected ? 0.55 : 1);
      voxelMaterial.uniforms.uLight.value.copy(light);
      voxels.visible = S.proposal > 0.002 && voxels.count > 0;
    },
  };
}
