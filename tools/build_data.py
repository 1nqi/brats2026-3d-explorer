#!/usr/bin/env python3
"""Build the browser data for the HMNUnet 3D explorer from one BraTS-PEDs case.

Read-only inputs:
  <SRC>/test_input/<CASE>/<CASE>-{t1n,t1c,t2w,t2f}.nii.gz   (1 mm, 240x240x155)
  <SRC>/test_output/<CASE>.nii.gz                          (uint8 labels {0,1,2,3})

The label map is the hybrid ensemble H (XL250 + OS5 + L, five folds each, post-processed)
produced by our RC1 container. Everything derived here follows the repo's operators:
TC = labels {1,2,3}; ROI = TC bounding box +16 voxels clipped to the image (bbox_from_tc);
signed distance = edt(TC) - edt(~TC) inside the crop, clipped to +-20 (make_d503_crop).

Outputs into site/public/data/ (binary files are written gzip-compressed, name.bin.gz):
  manifest.json   geometry, counts, components, ROI, windows, file index, input hashes
  vol_<mod>.bin   uint8 intensity volume cropped to the head, 0 outside the head
  masks.bin       RG8: R = smoothed head mask, G = label (never name a file aux.*: AUX is a
                  reserved device name on Windows and git cannot add it)
  sdt.bin         uint8 signed distance inside the ROI, (sdt + 20) * 6.35
  meshes.bin      quantised surfaces for ET, NETC, CC (uint16 positions, int8 normals)
  proposal.bin    uint8 (i,j,k) of NETC voxels ordered by distance to ET (simulation only)
  slices.bin      four uint8 axial slices through the tumour centre, one per modality
"""
from __future__ import annotations

import gzip
import hashlib
import json
import struct
import sys
from pathlib import Path

import numpy as np
from scipy import ndimage as ndi
from skimage import measure

CASE = "BraTS-PED-00001-000"
SRC = Path(r"C:\Users\user\Desktop\brats")
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "site" / "public" / "data"
DIAG = Path(sys.argv[1]) if len(sys.argv) > 1 else None

MODS = ("t1n", "t1c", "t2w", "t2f")
LABELS = {1: "ET", 2: "NETC", 3: "CC"}
MARGIN503 = 16
SDT_CLIP = 20
SIM_VOXELS = 2400
POS_QUANT = 64
FULL26 = np.ones((3, 3, 3), dtype=bool)


def read_nii(path: Path):
    raw = path.read_bytes()
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    if struct.unpack("<i", raw[:4])[0] != 348:
        raise SystemExit(f"{path}: not a little-endian NIfTI-1 file")
    dim = struct.unpack("<8h", raw[40:56])
    datatype = struct.unpack("<h", raw[70:72])[0]
    pixdim = struct.unpack("<8f", raw[76:108])
    vox_offset = int(struct.unpack("<f", raw[108:112])[0])
    slope, inter = struct.unpack("<ff", raw[112:120])
    srow = np.array([struct.unpack("<4f", raw[280 + 16 * r:296 + 16 * r]) for r in range(3)])
    dtype = {2: "<u1", 4: "<i2", 8: "<i4", 16: "<f4", 64: "<f8", 512: "<u2"}[datatype]
    shape = tuple(dim[1:4])
    arr = np.frombuffer(raw, dtype=dtype, count=int(np.prod(shape)), offset=vox_offset)
    arr = arr.reshape(shape, order="F")
    if slope not in (0.0, 1.0) or inter != 0.0:
        arr = arr * slope + inter
    return arr, srow, tuple(round(p, 4) for p in pixdim[1:4])


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1 << 22), b""):
            digest.update(block)
    return digest.hexdigest()


def tex_bytes(arr: np.ndarray) -> bytes:
    """(i,j,k) array -> WebGL Data3DTexture order (i fastest, k slowest)."""
    return np.ascontiguousarray(arr.transpose(2, 1, 0)).tobytes()


def write_bin(name: str, payload: bytes, files: dict) -> None:
    """Only the gzip twin is written; the server sends it with Content-Encoding: gzip."""
    packed = gzip.compress(payload, compresslevel=9, mtime=0)
    (OUT / f"{name}.gz").write_bytes(packed)
    files[name] = {"bytes": len(payload), "gzip": len(packed), "sha256": hashlib.sha256(payload).hexdigest()}


def keep_largest(mask: np.ndarray) -> np.ndarray:
    lab, n = ndi.label(mask)
    if n <= 1:
        return mask
    sizes = np.bincount(lab.ravel())
    sizes[0] = 0
    return lab == sizes.argmax()


