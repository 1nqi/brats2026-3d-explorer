import { ICONS } from "./icons.js";

// Scene state that chapters and the view controls animate. Every value is a number so the
// tween engine can interpolate between chapters.
export const BASE = {
  volOpacity: 1,
  glass: 0,
  glassDensity: 0.035,
  ghostDensity: 0.012,
  cutOpen: 1,
  box: 0,
  labelMix: 0.55,
  slices: 0,
  et: 1,
  netc: 1,
  cc: 1,
  netcAlpha: 1,
  tint: 0,
  roiBox: 0,
  roiGrow: 0,
  fan4: 0,
  fan4Spread: 0,
  fan6: 0,
  fan6Spread: 0,
  budget: 0,
  proposal: 0,
  proposalCount: 0,
};

export const VIEWS = {
  cut: { glass: 0, cutOpen: 1, box: 0, slices: 0, volOpacity: 1 },
  glass: { glass: 1, cutOpen: 0, box: 0, slices: 0, volOpacity: 1, glassDensity: 0.035 },
  slices: { glass: 1, cutOpen: 0, box: 0, slices: 1, volOpacity: 1, glassDensity: 0.01 },
};

// Published numbers (README and paper, 91 validation cases), not recomputed here.
const OFFICIAL = {
  regions: ["ET", "NETC", "CC", "ED", "TC", "WT"],
  dsc: [0.588, 0.917, 0.204, 0.0, 0.944, 0.944],
  nsd: [0.473, 0.652, 0.185, 0.0, 0.67, 0.671],
  proposals: 29,
  accepted: 27,
  addedET: 4057,
  gpuGiB: 8.3,
  minutes: 89.6,
  ramGiB: 44.0,
  digest: "sha256:71dc5c38efb971cffc982624cc0ea50613751e0e1cf2c7f9bb572f495d34aab6",
};

export const REPO_URL = "https://github.com/1nqi/hmnunet-brats2026-task2";

