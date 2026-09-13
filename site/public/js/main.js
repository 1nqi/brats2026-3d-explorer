import * as THREE from "../vendor/three/three.min.js";
import { OrbitControls } from "../vendor/three/three.min.js";
import { ICONS } from "./icons.js";
import { createI18n, preferredLanguage, rememberLanguage } from "./i18n.js";
import { loadBinary, loadGroup, loadManifest } from "./data.js";
import { createSpace } from "./space.js";
import { createVolume, createVolumeTexture } from "./volume.js";
import { createDataTexture, createSheet, createSlicePlanes } from "./planes.js";
import { createTumorMeshes } from "./meshes.js";
import { createOverlays } from "./overlays.js";
import { Callouts } from "./labels.js";
import { Tweens, reducedMotion } from "./tween.js";
import { BASE, VIEWS, buildChapters } from "./story.js";

THREE.ColorManagement.enabled = false;

const $ = (id) => document.getElementById(id);
const i18n = createI18n(preferredLanguage());
const MODALITIES = ["t1n", "t1c", "t2w", "t2f"];
const INITIAL_FILES = ["masks.bin", "vol_t1c.bin", "meshes.bin", "slices.bin", "sdt.bin", "proposal.bin"];
const COLORS = {
  et: rgb("#f0474a"),
  netc: rgb("#4a90d9"),
  cc: rgb("#52c46b"),
  omega: rgb("#ffa21f"),
  guard: rgb("#b08ad9"),
};

function rgb(hex) {
  const c = new THREE.Color(hex);
  return new THREE.Vector3(c.r, c.g, c.b);
}

function applyIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((el) => {
    el.innerHTML = ICONS[el.dataset.icon] || "";
  });
}

function setIcon(el, name) {
  el.dataset.icon = name;
  el.innerHTML = ICONS[name] || "";
}

function applyStaticText() {
  document.documentElement.lang = i18n.lang;
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = i18n.t(el.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-aria]").forEach((el) => el.setAttribute("aria-label", i18n.t(el.dataset.i18nAria)));
  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.title = i18n.t(el.dataset.i18nTitle);
  });
  document.querySelectorAll("#langSeg button").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.lang === i18n.lang));
  });
}

const loader = {
  progress(fraction, loaded, total) {
    $("loaderFill").style.width = `${(fraction * 100).toFixed(1)}%`;
    $("loaderMeta").textContent = `${Math.round(fraction * 100)}%   ${i18n.num(loaded / 1e6, 1)} / ${i18n.num(total / 1e6, 1)} MB`;
  },
  error(message, canRetry = true) {
    $("loader").classList.remove("done");
    $("loaderError").hidden = false;
    $("loaderErrorText").textContent = message;
    $("retryBtn").hidden = !canRetry;
  },
  done() {
    $("loader").classList.add("done");
  },
};

async function boot() {
  applyIcons();
  applyStaticText();
  document.querySelectorAll("#langSeg button").forEach((button) => {
    button.addEventListener("click", () => {
      i18n.set(button.dataset.lang);
      rememberLanguage(i18n.lang);
    });
  });
  i18n.onChange(applyStaticText);

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: $("scene"), antialias: false, alpha: false, powerPreference: "high-performance" });
  } catch (error) {
    console.error(error);
    loader.error(i18n.t("webgl"), false);
    return;
  }

  const run = async () => {
    $("loaderError").hidden = true;
    try {
      const manifest = await loadManifest();
      const files = await loadGroup(manifest, INITIAL_FILES, loader.progress);
      const app = createApp(renderer, manifest, files);
      // Never keep the page behind the loader for long if shader compilation is slow.
      await Promise.race([app.precompile(), new Promise((resolve) => setTimeout(resolve, 6000))]);
      loader.done();
      app.start();
    } catch (error) {
      console.error(error);
      loader.error(i18n.t("loadFail", { file: error.file || "data" }));
    }
  };
  $("retryBtn").addEventListener("click", run);
  run();
}

