// Fetches the manifest and binary volumes. The server sends the .bin files gzip-encoded, so
// the browser hands us decompressed bytes and progress is counted against the raw size.

export async function loadManifest() {
  const response = await fetch("data/manifest.json", { cache: "no-cache" });
  if (!response.ok) throw loadError("manifest.json", `HTTP ${response.status}`);
  return response.json();
}

export async function loadBinary(manifest, name, onProgress = () => {}) {
  const info = manifest.files[name];
  if (!info) throw loadError(name, "not listed in the manifest");
  let response;
  try {
    response = await fetch(`data/${name}?v=${manifest.version}`);
  } catch (error) {
    throw loadError(name, error.message);
  }
  if (!response.ok) throw loadError(name, `HTTP ${response.status}`);

  const out = new Uint8Array(info.bytes);
  if (!response.body) {
    const whole = new Uint8Array(await response.arrayBuffer());
    if (whole.length !== info.bytes) throw loadError(name, `size ${whole.length} != ${info.bytes}`);
    onProgress(info.bytes);
    return whole;
  }
  const reader = response.body.getReader();
  let offset = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (offset + value.length > out.length) throw loadError(name, "more bytes than the manifest lists");
    out.set(value, offset);
    offset += value.length;
    onProgress(offset);
  }
  if (offset !== info.bytes) throw loadError(name, `size ${offset} != ${info.bytes}`);
  return out;
}

// Loads several files in parallel and reports one combined fraction, weighted by transfer size.
export async function loadGroup(manifest, names, onProgress = () => {}) {
  const done = Object.fromEntries(names.map((n) => [n, 0]));
  const weight = Object.fromEntries(names.map((n) => [n, manifest.files[n].gzip]));
  const total = names.reduce((sum, n) => sum + weight[n], 0);
  const report = () => {
    const loaded = names.reduce((sum, n) => sum + (done[n] / manifest.files[n].bytes) * weight[n], 0);
    onProgress(loaded / total, loaded, total);
  };
  const buffers = await Promise.all(
    names.map((n) => loadBinary(manifest, n, (bytes) => { done[n] = bytes; report(); })),
  );
  return Object.fromEntries(names.map((n, i) => [n, buffers[i]]));
}

function loadError(file, detail) {
  const error = new Error(`${file}: ${detail}`);
  error.file = file;
  return error;
}