def head_mask(volumes: dict) -> np.ndarray:
    stack = []
    for arr in volumes.values():
        positive = arr[arr > 0]
        stack.append(np.clip(arr / np.percentile(positive, 99.5), 0, 1))
    signal = np.max(stack, axis=0)
    head = keep_largest(signal > 0.06)
    head = ndi.binary_closing(head, structure=FULL26, iterations=4)
    head = ndi.binary_fill_holes(head)
    for axis in range(3):  # close sinuses and ear canals that open to the outside
        moved = np.moveaxis(head, axis, 0)
        for s in range(moved.shape[0]):
            moved[s] = ndi.binary_fill_holes(moved[s])
    # A 5 mm ball opening removes thin flaps such as the ears so the rendered shell stays clean.
    r = 5
    grid = np.mgrid[-r:r + 1, -r:r + 1, -r:r + 1]
    ball = (grid ** 2).sum(0) <= r * r
    head = ndi.binary_opening(head, structure=ball)
    return keep_largest(head)


def components(mask: np.ndarray) -> list[dict]:
    lab, n = ndi.label(mask, structure=FULL26)
    if n == 0:
        return []
    sizes = np.bincount(lab.ravel())
    centres = ndi.center_of_mass(mask, lab, range(1, n + 1))
    rows = [
        {"voxels": int(sizes[c]), "centroid": [round(float(v), 2) for v in centres[c - 1]]}
        for c in range(1, n + 1)
    ]
    return sorted(rows, key=lambda r: -r["voxels"])