export function buildChapters(ctx) {
  const { t, num, pct, manifest, anchors } = ctx;
  const counts = manifest.counts;
  const roi = manifest.roi;
  const vox = (n) => `${num(n)} ${ctx.voxels(n)}`;
  const swatch = (name) => `<span class="swatch ${name.toLowerCase()}"></span>`;
  const fact = (value, label, tone) =>
    `<div><div class="fact-value">${tone ? swatch(tone) : ""}${value}</div><div class="fact-label">${label}</div></div>`;
  const more = (title, inner) =>
    `<details class="more"><summary><span class="icon">${ICONS["caret-right"]}</span>${title}</summary><div class="more-body">${inner}</div></details>`;

  const tumorLabels = () => [
    { id: "netc", anchor: anchors.netc[0], html: `NETC <small>${vox(counts.NETC)}</small>`, tone: "var(--netc)", column: true },
    { id: "et", anchor: anchors.et[0], html: `ET <small>${vox(counts.ET)}</small>`, tone: "var(--et)", column: true },
    { id: "cc", anchor: anchors.cc[0], html: `CC <small>${vox(counts.CC)}</small>`, tone: "var(--cc)", column: true },
  ];

  const classFacts = () => `
    <div class="facts">
      ${fact(num(counts.ET), t("cls.ET"), "ET")}
      ${fact(num(counts.NETC), t("cls.NETC"), "NETC")}
      ${fact(num(counts.CC), t("cls.CC"), "CC")}
    </div>`;

  return [
    {
      id: "case",
      mode: "cut",
      camera: { target: "tumor", az: 138, el: 24, dist: 470 },
      state: {},
      delays: { cutOpen: 450, et: 1100, netc: 1100, cc: 1100 },
      durations: { cutOpen: 1900 },
      labels: tumorLabels,
      body: () => `
        <p>${t("ch.case.p1")}</p>
        ${classFacts()}
        <p>${t("ch.case.p2")}</p>`,
    },
    {
      id: "contrasts",
      mode: "glass",
      camera: { target: "fan4", az: 34, el: 26, dist: 820 },
      state: { volOpacity: 0, glassDensity: 0.012, et: 0, netc: 0, cc: 0, fan4: 1, fan4Spread: 1 },
      delays: { fan4Spread: 250 },
      durations: { fan4Spread: 1500, volOpacity: 700 },
      labels: () =>
        ["t1n", "t1c", "t2w", "t2f"].map((m, n) => ({
          id: `sheet-${m}`,
          anchor: anchors.fan4[n],
          live: true,
          direction: [1, 0],
          distance: 36,
          html: `${t(`modShort.${m}`)} <small>${t(`mod.${m}`)}</small>`,
        })),
      body: () => `
        <p>${t("ch.contrasts.p1")}</p>
        <p class="fact-label">${t("ch.contrasts.note", { k: manifest.slices.index + manifest.geometry.crop_origin[2] })}</p>`,
    },
    {
      id: "ensembles",
      mode: "glass",
      camera: { target: "tumor", az: 64, el: 12, dist: 380 },
      state: { glassDensity: 0.03, netcAlpha: 0.5 },
      from: { et: 0, netc: 0, cc: 0 },
      delays: { netc: 500, et: 1300, cc: 2000 },
      durations: { netc: 900, et: 900, cc: 900 },
      labels: tumorLabels,
      body: () => `
        <p>${t("ch.ensembles.p1")}</p>
        <p>${t("ch.ensembles.p2")}</p>
        <div class="facts">
          ${fact("15", t("ch.ensembles.factP"))}
          ${fact("15", t("ch.ensembles.factH"))}
          ${fact("20", t("ch.ensembles.factAll"))}
        </div>
        ${more(t("more"), `<ul><li>${t("ch.ensembles.li1")}</li><li>${t("ch.ensembles.li2")}</li><li>${t("ch.ensembles.li3")}</li><li>${t("ch.ensembles.li4")}</li></ul>`)}`,
    },
    {
      id: "cleanup",
      mode: "glass",
      camera: { target: "tumor", az: 112, el: 16, dist: 270 },
      state: { glassDensity: 0.014, netcAlpha: 0.32 },
      labels: () => {
        const rows = [];
        const thresholds = { ET: 100, NETC: 50, CC: 50 };
        for (const name of ["ET", "NETC", "CC"]) {
          manifest.components[name].forEach((component, n) => {
            rows.push({
              id: `comp-${name}-${n}`,
              anchor: anchors.components[name][n],
              html: `${name} ${num(component.voxels)} <small>≥ ${thresholds[name]}</small>`,
              tone: `var(--${name.toLowerCase()})`,
              column: true,
            });
          });
        }
        return rows;
      },
      body: () => `
        <p>${t("ch.cleanup.p1")}</p>
        <div class="facts">
          ${fact("≥ 50", t("ch.cleanup.tier1"), "CC")}
          ${fact("10 - 49", t("ch.cleanup.tier2"), "NETC")}
          ${fact("< 10", t("ch.cleanup.tier3"))}
        </div>
        <p>${t("ch.cleanup.p2")}</p>
        ${more(t("ch.cleanup.moreTitle"), `<p>${t("ch.cleanup.moreBody")}</p>`)}`,
    },
    {
      id: "roi",
      mode: "glass",
      camera: { target: "roi", az: 140, el: 24, dist: 600 },
      state: { glassDensity: 0.03, roiBox: 1, roiGrow: 1, box: 1, ghostDensity: 0.012, cutOpen: 1 },
      from: { roiGrow: 0, cutOpen: 0 },
      delays: { roiGrow: 700, box: 2100, cutOpen: 2100 },
      durations: { roiGrow: 1300, box: 1300, cutOpen: 1500 },
      labels: () => [
        {
          id: "roi-tight",
          anchor: anchors.tightCorner,
          html: `${t("tightBox")} <small>${roi.tight.map((r) => r[1] - r[0]).join(" × ")}</small>`,
          direction: [1, 0.45],
          distance: 90,
        },
        {
          id: "roi-box",
          anchor: anchors.roiCorner,
          html: `${t("roiBox")} <small>${roi.dims.join(" × ")}</small>`,
          direction: [-1, -0.45],
          distance: 60,
        },
      ],
      body: () => `
        <p>${t("ch.roi.p1")}</p>
        <div class="facts">
          ${fact(roi.dims.join(" × "), t("ch.roi.factBox"))}
          ${fact(pct(roi.fraction_of_image), t("ch.roi.factShare"))}
          ${fact(String(roi.margin), t("ch.roi.factMargin"))}
        </div>
        ${more(t("ch.roi.moreTitle"), `<p>${t("ch.roi.moreBody")}</p>`)}`,
    },
    {
      id: "specialist",
      mode: "glass",
      camera: { target: "fan6", az: 152, el: 48, dist: 780 },
      state: { glassDensity: 0.03, roiBox: 0.3, roiGrow: 1, box: 1, ghostDensity: 0.01, cutOpen: 1, fan6: 1, fan6Spread: 1 },
      delays: { fan6Spread: 300 },
      durations: { fan6Spread: 1500 },
      labels: () =>
        ["t1n", "t1c", "t2w", "t2f", "tc", "sdt"].map((m, n) => ({
          id: `ch6-${m}`,
          anchor: anchors.fan6[n],
          live: true,
          plain: true,
          html: m === "tc" ? t("tcMask") : m === "sdt" ? t("sdt") : t(`modShort.${m}`),
        })),
      body: () => `
        <p>${t("ch.specialist.p1")}</p>
        <div class="facts">
          ${fact("6", t("ch.specialist.factChannels"))}
          ${fact("±20", t("ch.specialist.factClip"))}
          ${fact("258", t("ch.specialist.factCrops"))}
        </div>
        <p>${t("ch.specialist.p2")}</p>`,
    },
    {
      id: "transplant",
      mode: "glass",
      camera: { target: "et", az: 122, el: 22, dist: 230 },
      state: { glassDensity: 0.01, netcAlpha: 0.26, proposal: 1, proposalCount: 640, budget: 1 },
      from: { proposalCount: 0 },
      delays: { proposalCount: 600 },
      durations: { proposalCount: 1600 },
      labels: () => [
        { id: "omega", anchor: anchors.omega, html: ctx.omegaHtml(640), tone: "var(--omega)" },
        { id: "budget", anchor: anchors.budget, html: t("budgetLabel"), direction: [1, -0.5], distance: 36 },
      ],
      body: () => `
        <p>${t("ch.transplant.p1")}</p>
        <div class="formula">Ω = {H = NETC ∧ F = ET ∧ P = NETC}</div>
        <p>${t("ch.transplant.p2")}</p>
        <div class="sim">
          <div class="sim-head"><span class="icon">${ICONS.flask}</span>${t("ch.transplant.simHead")}</div>
          <label class="fact-label" for="simRange">${t("ch.transplant.simLabel")}</label>
          <input type="range" id="simRange" min="0" max="2400" step="10" value="640">
          <div class="range-marks"><span class="m0">0</span><span class="m800">800</span><span class="m2400">${num(2400)}</span></div>
          <div class="sim-read"><span id="simValue"></span><span class="verdict" id="simVerdict"></span></div>
          <p class="sim-note">${t("ch.transplant.simNote")}</p>
        </div>
        <div class="facts">
          ${fact(String(OFFICIAL.proposals), t("ch.transplant.factCases"))}
          ${fact(String(OFFICIAL.accepted), t("ch.transplant.factAccepted"))}
          ${fact(num(OFFICIAL.addedET), t("ch.transplant.factAdded"))}
        </div>
        <p>${t("ch.transplant.p3")}</p>`,
      mount: (root) => ctx.mountSimulation(root),
    },
    {
      id: "guard",
      mode: "glass",
      camera: { target: "tumor", az: 72, el: 18, dist: 340 },
      state: { glassDensity: 0.022, netcAlpha: 0.55 },
      labels: () => [],
      body: () => `
        <p>${t("ch.guard.p1")}</p>
        <table class="truth">
          <thead><tr><th>${t("ch.guard.thP")}</th><th>${t("ch.guard.thH")}</th><th>${t("ch.guard.thOut")}</th></tr></thead>
          <tbody>
            <tr class="active" data-row="p"><td>${t("ch.guard.yes")}</td><td>${t("ch.guard.any")}</td><td>${t("ch.guard.outTransplant")}</td></tr>
            <tr data-row="h"><td>${t("ch.guard.no")}</td><td>${t("ch.guard.yes")}</td><td>${t("ch.guard.outH")}</td></tr>
            <tr data-row="none"><td>${t("ch.guard.no")}</td><td>${t("ch.guard.no")}</td><td>${t("ch.guard.outEmpty")}</td></tr>
          </tbody>
        </table>
        <div class="toggle-row">
          <span id="guardLabel">${t("ch.guard.toggle")}</span>
          <button type="button" class="switch" role="switch" aria-checked="false" id="guardSwitch" aria-labelledby="guardLabel"></button>
        </div>
        <p>${t("ch.guard.p2")}</p>`,
      mount: (root) => ctx.mountGuard(root),
    },
    {
      id: "result",
      mode: "cut",
      camera: { target: "tumor", az: 138, el: 24, dist: 470 },
      state: {},
      autoRotate: true,
      labels: tumorLabels,
      body: () => `
        <p>${t("ch.result.p1")}</p>
        <table class="metrics">
          <thead><tr><th></th>${OFFICIAL.regions.map((r) => `<th>${r}</th>`).join("")}</tr></thead>
          <tbody>
            <tr><td>${t("ch.result.dsc")}</td>${OFFICIAL.dsc.map((v) => `<td>${num(v, 3)}</td>`).join("")}</tr>
            <tr><td>${t("ch.result.nsd")}</td>${OFFICIAL.nsd.map((v) => `<td>${num(v, 3)}</td>`).join("")}</tr>
          </tbody>
        </table>
        <p class="fact-label">${t("ch.result.caption")}. ${t("ch.result.p2")}</p>
        <div class="facts">
          ${fact(`${num(OFFICIAL.gpuGiB, 1)} ${t("unitGiB")}`, t("ch.result.factGpu"))}
          ${fact(`${num(OFFICIAL.minutes, 1)} ${t("unitMin")}`, t("ch.result.factTime"))}
          ${fact(`${num(OFFICIAL.ramGiB, 1)} ${t("unitGiB")}`, t("ch.result.factRam"))}
        </div>
        <p class="fact-label">${t("ch.result.digest")}</p>
        <p class="digest">${OFFICIAL.digest}</p>
        <div class="links">
          <a class="btn-ghost" href="${REPO_URL}" target="_blank" rel="noopener"><span class="icon">${ICONS["github-logo"]}</span>${t("repo")}</a>
        </div>`,
    },
  ];
}
