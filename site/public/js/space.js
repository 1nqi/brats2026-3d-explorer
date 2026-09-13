import * as THREE from "../vendor/three/three.min.js";

// Voxel space is (i, j, k) of the head crop in millimetres (1 mm voxels), voxel centres at
// index + 0.5. The NIfTI header says i points to the patient's left, j to posterior and
// k to superior. The scene uses x = left, y = superior, z = anterior (right-handed), centred
// on the crop, so the camera on +z looks at the face.
export function createSpace(manifest) {
  const [ni, nj, nk] = manifest.geometry.dims;
  const voxelToScene = new THREE.Matrix4().set(
    1, 0, 0, -ni / 2,
    0, 0, 1, -nk / 2,
    0, -1, 0, nj / 2,
    0, 0, 0, 1,
  );
  const sceneToVoxel = voxelToScene.clone().invert();
  const rotation = new THREE.Matrix3().setFromMatrix4(voxelToScene);

  const toScene = (i, j, k) => new THREE.Vector3(i, j, k).applyMatrix4(voxelToScene);
  const boxToScene = (box) => {
    const lo = toScene(box[0][0], box[1][0], box[2][0]);
    const hi = toScene(box[0][1], box[1][1], box[2][1]);
    const min = lo.clone().min(hi);
    const max = lo.clone().max(hi);
    return { min, max, center: min.clone().add(max).multiplyScalar(0.5), size: max.clone().sub(min) };
  };

  return {
    dims: new THREE.Vector3(ni, nj, nk),
    sceneSize: new THREE.Vector3(ni, nk, nj),
    voxelToScene,
    sceneToVoxel,
    rotation,
    toScene,
    boxToScene,
  };
}