def surface(mask: np.ndarray, sigma: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    idx = np.argwhere(mask)
    lo = np.maximum(idx.min(0) - 4, 0)
    hi = np.minimum(idx.max(0) + 5, mask.shape)
    sub = np.pad(mask[lo[0]:hi[0], lo[1]:hi[1], lo[2]:hi[2]].astype(np.float32), 3)
    field = ndi.gaussian_filter(sub, sigma)
    verts, faces, normals, _ = measure.marching_cubes(
        field, level=0.5, gradient_direction="descent", allow_degenerate=False
    )
    verts = verts - 3 + lo + 0.5  # voxel centres sit at i + 0.5 in texture space
    tri = verts[faces]
    signed = np.einsum("ij,ij->i", tri[:, 0], np.cross(tri[:, 1], tri[:, 2])).sum() / 6.0
    if signed < 0:
        faces = faces[:, [0, 2, 1]]
    return verts.astype(np.float32), normals.astype(np.float32), faces.astype(np.uint32)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    seg_path = SRC / "test_output" / f"{CASE}.nii.gz"
    mod_paths = {m: SRC / "test_input" / CASE / f"{CASE}-{m}.nii.gz" for m in MODS}

    seg, seg_srow, spacing = read_nii(seg_path)
    seg = np.rint(seg).astype(np.uint8)
    volumes = {}
    for m, path in mod_paths.items():
        arr, srow, sp = read_nii(path)
        if arr.shape != seg.shape or not np.allclose(srow, seg_srow) or sp != spacing:
            raise SystemExit(f"{m}: geometry differs from the label map")
        volumes[m] = arr.astype(np.float32)
    if set(np.unique(seg).tolist()) - {0, 1, 2, 3}:
        raise SystemExit("unexpected labels in the mask")
    if spacing != (1.0, 1.0, 1.0):
        raise SystemExit(f"expected 1 mm isotropic data, got {spacing}")
    shape = seg.shape
    print("geometry", shape, "srow", seg_srow.tolist())

    # ---- head mask and crop ------------------------------------------------------
    head = head_mask(volumes)
    if (seg > 0).any() and not head[seg > 0].all():
        head |= ndi.binary_dilation(seg > 0, iterations=2)
    hidx = np.argwhere(head)
    c0 = np.maximum(hidx.min(0) - 3, 0)
    c1 = np.minimum(hidx.max(0) + 4, shape)
    crop = tuple(slice(int(a), int(b)) for a, b in zip(c0, c1))
    dims = [int(b - a) for a, b in zip(c0, c1)]
    print("head crop", c0.tolist(), c1.tolist(), "dims", dims)

    head_c = head[crop]
    seg_c = seg[crop]
    head_smooth = np.clip(ndi.gaussian_filter(head_c.astype(np.float32), 1.8) * 255.0, 0, 255)
    files: dict = {}
    write_bin("masks.bin", np.stack([
        np.ascontiguousarray(head_smooth.astype(np.uint8).transpose(2, 1, 0)),
        np.ascontiguousarray(seg_c.transpose(2, 1, 0)),
    ], axis=-1).tobytes(), files)

    # ---- intensity volumes -------------------------------------------------------
    windows = {}
    tc_full = np.isin(seg, (1, 2, 3))
    centre = np.round(np.argwhere(tc_full).mean(0)).astype(int)
    k_mid = int(centre[2])
    slices = []
    for m in MODS:
        arr = volumes[m][crop]
        inside = arr[head_c]
        lo, hi = (float(v) for v in np.percentile(inside, [0.5, 99.7]))
        scaled = np.clip((arr - lo) / max(hi - lo, 1e-6), 0, 1) * 254.0 + 1.0
        scaled[~head_c] = 0
        vol8 = np.rint(scaled).astype(np.uint8)
        windows[m] = {"low": round(lo, 3), "high": round(hi, 3)}
        write_bin(f"vol_{m}.bin", tex_bytes(vol8), files)
        slices.append(np.ascontiguousarray(vol8[:, :, k_mid - int(c0[2])].T))  # rows = j, cols = i
    write_bin("slices.bin", b"".join(s.tobytes() for s in slices), files)

    # ---- counts and components ------------------------------------------------------
    counts = {LABELS[k]: int((seg == k).sum()) for k in LABELS}
    comps = {}
    for k, name in LABELS.items():
        rows = components(seg == k)
        for row in rows:
            row["centroid"] = [round(v - float(c0[a]) + 0.5, 2) for a, v in enumerate(row["centroid"])]
        comps[name] = rows
    tc_rows = components(tc_full)

    # ---- ROI exactly as bbox_from_tc, then crop-local signed distance ---------------------
    tidx = np.where(tc_full)
    tight = [[int(ax.min()), int(ax.max()) + 1] for ax in tidx]
    roi = [[max(0, int(ax.min()) - MARGIN503), min(shape[a], int(ax.max()) + MARGIN503 + 1)]
           for a, ax in enumerate(tidx)]
    roi_slices = tuple(slice(a, b) for a, b in roi)
    hard_tc = tc_full[roi_slices].astype(np.float32)
    sdt = np.clip(ndi.distance_transform_edt(hard_tc > 0) - ndi.distance_transform_edt(hard_tc == 0),
                  -SDT_CLIP, SDT_CLIP)
    sdt8 = np.rint((sdt + SDT_CLIP) * (254.0 / (2 * SDT_CLIP))).astype(np.uint8)
    write_bin("sdt.bin", tex_bytes(sdt8), files)
    roi_dims = [b - a for a, b in roi]
    print("TC tight", tight, "ROI", roi, "dims", roi_dims)

    # ---- meshes (positions uint16 in 1/64 voxel, normals int8, indices uint16/uint32) ----
    mesh_index = []
    blobs = []
    offset = 0
    for name, mask, sigma in (
        ("ET", seg_c == 1, 0.8),
        ("NETC", seg_c == 2, 0.9),
        ("CC", seg_c == 3, 0.7),
    ):
        verts, normals, faces = surface(mask, sigma)
        qpos = np.rint(verts * POS_QUANT).astype(np.uint16)
        norm = normals / np.maximum(np.linalg.norm(normals, axis=1, keepdims=True), 1e-6)
        qnorm = np.rint(norm * 127.0).astype(np.int8)
        index_type = np.uint16 if len(verts) < 65536 else np.uint32
        entry = {"name": name, "vertices": int(len(verts)), "triangles": int(len(faces)),
                 "position_scale": 1.0 / POS_QUANT, "index_type": np.dtype(index_type).name}
        for key, arr in (("position", qpos), ("normal", qnorm), ("index", faces.astype(index_type))):
            data = arr.tobytes()
            pad = (-len(data)) % 4
            entry[key] = [offset, len(data)]
            blobs.append(data + b"\0" * pad)
            offset += len(data) + pad
        mesh_index.append(entry)
        print("mesh", name, entry["vertices"], "verts", entry["triangles"], "tris")
    write_bin("meshes.bin", b"".join(blobs), files)

    # ---- simulated proposal ordering (illustration of the budget rule only) ----------------
    rng = np.random.default_rng(800)
    dist_et = ndi.distance_transform_edt(seg_c != 1)
    netc_idx = np.argwhere(seg_c == 2)
    netc_dist = dist_et[seg_c == 2]
    order = np.lexsort((rng.random(len(netc_idx)), netc_dist))[:SIM_VOXELS]
    write_bin("proposal.bin", netc_idx[order].astype(np.uint8).tobytes(), files)

    # ---- manifest ---------------------------------------------------------------------
    version = hashlib.sha256("".join(files[k]["sha256"] for k in sorted(files)).encode()).hexdigest()[:12]
    manifest = {
        "case": CASE,
        "version": version,
        "source": {
            "mask": seg_path.name,
            "mask_sha256": sha256(seg_path),
            "modalities": {m: {"file": p.name, "sha256": sha256(p)} for m, p in mod_paths.items()},
            "mask_provenance": "hybrid ensemble H (XL250 + OS5 + L), RC1 container run, 17 Jul 2026",
        },
        "geometry": {
            "full_shape": list(shape),
            "spacing_mm": list(spacing),
            "voxel_axes": "i = left, j = posterior, k = superior",
            "crop_origin": [int(v) for v in c0],
            "dims": dims,
        },
        "modalities": list(MODS),
        "windows": windows,
        "counts": counts,
        "components": comps,
        "tc_components": len(tc_rows),
        "tc_voxels": int(tc_full.sum()),
        "tc_centroid": [round(float(v) - float(c0[a]) + 0.5, 2)
                        for a, v in enumerate(np.argwhere(tc_full).mean(0))],
        "roi": {
            "margin": MARGIN503,
            "tight": [[a - int(c0[i]), b - int(c0[i])] for i, (a, b) in enumerate(tight)],
            "box": [[a - int(c0[i]), b - int(c0[i])] for i, (a, b) in enumerate(roi)],
            "dims": roi_dims,
            "voxels": int(np.prod(roi_dims)),
            "fraction_of_image": round(float(np.prod(roi_dims)) / float(np.prod(shape)), 5),
            "sdt_clip": SDT_CLIP,
            "sdt_scale": round(254.0 / (2 * SDT_CLIP), 5),
        },
        "slices": {"axis": "k", "index": k_mid - int(c0[2]), "width": dims[0], "height": dims[1],
                   "order": list(MODS)},
        "proposal_simulation": {"voxels": SIM_VOXELS, "rule": "NETC voxels ordered by distance to ET, seeded ties"},
        "meshes": mesh_index,
        "files": files,
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    total_gz = sum(v["gzip"] for v in files.values())
    print("counts", counts)
    print("components", {k: [r["voxels"] for r in v] for k, v in comps.items()})
    print("files", {k: (round(v["bytes"] / 1e6, 2), round(v["gzip"] / 1e6, 2)) for k, v in files.items()})
    print("total gzip MB", round(total_gz / 1e6, 2))

    if DIAG is not None:
        diagnostics(volumes, head, seg, centre, roi, DIAG)


def diagnostics(volumes, head, seg, centre, roi, out_dir: Path) -> None:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    out_dir.mkdir(parents=True, exist_ok=True)
    i, j, k = (int(v) for v in centre)
    colours = {1: (0.89, 0.10, 0.11), 2: (0.22, 0.49, 0.72), 3: (0.30, 0.69, 0.29)}
    fig, axes = plt.subplots(4, 3, figsize=(10, 13))
    for r, m in enumerate(MODS):
        vol = volumes[m]
        views = (
            ("axial k", vol[:, :, k].T, seg[:, :, k].T, head[:, :, k].T),
            ("coronal j", vol[:, j, :].T, seg[:, j, :].T, head[:, j, :].T),
            ("sagittal i", vol[i, :, :].T, seg[i, :, :].T, head[i, :, :].T),
        )
        for c, (title, img, lab, hm) in enumerate(views):
            ax = axes[r, c]
            ax.imshow(img, cmap="gray", origin="lower", vmin=0, vmax=np.percentile(vol[vol > 0], 99.5))
            over = np.zeros(lab.shape + (4,), np.float32)
            for value, rgb in colours.items():
                over[lab == value] = (*rgb, 0.5)
            ax.imshow(over, origin="lower")
            ax.contour(hm, levels=[0.5], colors="yellow", linewidths=0.6, origin="lower")
            ax.set_title(f"{m} {title}", fontsize=8)
            ax.set_xticks([]); ax.set_yticks([])
    fig.tight_layout()
    fig.savefig(out_dir / "diag_views.png", dpi=80)
    plt.close(fig)
    print("diagnostics ->", out_dir / "diag_views.png")


if __name__ == "__main__":
    main()
