// Captures the README preview images with headless Chrome over the DevTools protocol.
//
//   node site/server.js 3217 --dev          (in another terminal)
//   node tools/capture_preview.mjs [baseUrl]
//
// Uses a throwaway Chrome profile, never the user's. Needs Node >= 22 (global WebSocket) and
// Google Chrome; set CHROME to another Chromium binary if needed. The page's localhost-only
// window.hmnunet hook is used to finish chapter animations before each capture.

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "docs", "preview");
const BASE = process.argv[2] || "http://localhost:3217/";
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9333;

// Output width = CSS width * scale. The hero is wide; the grid images are smaller.
const SHOTS = [
  { file: "hero.jpg", chapter: "case", width: 1440, height: 900, scale: 1600 / 1440 },
  { file: "contrasts.jpg", chapter: "contrasts", width: 1440, height: 900, scale: 1200 / 1440 },
  { file: "ensembles.jpg", chapter: "ensembles", width: 1440, height: 900, scale: 1200 / 1440 },
  { file: "specialist.jpg", chapter: "specialist", width: 1440, height: 900, scale: 1200 / 1440 },
  { file: "transplant.jpg", chapter: "transplant", width: 1440, height: 900, scale: 1200 / 1440 },
  { file: "mobile.jpg", chapter: "case", width: 390, height: 844, scale: 2, mobile: true },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function pageTarget() {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((target) => target.type === "page");
      if (page) return page;
    } catch {}
    await sleep(250);
  }
  throw new Error("Chrome did not expose a page target");
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const pending = new Map();
    const listeners = new Set();
    let nextId = 0;
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        const { ok, fail } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) fail(new Error(message.error.message));
        else ok(message.result);
      } else if (message.method) {
        listeners.forEach((listener) => listener(message));
      }
    };
    socket.onerror = () => reject(new Error(`cannot connect to ${url}`));
    socket.onopen = () =>
      resolve({
        send(method, params = {}) {
          return new Promise((ok, fail) => {
            const id = ++nextId;
            pending.set(id, { ok, fail });
            socket.send(JSON.stringify({ id, method, params }));
          });
        },
        once(method) {
          return new Promise((ok) => {
            const listener = (message) => {
              if (message.method !== method) return;
              listeners.delete(listener);
              ok(message.params);
            };
            listeners.add(listener);
          });
        },
        close() {
          socket.close();
        },
      });
  });
}

async function evaluate(cdp, expression) {
  const { result, exceptionDetails } = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
  return result.value;
}

async function waitFor(cdp, expression, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(cdp, expression).catch(() => false)) return;
    await sleep(250);
  }
  throw new Error(`timed out waiting for: ${expression}`);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const profile = mkdtempSync(join(tmpdir(), "explorer-capture-"));
  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--hide-scrollbars",
      "--mute-audio",
      "--ignore-gpu-blocklist",
      "--enable-gpu",
      "--use-angle=d3d11",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  chrome.on("error", (error) => {
    console.error(`cannot start Chrome at ${CHROME}: ${error.message}`);
    process.exit(1);
  });

  try {
    const cdp = await connect((await pageTarget()).webSocketDebuggerUrl);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");

    for (const shot of SHOTS) {
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: shot.width,
        height: shot.height,
        deviceScaleFactor: shot.scale,
        mobile: !!shot.mobile,
      });
      const loaded = cdp.once("Page.loadEventFired");
      await cdp.send("Page.navigate", { url: `${BASE}?lang=en&capture=${shot.file}#${shot.chapter}` });
      await loaded;
      await waitFor(cdp, "Boolean(window.hmnunet) && document.getElementById('loader').classList.contains('done')");
      await evaluate(cdp, `(() => {
        const app = window.hmnunet;
        app.controls.autoRotate = false;
        app.renderNow(true);
        app.renderNow(true);
        document.getElementById("hint").hidden = true;
        document.querySelectorAll(".story-enter").forEach((el) => el.classList.remove("story-enter"));
        return true;
      })()`);
      await sleep(900);
      await evaluate(cdp, "window.hmnunet.renderNow(true), true");
      await sleep(250);
      const { data } = await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 90 });
      writeFileSync(join(OUT, shot.file), Buffer.from(data, "base64"));
      console.log("saved", shot.file);
    }

    const renderer = await evaluate(cdp, `(() => {
      const gl = document.getElementById("scene").getContext("webgl2");
      const info = gl && gl.getExtension("WEBGL_debug_renderer_info");
      return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : "unknown";
    })()`);
    console.log("renderer:", renderer);
    cdp.close();
  } finally {
    chrome.kill();
    await sleep(800);
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {}
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