function createApp(renderer, manifest, files) {
  const space = createSpace(manifest);
  const dims = manifest.geometry.dims;
  const [ni, nj] = dims;
  const tweens = new Tweens();
  // The dock rectangle is read on resize, not on every frame, to avoid forced layouts.
  let dockRect = null;
  const callouts = new Callouts($("callouts"), () => (dockRect ? [dockRect] : []));
  const t = (key, vars) => i18n.t(key, vars);

  // Chapter-driven state starts "closed" so the first chapter can open the cut.
  const S = { ...BASE, cutOpen: 0, et: 0, netc: 0, cc: 0 };
  const L = { et: 1, netc: 1, cc: 1 }; // user layer filter from the dock
  const slice = { i: Math.round(manifest.tc_centroid[0]), j: Math.round(manifest.tc_centroid[1]), k: Math.round(manifest.tc_centroid[2]) };
  let modality = "t1c";
  let viewMode = "cut";
  let current = -1;
  let dirty = true;
  let guardOn = false;
  let userRotate = false;
  const pendingModalities = new Set();

  renderer.autoClear = false;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setClearColor(0x000000, 0);

  // ---------- textures and scene objects ----------
  const aux = createVolumeTexture(files["masks.bin"], dims, THREE.RGFormat);
  const volumes = { t1c: createVolumeTexture(files["vol_t1c.bin"], dims) };

  const scene = new THREE.Scene();
  const volumeScene = new THREE.Scene();
  const overlayScene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 1, 5000);

  const volume = createVolume(space, aux, COLORS);
  volumeScene.add(volume.mesh);
  const planes = createSlicePlanes(space, aux, COLORS);
  scene.add(planes.group);
  const tumor = createTumorMeshes(manifest, files["meshes.bin"], space, COLORS);
  scene.add(tumor.group);
  const overlays = createOverlays(manifest, space, COLORS, files["proposal.bin"]);
  scene.add(overlays.main);
  overlayScene.add(overlays.overlay);

  // Axial sheets for the four contrasts, cut through the tumour-core centre.
  const kIndex = manifest.slices.index;
  const sliceLevel = space.toScene(0, 0, kIndex + 0.5).y;
  const sliceBytes = files["slices.bin"];
  const sliceTextures = MODALITIES.map((_, n) => createDataTexture(sliceBytes.subarray(n * ni * nj, (n + 1) * ni * nj), ni, nj));
  const fan4 = sliceTextures.map((texture) => {
    const sheet = createSheet(texture, ni, nj, { kind: 0 });
    scene.add(sheet.mesh);
    return sheet;
  });
  const fan4Base = new THREE.Vector3(0, sliceLevel, 0);
  const fan4Step = new THREE.Vector3(22, 40, -78);
  const fan4Anchors = fan4.map(() => new THREE.Vector3());
  // Label anchor: the right-most tissue voxel of each slice, not the edge of the padded sheet.
  const fan4Edge = MODALITIES.map((_, n) => {
    const plane = sliceBytes.subarray(n * ni * nj, (n + 1) * ni * nj);
    let best = [0, nj / 2];
    for (let j = 0; j < nj; j++) {
      for (let i = ni - 1; i > best[0]; i--) {
        if (plane[i + j * ni] > 0) {
          best = [i, j];
          break;
        }
      }
    }
    return new THREE.Vector3(best[0] + 1 - ni / 2, 0, -(best[1] + 0.5 - nj / 2));
  });

  // The specialist's six channels on the same axial slice, cropped to the ROI.
  const box = manifest.roi.box;
  const [di, dj, dk] = manifest.roi.dims;
  const kLocal = kIndex - box[2][0];
  const sdtBytes = files["sdt.bin"];
  const sdtSlice = new Uint8Array(di * dj);
  const tcSlice = new Uint8Array(di * dj);
  for (let j = 0; j < dj; j++) {
    for (let i = 0; i < di; i++) {
      const v = sdtBytes[i + j * di + kLocal * di * dj];
      sdtSlice[i + j * di] = v;
      tcSlice[i + j * di] = v > 127 ? 255 : 0;
    }
  }
  const cropRect = [box[0][0] / ni, box[1][0] / nj, di / ni, dj / nj];
  const fan6 = [
    ...sliceTextures.map((texture) => createSheet(texture, di, dj, { kind: 0, rect: cropRect, framed: true })),
    createSheet(createDataTexture(tcSlice, di, dj), di, dj, { kind: 1, framed: true }),
    createSheet(createDataTexture(sdtSlice, di, dj), di, dj, {
      kind: 2,
      framed: true,
      sdtScale: manifest.roi.sdt_scale,
      sdtClip: manifest.roi.sdt_clip,
    }),
  ];
  fan6.forEach((sheet) => scene.add(sheet.mesh));
  const fan6Base = space.toScene(box[0][0] + di / 2, box[1][0] + dj / 2, kIndex + 0.5);
  const fan6Top = overlays.roi.max.y + 26;
  const fan6Anchors = fan6.map(() => new THREE.Vector3());
  const fan6Azimuth = THREE.MathUtils.degToRad(152);
  const fan6Right = new THREE.Vector3(Math.cos(fan6Azimuth), 0, -Math.sin(fan6Azimuth));
  const fan6Far = new THREE.Vector3(-Math.sin(fan6Azimuth), 0, -Math.cos(fan6Azimuth));
  void dk;

  const toScene = (c) => space.toScene(c[0], c[1], c[2]);
  // The budget cube floats above and right of the tumour core, as seen by the transplant camera;
  // on narrow screens it moves closer so it stays in frame.
  const budgetAzimuth = THREE.MathUtils.degToRad(122);
  const budgetRight = new THREE.Vector3(Math.cos(budgetAzimuth), 0, -Math.sin(budgetAzimuth));
  const placeBudget = (narrow) => {
    overlays.budget.position
      .copy(toScene(manifest.tc_centroid))
      .addScaledVector(budgetRight, narrow ? 40 : 52)
      .add(new THREE.Vector3(0, narrow ? -34 : -4, 0));
    anchors.budget.copy(overlays.budget.position).add(new THREE.Vector3(0, overlays.budgetEdge / 2, 0));
  };
  const componentAnchors = Object.fromEntries(
    ["ET", "NETC", "CC"].map((name) => [name, manifest.components[name].map((c) => toScene(c.centroid))]),
  );
  const anchors = {
    tumor: toScene(manifest.tc_centroid),
    et: componentAnchors.ET,
    netc: componentAnchors.NETC,
    cc: componentAnchors.CC,
    components: componentAnchors,
    roi: overlays.roi.center.clone(),
    tightCorner: new THREE.Vector3(overlays.tight.max.x, overlays.tight.min.y, overlays.tight.min.z),
    roiCorner: new THREE.Vector3(overlays.roi.min.x, overlays.roi.max.y, overlays.roi.min.z),
    fan4: fan4Anchors,
    fan6: fan6Anchors,
    omega: overlays.firstVoxel.clone(),
    budget: new THREE.Vector3(),
  };
  placeBudget(false);
  const targets = {
    tumor: anchors.tumor,
    roi: anchors.roi,
    et: anchors.et[0],
    fan4: fan4Base.clone().add(new THREE.Vector3(0, 0, 0)),
    fan6: new THREE.Vector3(fan6Base.x, fan6Top, fan6Base.z),
  };

  // ---------- two-pass rendering: meshes to a target with depth, then volume and overlays ----------
  const renderTarget = new THREE.WebGLRenderTarget(1, 1, {
    samples: 4,
    depthTexture: new THREE.DepthTexture(1, 1),
  });
  const compositeScene = new THREE.Scene();
  const orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const triangle = new THREE.BufferGeometry();
  triangle.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const composite = new THREE.Mesh(
    triangle,
    new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: { uScene: { value: renderTarget.texture }, uAspect: { value: new THREE.Vector2(1, 1) } },
      vertexShader: /* glsl */ `
        out vec2 vUv;
        void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        precision highp float;
        in vec2 vUv;
        out vec4 outColor;
        uniform sampler2D uScene;
        uniform vec2 uAspect;
        void main() {
          vec4 s = texture(uScene, vUv);
          vec3 bg = mix(vec3(0.030, 0.034, 0.043), vec3(0.058, 0.066, 0.082), vUv.y);
          bg *= 1.0 - 0.38 * smoothstep(0.3, 1.15, length((vUv - 0.5) * uAspect));
          bg += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
          outColor = vec4(s.rgb + bg * (1.0 - s.a), 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    }),
  );
  composite.frustumCulled = false;
  compositeScene.add(composite);

  // The ray-marched volume renders into its own target, into a viewport that can be smaller than
  // the canvas while the view moves, and is then blended over the screen. At rest it renders at
  // full size, so the still image is unchanged.
  const volumeTarget = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
  volumeTarget.texture.minFilter = THREE.LinearFilter;
  volumeTarget.texture.magFilter = THREE.LinearFilter;
  const blitScene = new THREE.Scene();
  const blit = new THREE.Mesh(
    triangle,
    new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        uVolume: { value: volumeTarget.texture },
        uScale: { value: new THREE.Vector2(1, 1) },
        uTexel: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: /* glsl */ `
        out vec2 vUv;
        void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        precision highp float;
        in vec2 vUv;
        out vec4 outColor;
        uniform sampler2D uVolume;
        uniform vec2 uScale;
        uniform vec2 uTexel;
        void main() {
          outColor = texture(uVolume, min(vUv * uScale, uScale - 0.5 * uTexel));
        }`,
      transparent: true,
      premultipliedAlpha: true,
      blending: THREE.NormalBlending,
      depthTest: false,
      depthWrite: false,
    }),
  );
  blit.frustumCulled = false;
  blitScene.add(blit);

  // ---------- camera ----------
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.085;
  controls.rotateSpeed = 0.75;
  controls.zoomSpeed = 0.9;
  controls.minDistance = 70;
  controls.maxDistance = 1800;
  controls.autoRotateSpeed = 0.5;
  controls.screenSpacePanning = true;

  const cam = { az: 96, el: 10, dist: 760, target: anchors.tumor.clone() };
  let camAnimating = false;
  const deg = THREE.MathUtils.degToRad;

  function applyCamera() {
    const az = deg(cam.az);
    const el = deg(cam.el);
    controls.target.copy(cam.target);
    camera.position.set(
      cam.target.x + cam.dist * Math.sin(az) * Math.cos(el),
      cam.target.y + cam.dist * Math.sin(el),
      cam.target.z + cam.dist * Math.cos(az) * Math.cos(el),
    );
    camera.lookAt(cam.target);
  }

  function readCamera() {
    const offset = camera.position.clone().sub(controls.target);
    cam.dist = offset.length();
    cam.el = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(offset.y / cam.dist, -1, 1)));
    cam.az = THREE.MathUtils.radToDeg(Math.atan2(offset.x, offset.z));
    cam.target.copy(controls.target);
  }

  function distanceScale() {
    const aspect = window.innerWidth / Math.max(window.innerHeight, 1);
    return aspect < 1.25 ? Math.min(2.1, 1.3 / aspect) : 1;
  }

  function camTo(preset, duration = 1700) {
    readCamera();
    let az = preset.az;
    while (az - cam.az > 180) az -= 360;
    while (az - cam.az < -180) az += 360;
    camAnimating = true;
    tweens.to(
      cam,
      { az, el: preset.el, dist: preset.dist * lastDistanceScale, target: (targets[preset.target] || anchors.tumor).clone() },
      { duration, ease: "inOut", onDone: () => { camAnimating = false; } },
    );
  }

  controls.addEventListener("start", () => {
    if (camAnimating) {
      tweens.cancel(cam);
      camAnimating = false;
    }
    hideHint();
  });
  controls.addEventListener("change", () => { dirty = true; });

  // ---------- sizing and quality ----------
  const maxDpr = Math.min(window.devicePixelRatio || 1, 2);
  let dpr = Math.min(maxDpr, 1.5);
  let lastDistanceScale = distanceScale();
  let cssW = 1;
  let cssH = 1;
  const bufferSize = new THREE.Vector2();
  const canvasSize = new THREE.Vector2();

  function resize() {
    cssW = window.innerWidth;
    cssH = window.innerHeight;
    // Assigning a canvas size, even the same one, clears and reallocates the drawing buffer.
    // Chapters call resize() for the view offset, so touch the canvas only on a real change.
    renderer.getSize(canvasSize);
    if (renderer.getPixelRatio() !== dpr || canvasSize.x !== cssW || canvasSize.y !== cssH) {
      renderer.setPixelRatio(dpr);
      renderer.setSize(cssW, cssH, false);
    }
    renderer.getDrawingBufferSize(bufferSize);
    renderTarget.setSize(bufferSize.x, bufferSize.y);
    volumeTarget.setSize(bufferSize.x, bufferSize.y);
    composite.material.uniforms.uAspect.value.set(cssW / cssH, 1);
    dockRect = $("dock").getBoundingClientRect();
    camera.aspect = cssW / cssH;
    const story = $("story").getBoundingClientRect();
    const wide = window.matchMedia("(min-width: 821px)").matches;
    const shiftX = wide ? Math.round((story.right + 8) / 2) : 0;
    const shiftY = wide ? 0 : Math.round(Math.min(story.height, cssH * 0.5) / 2);
    camera.setViewOffset(cssW, cssH, -shiftX, shiftY, cssW, cssH);
    camera.updateProjectionMatrix();
    placeBudget(cssW / cssH < 1);

    // Narrow screens pull the camera back; keep that in step when the viewport changes shape
    // (a rotated phone), both for the resting camera and for a flight in progress.
    const scale = distanceScale();
    if (Math.abs(scale - lastDistanceScale) > 1e-3) {
      const ratio = scale / lastDistanceScale;
      if (camAnimating) {
        cam.dist *= ratio;
        tweens.retarget(cam, "dist", (d) => d * ratio);
      } else {
        camera.position.sub(controls.target).multiplyScalar(ratio).add(controls.target);
      }
      lastDistanceScale = scale;
    }
    dirty = true;
  }

  // While the view moves, the volume pass renders at quality.motion of the canvas resolution;
  // once it settles, one frame renders at quality.idle. The motion scale aims at the display's
  // own refresh rate: a few late frames lower it quickly, a long run of on-time frames raises it
  // a little, so it settles just below the point where frames start to drop.
  const quality = { motion: 0.6, idle: 1, min: 0.3 };
  const round2 = (value) => Math.round(value * 100) / 100;
  let refresh = 1000 / 60;
  let lastFrameAt = 0;
  let lateFrames = 0;
  let onTimeFrames = 0;

  function measureFrame(now) {
    const dt = lastFrameAt ? now - lastFrameAt : 0;
    lastFrameAt = now;
    if (dt <= 0 || dt > 250) return;
    // the shortest recent interval approximates the refresh period (60, 120, 144 Hz)
    refresh = Math.min(dt, refresh + 0.005);
    if (dt > refresh * 1.45) {
      lateFrames += 1;
      onTimeFrames = 0;
    } else if (dt < refresh * 1.2) {
      onTimeFrames += 1;
      lateFrames = 0;
    }
    if (lateFrames >= 6 && quality.motion > quality.min) {
      quality.motion = Math.max(quality.min, round2(quality.motion - 0.1));
      lateFrames = 0;
    } else if (lateFrames >= 30 && dpr > 1) {
      // still late at the smallest volume scale: render the whole canvas at 1x, once
      dpr = 1;
      lateFrames = 0;
      resize();
    } else if (onTimeFrames >= 90 && quality.motion < 1) {
      quality.motion = Math.min(1, round2(quality.motion + 0.05));
      onTimeFrames = 0;
    }
  }

  // ---------- state to GPU ----------
  const light = new THREE.Vector3();
  const basisX = new THREE.Vector3();
  const basisY = new THREE.Vector3();
  const basisZ = new THREE.Vector3();
  // Removed regions in crop voxel coordinates: the cut octant opens from outside the head to
  // the tumour-core centre; the floor and an oblique face plane trim the neck and the defaced face.
  const cutCentre = new THREE.Vector3(...manifest.tc_centroid);
  const cutOutside = new THREE.Vector3(dims[0] + 6, dims[1] + 6, dims[2] + 6);
  const trim = { floorK: 34, faceJ: 58, faceK: 84, faceAngle: 50, earInset: 40, earK: 62 };
  volume.uniforms.uBoxMin.value.set(box[0][0], box[1][0], box[2][0]);
  volume.uniforms.uBoxMax.value.set(box[0][1], box[1][1], box[2][1]);
  const scratch = new THREE.Vector3();
  let lastOmega = -1;

  function applyState() {
    camera.matrixWorld.extractBasis(basisX, basisY, basisZ);
    light.set(0, 0, 0).addScaledVector(basisX, -0.45).addScaledVector(basisY, 0.8).addScaledVector(basisZ, 0.6).normalize();

    const texture = volumes[modality] || volumes.t1c;
    const u = volume.uniforms;
    u.uVol.value = texture;
    u.uOpacity.value = S.volOpacity;
    volume.mesh.visible = S.volOpacity > 0.002;
    u.uGlass.value = S.glass;
    u.uGlassDensity.value = S.glassDensity;
    u.uBoxOn.value = S.box > 0.001 ? 1 : 0;
    u.uBoxSolid.value = S.box;
    u.uGhostDensity.value = THREE.MathUtils.lerp(S.glassDensity, S.ghostDensity, S.box);
    const planesU = u.uPlanes.value;
    // the octant towards left (+i), posterior (+j) and superior (+k) of the tumour-core centre
    scratch.lerpVectors(cutOutside, cutCentre, S.cutOpen);
    planesU[0].set(1, 0, 0, scratch.x);
    planesU[1].set(0, 1, 0, scratch.y);
    planesU[2].set(0, 0, 1, scratch.z);
    // everything below the skull base
    planesU[3].set(0, 0, -1, -trim.floorK);
    planesU[4].set(0, 0, 0, -1);
    planesU[5].set(0, 0, 0, -1);
    // the defaced lower face: in front of an oblique plane through (faceJ, faceK)
    const angle = deg(trim.faceAngle);
    const nJ = -Math.cos(angle);
    const nK = -Math.sin(angle);
    planesU[6].set(0, nJ, nK, nJ * trim.faceJ + nK * trim.faceK);
    planesU[7].set(0, 0, 0, -1);
    planesU[8].set(0, 0, 0, -1);
    // the ears and cheeks at the level of the skull base, one region per side
    planesU[9].set(-1, 0, 0, -trim.earInset);
    planesU[10].set(0, 0, -1, -trim.earK);
    planesU[11].set(0, 0, 0, -1);
    planesU[12].set(1, 0, 0, dims[0] - trim.earInset);
    planesU[13].set(0, 0, -1, -trim.earK);
    planesU[14].set(0, 0, 0, -1);
    u.uCutCount.value = 5;
    u.uLight.value.copy(light);

    const et = S.et * L.et;
    const netc = S.netc * L.netc;
    const cc = S.cc * L.cc;
    for (const uniforms of [u, planes.uniforms]) {
      uniforms.uLabelMix.value = S.labelMix;
      uniforms.uLabelVis.value.set(et, netc, cc);
    }
    planes.uniforms.uVol.value = texture;
    planes.setOpacity(S.slices);
    planes.setIndex(slice.i + 0.5, slice.j + 0.5, slice.k + 0.5);

    tumor.set("ET", et);
    tumor.set("NETC", netc, S.netcAlpha);
    tumor.set("CC", cc);
    tumor.setTint(S.tint);
    tumor.setLight(light);

    fan4.forEach((sheet, n) => {
      sheet.setOpacity(S.fan4);
      sheet.mesh.position.copy(fan4Base).addScaledVector(fan4Step, (n - 1.5) * S.fan4Spread);
      fan4Anchors[n].copy(sheet.mesh.position).add(fan4Edge[n]);
    });
    fan6.forEach((sheet, n) => {
      const col = n % 3;
      const row = Math.floor(n / 3);
      // grid laid out in the chapter camera's frame: reading order left to right, far row first
      scratch.set(fan6Base.x, fan6Top, fan6Base.z)
        .addScaledVector(fan6Right, (col - 1) * (di + 18))
        .addScaledVector(fan6Far, (0.5 - row) * (dj + 22));
      sheet.setOpacity(S.fan6);
      sheet.mesh.position.lerpVectors(fan6Base, scratch, S.fan6Spread);
      fan6Anchors[n].copy(sheet.mesh.position).addScaledVector(fan6Far, dj / 2 + 10);
    });

    overlays.update(S, light);

    if (chapters[current]?.id === "transplant") {
      const n = Math.round(S.proposalCount);
      if (n !== lastOmega) {
        lastOmega = n;
        callouts.updateHtml("omega", omegaHtml(n));
      }
    }
  }

  function renderFrame(scale = 1) {
    applyState();
    renderer.setRenderTarget(renderTarget);
    renderer.clear(true, true, false);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(compositeScene, orthoCamera);
    if (volume.mesh.visible) {
      const width = Math.max(1, Math.round(bufferSize.x * scale));
      const height = Math.max(1, Math.round(bufferSize.y * scale));
      const u = volume.uniforms;
      u.uDepth.value = renderTarget.depthTexture;
      u.uResolution.value.set(width, height);
      camera.getWorldDirection(u.uCamDir.value);
      u.uNear.value = camera.near;
      u.uFar.value = camera.far;
      volumeTarget.viewport.set(0, 0, width, height);
      renderer.setRenderTarget(volumeTarget);
      renderer.clear(true, false, false);
      renderer.render(volumeScene, camera);
      renderer.setRenderTarget(null);
      blit.material.uniforms.uScale.value.set(width / volumeTarget.width, height / volumeTarget.height);
      blit.material.uniforms.uTexel.value.set(1 / volumeTarget.width, 1 / volumeTarget.height);
      renderer.render(blitScene, orthoCamera);
    }
    renderer.render(overlayScene, camera);
    callouts.update(camera, cssW, cssH);
  }

  const REFINE_DELAY = 140;
  let needsRefine = false;
  let lastActiveAt = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    const wasAnimating = camAnimating;
    const animating = tweens.update(now);
    if (wasAnimating || camAnimating) applyCamera();
    const moved = controls.update();
    if (animating || moved || dirty || controls.autoRotate) {
      dirty = false;
      measureFrame(now);
      renderFrame(quality.motion);
      needsRefine = quality.motion < quality.idle;
      lastActiveAt = now;
      return;
    }
    lastFrameAt = 0;
    if (needsRefine && now - lastActiveAt > REFINE_DELAY) {
      needsRefine = false;
      renderFrame(quality.idle);
    }
  }

  // Compiles every shader up front, including objects that only appear in later chapters, so
  // the first visit to a chapter does not stall on shader compilation.
  async function precompile() {
    const roots = [
      [scene, camera],
      [volumeScene, camera],
      [overlayScene, camera],
      [compositeScene, orthoCamera],
      [blitScene, orthoCamera],
    ];
    const forced = [];
    for (const [root] of roots) {
      root.traverse((object) => {
        if (!object.visible) {
          object.visible = true;
          forced.push(object);
        }
      });
    }
    try {
      for (const [root, view] of roots) {
        if (renderer.compileAsync) await renderer.compileAsync(root, view);
        else renderer.compile(root, view);
      }
      // upload the large 3D textures now, behind the loader, instead of on the first frame
      renderer.initTexture(aux);
      renderer.initTexture(volumes.t1c);
    } catch (error) {
      console.warn("shader precompile skipped", error);
    } finally {
      forced.forEach((object) => { object.visible = false; });
      dirty = true;
    }
  }

  // ---------- story ----------
  function omegaHtml(n) {
    const verdict = n <= 800 ? t("ch.transplant.accepted") : t("ch.transplant.rolledBack");
    return `${t("omegaLabel")} ${i18n.num(n)} <small>${verdict}</small>`;
  }

  const ctx = {
    t,
    num: (value, digits) => i18n.num(value, digits),
    pct: (value, digits) => i18n.pct(value, digits),
    voxels: (n) => i18n.voxels(n),
    manifest,
    anchors,
    omegaHtml,
    mountSimulation(root) {
      const range = root.querySelector("#simRange");
      const value = root.querySelector("#simValue");
      const verdict = root.querySelector("#simVerdict");
      const target = Math.round(chapters[current].state.proposalCount);
      const show = (count) => {
        const accepted = count <= 800;
        value.textContent = `|Ω| = ${i18n.num(count)}`;
        verdict.textContent = accepted ? t("ch.transplant.accepted") : t("ch.transplant.rolledBack");
        verdict.className = `verdict ${accepted ? "ok" : "no"}`;
        range.style.setProperty("--pct", `${(count / 2400) * 100}%`);
        range.style.setProperty("--fill", accepted ? "var(--omega)" : "var(--et)");
      };
      const initial = tweens.active && Math.abs(S.proposalCount - target) > 1 ? target : Math.round(S.proposalCount);
      range.value = String(initial);
      show(initial);
      range.addEventListener("input", () => {
        tweens.cancel(S, ["proposalCount"]);
        S.proposalCount = Number(range.value);
        show(S.proposalCount);
        dirty = true;
      });
    },
    mountGuard(root) {
      const toggle = root.querySelector("#guardSwitch");
      const syncRows = () => {
        toggle.setAttribute("aria-checked", String(guardOn));
        root.querySelectorAll(".truth tbody tr").forEach((row) => {
          row.classList.toggle("active", row.dataset.row === (guardOn ? "h" : "p"));
        });
      };
      syncRows();
      toggle.addEventListener("click", () => {
        guardOn = !guardOn;
        syncRows();
        tweens.to(S, { et: 0, netc: 0, cc: 0 }, {
          duration: 300,
          onDone: () => {
            S.tint = guardOn ? 1 : 0;
            tweens.to(S, { et: 1, netc: 1, cc: 1 }, { duration: 520, delay: 160 });
          },
        });
        callouts.set(guardLabels(), anchors.tumor);
        dirty = true;
      });
    },
  };
  const guardLabels = () => (guardOn ? [{ id: "guard-h", anchor: anchors.netc[0], html: t("hLabel"), tone: "var(--guard)" }] : []);

  const chapters = buildChapters(ctx);

  function renderCard() {
    const chapter = chapters[current];
    $("storyTitle").textContent = t(`ch.${chapter.id}.title`);
    const body = $("storyBody");
    body.innerHTML = chapter.body();
    const scroller = $("storyScroll");
    scroller.scrollTop = 0;
    scroller.classList.remove("story-enter");
    void scroller.offsetWidth;
    scroller.classList.add("story-enter");
    chapter.mount?.(body);
  }

  function chapterLabels() {
    const chapter = chapters[current];
    if (chapter.id === "guard") return guardLabels();
    return chapter.labels ? chapter.labels() : [];
  }

  function showChapter(index, { instant = false } = {}) {
    index = THREE.MathUtils.clamp(index, 0, chapters.length - 1);
    const chapter = chapters[index];
    const entering = index !== current;
    current = index;
    viewMode = chapter.mode;
    if (entering) {
      guardOn = false;
      lastOmega = -1;
      if (chapter.from && !instant) Object.assign(S, chapter.from);
    }
    const goal = { ...BASE, ...VIEWS[chapter.mode], ...chapter.state };
    for (const [key, value] of Object.entries(goal)) {
      if (Math.abs(S[key] - value) < 1e-6) continue;
      tweens.to(S, { [key]: value }, {
        duration: instant ? 0 : chapter.durations?.[key] ?? 1100,
        delay: instant ? 0 : chapter.delays?.[key] ?? 0,
      });
    }
    camTo(chapter.camera, instant ? 0 : 1700);
    controls.autoRotate = (chapter.autoRotate ?? userRotate) && !reducedMotion();
    renderCard();
    callouts.set(chapterLabels(), anchors.tumor);
    updateNav();
    syncDock();
    resize();
    try {
      history.replaceState(null, "", `#${chapter.id}`);
    } catch {}
    dirty = true;
  }

  function buildTicks() {
    const list = $("ticks");
    list.innerHTML = "";
    chapters.forEach((_, n) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.addEventListener("click", () => showChapter(n));
      item.appendChild(button);
      list.appendChild(item);
    });
  }

  function updateNav() {
    $("ticks").querySelectorAll("button").forEach((button, n) => {
      const name = t(`ch.${chapters[n].id}.short`);
      button.setAttribute("aria-label", name);
      button.title = name;
      if (n === current) button.setAttribute("aria-current", "step");
      else button.removeAttribute("aria-current");
      button.classList.toggle("done", n < current);
    });
    $("tickName").textContent = t(`ch.${chapters[current].id}.short`);
    $("prevBtn").disabled = current === 0;
    $("nextLabel").textContent = current === chapters.length - 1 ? t("restart") : t("next");
  }

  // ---------- dock ----------
  const VIEW_LABEL = { cut: "cutaway", glass: "glass", slices: "slices" };

  function buildDock() {
    const modSeg = $("modSeg");
    modSeg.innerHTML = "";
    for (const m of MODALITIES) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.mod = m;
      button.innerHTML = '<span class="label"></span><span class="progress" hidden></span>';
      button.addEventListener("click", () => setModality(m));
      modSeg.appendChild(button);
    }

    const viewSeg = $("viewSeg");
    viewSeg.innerHTML = "";
    for (const mode of Object.keys(VIEWS)) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.view = mode;
      button.addEventListener("click", () => setView(mode));
      viewSeg.appendChild(button);
    }

    const chips = $("layerChips");
    chips.innerHTML = "";
    for (const name of ["ET", "NETC", "CC"]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "chip";
      button.dataset.layer = name;
      button.innerHTML = `<span class="swatch ${name.toLowerCase()}"></span><span>${name}</span>`;
      button.addEventListener("click", () => {
        const key = name.toLowerCase();
        const on = L[key] < 0.5;
        tweens.to(L, { [key]: on ? 1 : 0 }, { duration: 420 });
        button.setAttribute("aria-pressed", String(on));
        dirty = true;
      });
      button.setAttribute("aria-pressed", "true");
      chips.appendChild(button);
    }

    const sliders = $("sliceSliders");
    sliders.innerHTML = "";
    for (const [axis, label, max] of [["k", "axial", dims[2]], ["j", "coronal", dims[1]], ["i", "sagittal", dims[0]]]) {
      const row = document.createElement("label");
      row.className = "dock-slider";
      row.innerHTML = `<span data-i18n="${label}"></span><input type="range" min="0" max="${max - 1}" step="1"><output></output>`;
      const input = row.querySelector("input");
      const output = row.querySelector("output");
      input.value = String(slice[axis]);
      output.textContent = String(slice[axis]);
      input.style.setProperty("--pct", `${(slice[axis] / (max - 1)) * 100}%`);
      input.addEventListener("input", () => {
        slice[axis] = Number(input.value);
        output.textContent = input.value;
        input.style.setProperty("--pct", `${(slice[axis] / (max - 1)) * 100}%`);
        dirty = true;
      });
      sliders.appendChild(row);
    }

    $("resetBtn").addEventListener("click", () => camTo(chapters[current].camera, 1200));
    $("rotateBtn").addEventListener("click", () => {
      userRotate = !controls.autoRotate;
      controls.autoRotate = userRotate && !reducedMotion();
      syncDock();
      dirty = true;
    });
    $("fullBtn").addEventListener("click", () => {
      if (document.fullscreenElement) document.exitFullscreen?.();
      else document.documentElement.requestFullscreen?.().catch(() => {});
    });
    document.addEventListener("fullscreenchange", () => {
      setIcon($("fullBtn").querySelector(".icon"), document.fullscreenElement ? "arrows-in" : "arrows-out");
    });
    $("dockToggle").addEventListener("click", () => {
      const open = !$("dock").classList.contains("open");
      $("dock").classList.toggle("open", open);
      $("dockToggle").setAttribute("aria-expanded", String(open));
    });
  }

  function syncDock() {
    $("modSeg").querySelectorAll("button").forEach((button) => {
      const m = button.dataset.mod;
      button.querySelector(".label").textContent = t(`modShort.${m}`);
      button.title = t(`mod.${m}`);
      button.setAttribute("aria-pressed", String(m === modality));
    });
    $("viewSeg").querySelectorAll("button").forEach((button) => {
      button.textContent = t(VIEW_LABEL[button.dataset.view]);
      button.setAttribute("aria-pressed", String(button.dataset.view === viewMode));
    });
    $("layerChips").querySelectorAll("button").forEach((button) => {
      button.title = t(`cls.${button.dataset.layer}`);
    });
    $("sliceSliders").hidden = viewMode !== "slices";
    $("sliceSliders").querySelectorAll("[data-i18n]").forEach((el) => {
      el.textContent = t(el.dataset.i18n);
    });
    $("rotateBtn").setAttribute("aria-pressed", String(controls.autoRotate));
    setIcon($("rotateBtn").querySelector(".icon"), controls.autoRotate ? "pause" : "play");
  }

  function setView(mode) {
    viewMode = mode;
    for (const [key, value] of Object.entries(VIEWS[mode])) tweens.to(S, { [key]: value }, { duration: 900 });
    syncDock();
    dirty = true;
  }

  async function setModality(m) {
    if (volumes[m]) {
      modality = m;
      syncDock();
      dirty = true;
      return;
    }
    if (pendingModalities.has(m)) return;
    const button = $("modSeg").querySelector(`[data-mod="${m}"]`);
    const progress = button.querySelector(".progress");
    const name = `vol_${m}.bin`;
    pendingModalities.add(m);
    progress.hidden = false;
    progress.textContent = "0%";
    try {
      const bytes = await loadBinary(manifest, name, (loaded) => {
        progress.textContent = `${Math.round((100 * loaded) / manifest.files[name].bytes)}%`;
      });
      volumes[m] = createVolumeTexture(bytes, dims);
      renderer.initTexture(volumes[m]);
      modality = m;
      progress.hidden = true;
    } catch (error) {
      console.error(error);
      progress.textContent = "!";
      button.title = t("loadFail", { file: name });
    } finally {
      pendingModalities.delete(m);
    }
    syncDock();
    dirty = true;
  }

  // ---------- about, hint, keyboard, language ----------
  function buildAbout() {
    const rows = [["mask", manifest.source.mask_sha256], ...MODALITIES.map((m) => [m, manifest.source.modalities[m].sha256])];
    $("aboutBody").innerHTML =
      i18n.about(manifest) + rows.map(([name, hash]) => `<div class="hash-row"><code>${name}</code><span class="hash">${hash}</span></div>`).join("");
  }
  const about = $("about");
  $("aboutBtn").addEventListener("click", () => about.showModal());
  $("aboutClose").addEventListener("click", () => about.close());
  about.addEventListener("click", (event) => {
    if (event.target === about) about.close();
  });

  let hintTimer = 0;
  function hideHint() {
    $("hint").classList.add("gone");
    clearTimeout(hintTimer);
  }

  window.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || about.open) return;
    const tag = event.target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (event.key === "ArrowRight" || event.key === "PageDown") {
      showChapter(current + 1);
      event.preventDefault();
    } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
      showChapter(current - 1);
      event.preventDefault();
    }
  });

  i18n.onChange(() => {
    renderCard();
    callouts.set(chapterLabels(), anchors.tumor);
    updateNav();
    syncDock();
    buildAbout();
    resize();
  });

  renderer.domElement.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    loader.error(t("webgl"), false);
  });

  new ResizeObserver(() => resize()).observe($("story"));
  new ResizeObserver(() => {
    dockRect = $("dock").getBoundingClientRect();
  }).observe($("dock"));
  window.addEventListener("resize", resize);

  if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
    window.hmnunet = {
      S, L, trim, volume, camera, controls, cam, tweens, quality, renderer, show: showChapter,
      get dpr() { return dpr; },
      redraw: () => { dirty = true; },
      // rAF does not fire in a hidden tab; this renders one frame synchronously for inspection
      renderNow(finishTweens = true, scale = 1) {
        const now = performance.now() + (finishTweens ? 1e5 : 0);
        const wasAnimating = camAnimating;
        tweens.update(now);
        if (wasAnimating || camAnimating) applyCamera();
        controls.update();
        renderFrame(scale);
      },
    };
  }

  return {
    precompile,
    start() {
      buildTicks();
      $("prevBtn").addEventListener("click", () => showChapter(current - 1));
      $("nextBtn").addEventListener("click", () => showChapter(current === chapters.length - 1 ? 0 : current + 1));
      buildDock();
      buildAbout();
      resize();
      applyCamera();
      const fromHash = chapters.findIndex((chapter) => `#${chapter.id}` === location.hash);
      showChapter(fromHash >= 0 ? fromHash : 0);
      $("hint").hidden = false;
      hintTimer = setTimeout(hideHint, 7000);
      requestAnimationFrame(frame);
    },
  };
}

boot();
