// UI and story copy in English and Russian. Placeholders look like {name}.
// House rule for this page: no long dashes anywhere in visible text.

const en = {
  lang: "en",
  sceneLabel: "3D view of the MRI case and its tumor segmentation",
  brandSub: "BraTS-PEDs 2026, Task 2",
  about: "About the data",
  aboutTitle: "About this page",
  language: "Language",
  repo: "Code on GitHub",
  chapters: "Chapters",
  prev: "Previous chapter",
  next: "Next",
  restart: "Start over",
  controls: "View controls",
  mri: "MRI",
  view: "View",
  layers: "Layers",
  cutaway: "Cutaway",
  glass: "Glass",
  slices: "Slices",
  axial: "Axial",
  coronal: "Coronal",
  sagittal: "Sagittal",
  resetView: "Reset view",
  autoRotate: "Auto-rotate",
  fullscreen: "Full screen",
  hint: "Drag to rotate, scroll to zoom",
  loading: "Loading the MRI case",
  loadingMore: "Loading {name}",
  retry: "Try again",
  close: "Close",
  more: "Details",
  webgl: "This page needs WebGL 2. Try a current version of Chrome, Edge, Firefox or Safari.",
  loadFail: "Could not load {file}. Check the connection and try again.",
  mod: { t1n: "T1 native", t1c: "T1 with contrast", t2w: "T2-weighted", t2f: "Fluid-attenuated T2" },
  modShort: { t1n: "T1n", t1c: "T1c", t2w: "T2w", t2f: "T2-FLAIR" },
  cls: { ET: "Enhancing tumor", NETC: "Non-enhancing tumor core", CC: "Cyst" },
  voxels: (n) => (n === 1 ? "voxel" : "voxels"),
  tcMask: "TC mask",
  sdt: "Signed distance",
  budgetLabel: "800 voxels",
  omegaLabel: "Ω simulated",
  hLabel: "Output = H",
  tightBox: "TC box",
  roiBox: "ROI, +16 voxels",
  unitGiB: "GiB",
  unitMin: "min",

  ch: {
    case: {
      short: "Case",
      title: "A pediatric brain tumor in 3D",
      p1: "One MRI study from the BraTS-PEDs 2026 challenge: four contrasts at 1 mm, 240 × 240 × 155 voxels. Our system gives every voxel one label, and the cut shows the scan together with those labels.",
      p2: "Use Next or the timeline below to walk through the pipeline. You can rotate and zoom at any point.",
    },
    contrasts: {
      short: "Contrasts",
      title: "Four contrasts, one input",
      p1: "T1c shows where contrast agent accumulates. T2w makes fluid bright, T2-FLAIR suppresses free fluid, and T1n gives the plain anatomy. The networks read all four at once, as one four-channel volume.",
      note: "Axial slice k = {k} through the center of the tumor core.",
    },
    ensembles: {
      short: "Ensembles",
      title: "Two ensembles of fifteen checkpoints",
      p1: "The primary ensemble P averages three nnU-Net residual-encoder models, five folds each, with mirroring at test time. Probabilities are thresholded at 0.5 and painted in a fixed order: edema, then NETC, then ET, then cyst, each layer over the one before.",
      p2: "A second ensemble, H, differs in one member and is never submitted. The mask on screen is H for this case.",
      li1: "P: ResEnc-XL at 500 epochs, ResEnc-XL at 250 epochs with 0.5 foreground oversampling, ResEnc-L at 250 epochs.",
      li2: "H: the same, with ResEnc-XL at 250 epochs in place of the 500-epoch model.",
      li3: "Averaging runs in float32 over the four region channels WT, TC, ET and CC.",
      li4: "H defines the specialist's box and is what the final guard falls back to.",
      factP: "checkpoints in P",
      factH: "checkpoints in H",
      factAll: "distinct checkpoints",
    },
    cleanup: {
      short: "Post-processing",
      title: "Post-processing, once",
      p1: "Edema is dropped from the output. Connected components (26-connectivity) are then filtered by size: ET under 100 voxels and NETC under 50 are removed, and every cyst component is re-tiered.",
      tier1: "50 voxels or more: stays CC",
      tier2: "10 to 49 voxels: becomes NETC",
      tier3: "under 10 voxels: deleted",
      p2: "Every component left in this case clears its threshold. The labels in the scene show their sizes.",
      moreTitle: "Why edema is dropped",
      moreBody: "On development data edema was not recovered reliably, and keeping it only hurt the whole-tumor score. The official ED score of zero is therefore a design decision.",
    },
    roi: {
      short: "ROI",
      title: "A box around the tumor core",
      p1: "The specialist never sees the whole scan. Its input is a crop: the bounding box of H's tumor core, grown by 16 voxels on every side and clipped to the image.",
      factBox: "voxels in the box",
      factShare: "of the scan",
      factMargin: "voxel margin",
      moreTitle: "Same box as in the container",
      moreBody: "Inside the container the box comes from H before post-processing. Post-processing only removes tumor-core voxels, so that box is the one shown here or slightly larger.",
    },
    specialist: {
      short: "Specialist",
      title: "Six channels, one specialist",
      p1: "A five-fold ResEnc-M reads six channels inside the box: the four MRI crops, a hard tumor-core mask, and the signed distance to the core surface, clipped to ±20 voxels.",
      p2: "Its training boxes came from out-of-fold predictions of H, never from ground truth, so it learned on the same kind of box it receives at test time.",
      factChannels: "input channels",
      factClip: "distance clip, voxels",
      factCrops: "training crops",
    },
    transplant: {
      short: "Transplant",
      title: "A transplant with a budget",
      p1: "The specialist F never writes to the output directly. It only feeds a proposal:",
      p2: "Only NETC can become ET, so tumor core, whole tumor and cyst cannot change. If |Ω| ≤ 800 voxels the case takes the proposal; above that it reverts to P, bit for bit.",
      simHead: "Simulation",
      simLabel: "Proposal size",
      accepted: "accepted",
      rolledBack: "reverts to P",
      simNote: "The orange voxels are NETC voxels picked by distance to ET, only to show the rule. The specialist's real output for this case is not part of this page.",
      factCases: "validation cases with a proposal",
      factAccepted: "accepted",
      factAdded: "ET voxels added, 3.0% of all ET",
      p3: "The two rejected proposals had 1,726 and 1,161 voxels. The cube next to the tumor holds exactly 800 voxels, 9.3 mm on a side.",
    },
    guard: {
      short: "Guard",
      title: "One last guard",
      p1: "If P finds no tumor core anywhere but H does, the case gets H unchanged. It is a safety net against an empty primary prediction.",
      thP: "Core in P",
      thH: "Core in H",
      thOut: "Output",
      yes: "yes",
      no: "no",
      any: "any",
      outTransplant: "P after the transplant",
      outH: "H",
      outEmpty: "P, empty",
      toggle: "Simulate an empty P",
      p2: "On the 91 validation cases the guard fired once.",
    },
    result: {
      short: "Result",
      title: "Shipped, then replayed by digest",
      p1: "The submitted container was pulled back from the registry by digest and rerun on all 91 validation cases. Twelve voxels differed across ten cases, with no presence flip, split or merge in any region.",
      caption: "Official challenge server, 91 validation cases",
      dsc: "Global DSC",
      nsd: "Global NSD",
      p2: "ED is zero by design: post-processing deletes edema.",
      factGpu: "peak GPU memory",
      factTime: "for 91 cases",
      factRam: "host memory",
      digest: "Submitted image digest",
    },
  },

  aboutHtml: (m) => `
    <h3>What you are looking at</h3>
    <p>One case, ${m.case}, from the BraTS-PEDs 2026 challenge data (Synapse syn74274097). The data remain under the challenge data use agreement.</p>
    <p>No ground truth is shown, and nothing on this page is an accuracy claim. Official scores come from the challenge server on 91 validation cases.</p>
    <h3>Where the labels come from</h3>
    <p>The mask is the hybrid ensemble H (ResEnc-XL at 250 epochs, ResEnc-XL with 0.5 foreground oversampling and ResEnc-L, five folds each), produced by our RC1 container on 17 July 2026. The primary ensemble P and the specialist output F for this case are not included, which is why the transplant chapter uses a marked simulation.</p>
    <h3>How it is drawn</h3>
    <p>Intensities are windowed to the 0.5th to 99.7th percentile inside the head. Tumor surfaces are marching cubes over lightly smoothed masks, so thin parts can look slightly rounder than the voxel labels painted on the cut faces. The box and the signed distance follow <code>bbox_from_tc</code> and <code>make_d503_crop</code> in the repository.</p>
    <p>For a clean silhouette the solid view trims away the neck, the defaced lower face and the ears with flat cuts. This changes only the picture, not the labels.</p>
    <h3>Input files, SHA-256</h3>
  `,
};

const ru = {
  lang: "ru",
  sceneLabel: "3D-вид МРТ-исследования и сегментации опухоли",
  brandSub: "BraTS-PEDs 2026, задача 2",
  about: "О данных",
  aboutTitle: "Об этой странице",
  language: "Язык",
  repo: "Код на GitHub",
  chapters: "Главы",
  prev: "Предыдущая глава",
  next: "Далее",
  restart: "Сначала",
  controls: "Настройки вида",
  mri: "МРТ",
  view: "Вид",
  layers: "Слои",
  cutaway: "Разрез",
  glass: "Стекло",
  slices: "Срезы",
  axial: "Аксиальный",
  coronal: "Корональный",
  sagittal: "Сагиттальный",
  resetView: "Сбросить вид",
  autoRotate: "Автовращение",
  fullscreen: "Полный экран",
  hint: "Вращайте мышью, приближайте колесом",
  loading: "Загружаем МРТ-исследование",
  loadingMore: "Загружаем {name}",
  retry: "Повторить",
  close: "Закрыть",
  more: "Подробнее",
  webgl: "Для этой страницы нужен WebGL 2. Откройте её в свежей версии Chrome, Edge, Firefox или Safari.",
  loadFail: "Не удалось загрузить {file}. Проверьте соединение и попробуйте ещё раз.",
  mod: { t1n: "T1 без контраста", t1c: "T1 с контрастом", t2w: "T2-взвешенное", t2f: "T2 с подавлением жидкости" },
  modShort: { t1n: "T1n", t1c: "T1c", t2w: "T2w", t2f: "T2-FLAIR" },
  cls: { ET: "Контрастируемая опухоль", NETC: "Неконтрастируемое ядро", CC: "Киста" },
  voxels: (n) => {
    const a = Math.abs(n) % 100;
    const b = a % 10;
    if (a > 10 && a < 20) return "вокселей";
    if (b === 1) return "воксель";
    if (b >= 2 && b <= 4) return "вокселя";
    return "вокселей";
  },
  tcMask: "Маска ядра",
  sdt: "Знаковое расстояние",
  budgetLabel: "800 вокселей",
  omegaLabel: "Ω, симуляция",
  hLabel: "Выход = H",
  tightBox: "Бокс ядра",
  roiBox: "ROI, +16 вокселей",
  unitGiB: "ГиБ",
  unitMin: "мин",

  ch: {
    case: {
      short: "Случай",
      title: "Детская опухоль мозга в 3D",
      p1: "Одно МРТ-исследование из челленджа BraTS-PEDs 2026: четыре контраста с шагом 1 мм, 240 × 240 × 155 вокселей. Система ставит метку каждому вокселю, а разрез показывает снимок вместе с этими метками.",
      p2: "Нажимайте «Далее» или шкалу внизу, чтобы пройти весь пайплайн. Вращать и приближать сцену можно в любой момент.",
    },
    contrasts: {
      short: "Контрасты",
      title: "Четыре контраста, один вход",
      p1: "T1c показывает, где накапливается контрастное вещество. В T2w жидкость яркая, T2-FLAIR подавляет свободную жидкость, а T1n даёт обычную анатомию. Сети читают все четыре сразу, как один четырёхканальный объём.",
      note: "Аксиальный срез k = {k} через центр ядра опухоли.",
    },
    ensembles: {
      short: "Ансамбли",
      title: "Два ансамбля по пятнадцать чекпойнтов",
      p1: "Основной ансамбль P усредняет три модели nnU-Net с residual-энкодером, по пять фолдов каждая, с зеркальными отражениями на инференсе. Вероятности режутся порогом 0,5 и рисуются в фиксированном порядке: отёк, затем NETC, затем ET, затем киста, каждый слой поверх предыдущего.",
      p2: "Второй ансамбль H отличается одной моделью, и его никогда не отправляют. На экране маска H для этого случая.",
      li1: "P: ResEnc-XL на 500 эпох, ResEnc-XL на 250 эпох с оверсэмплингом переднего плана 0,5, ResEnc-L на 250 эпох.",
      li2: "H: то же самое, но вместо модели на 500 эпох стоит ResEnc-XL на 250 эпох.",
      li3: "Усреднение идёт во float32 по четырём региональным каналам WT, TC, ET и CC.",
      li4: "H задаёт бокс для специалиста, и на него откатывается финальная страховка.",
      factP: "чекпойнтов в P",
      factH: "чекпойнтов в H",
      factAll: "уникальных чекпойнтов",
    },
    cleanup: {
      short: "Постобработка",
      title: "Постобработка, один проход",
      p1: "Отёк из выхода удаляется. Затем связные компоненты (26-связность) фильтруются по размеру: ET меньше 100 вокселей и NETC меньше 50 убираются, а каждая компонента кисты переразмечается.",
      tier1: "от 50 вокселей: остаётся CC",
      tier2: "от 10 до 49 вокселей: становится NETC",
      tier3: "меньше 10 вокселей: удаляется",
      p2: "В этом случае все оставшиеся компоненты проходят свои пороги. Метки в сцене показывают их размеры.",
      moreTitle: "Почему отёк удаляется",
      moreBody: "На данных разработки отёк не восстанавливался надёжно, а его сохранение только снижало метрику всей опухоли. Поэтому нулевой официальный балл по ED получен сознательно.",
    },
    roi: {
      short: "ROI",
      title: "Бокс вокруг ядра опухоли",
      p1: "Специалист никогда не видит весь снимок. На вход ему подаётся кроп: ограничивающий бокс ядра опухоли из H, расширенный на 16 вокселей с каждой стороны и обрезанный по границам изображения.",
      factBox: "вокселей в боксе",
      factShare: "от снимка",
      factMargin: "вокселей отступ",
      moreTitle: "Тот же бокс, что в контейнере",
      moreBody: "В контейнере бокс считается по H до постобработки. Постобработка только удаляет воксели ядра, поэтому тот бокс совпадает с показанным или чуть больше.",
    },
    specialist: {
      short: "Специалист",
      title: "Шесть каналов, один специалист",
      p1: "Пятифолдовая ResEnc-M читает внутри бокса шесть каналов: четыре МРТ-кропа, бинарную маску ядра опухоли и знаковое расстояние до его поверхности, обрезанное до ±20 вокселей.",
      p2: "Боксы для обучения брались из out-of-fold предсказаний H, а не из разметки, поэтому модель училась на таких же боксах, какие получает на тесте.",
      factChannels: "входных каналов",
      factClip: "обрезка расстояния, воксели",
      factCrops: "обучающих кропов",
    },
    transplant: {
      short: "Пересадка",
      title: "Пересадка с бюджетом",
      p1: "Специалист F никогда не пишет в выход напрямую. Он лишь формирует предложение:",
      p2: "Только NETC может стать ET, поэтому ядро опухоли, вся опухоль и киста измениться не могут. Если |Ω| ≤ 800 вокселей, случай принимает предложение; если больше, он откатывается к P бит в бит.",
      simHead: "Симуляция",
      simLabel: "Размер предложения",
      accepted: "принято",
      rolledBack: "откат к P",
      simNote: "Оранжевые воксели выбраны из NETC по расстоянию до ET только для демонстрации правила. Настоящего выхода специалиста для этого случая на странице нет.",
      factCases: "валидационных случаев с предложением",
      factAccepted: "принято",
      factAdded: "вокселей ET добавлено, 3,0% всего ET",
      p3: "Отклонены два предложения, размером 1 726 и 1 161 воксель. Кубик рядом с опухолью вмещает ровно 800 вокселей, его ребро 9,3 мм.",
    },
    guard: {
      short: "Страховка",
      title: "Последняя страховка",
      p1: "Если P нигде не находит ядра опухоли, а H находит, случай получает H без изменений. Это страховка от пустого основного предсказания.",
      thP: "Ядро в P",
      thH: "Ядро в H",
      thOut: "Выход",
      yes: "да",
      no: "нет",
      any: "любое",
      outTransplant: "P после пересадки",
      outH: "H",
      outEmpty: "P, пусто",
      toggle: "Симулировать пустой P",
      p2: "На 91 валидационном случае страховка сработала один раз.",
    },
    result: {
      short: "Итог",
      title: "Отправлено и перепроверено по дайджесту",
      p1: "Отправленный контейнер скачали обратно из реестра по дайджесту и заново прогнали на всех 91 валидационных случаях. Различались 12 вокселей в 10 случаях, и ни в одном регионе класс не пропал и не появился, компоненты не разделились и не слились.",
      caption: "Официальный сервер челленджа, 91 валидационный случай",
      dsc: "Global DSC",
      nsd: "Global NSD",
      p2: "ED равен нулю сознательно: постобработка удаляет отёк.",
      factGpu: "пик памяти GPU",
      factTime: "на 91 случай",
      factRam: "память хоста",
      digest: "Дайджест отправленного образа",
    },
  },

  aboutHtml: (m) => `
    <h3>Что на экране</h3>
    <p>Один случай, ${m.case}, из данных челленджа BraTS-PEDs 2026 (Synapse syn74274097). На данные распространяется соглашение об использовании данных челленджа.</p>
    <p>Разметка экспертов не показывается, и ничто на этой странице не является заявлением о точности. Официальные метрики получены на сервере челленджа на 91 валидационном случае.</p>
    <h3>Откуда метки</h3>
    <p>Маска получена гибридным ансамблем H (ResEnc-XL на 250 эпох, ResEnc-XL с оверсэмплингом переднего плана 0,5 и ResEnc-L, по пять фолдов), нашим контейнером RC1 17 июля 2026 года. Основного ансамбля P и выхода специалиста F для этого случая здесь нет, поэтому в главе о пересадке используется помеченная симуляция.</p>
    <h3>Как это нарисовано</h3>
    <p>Интенсивности отнормированы по перцентилям от 0,5 до 99,7 внутри головы. Поверхности опухоли построены marching cubes по слегка сглаженным маскам, поэтому тонкие места могут выглядеть чуть круглее, чем воксельные метки на гранях разреза. Бокс и знаковое расстояние считаются как <code>bbox_from_tc</code> и <code>make_d503_crop</code> в репозитории.</p>
    <p>Ради чистого силуэта в сплошном виде шея, деидентифицированная нижняя часть лица и уши срезаны плоскостями. Это меняет только картинку, но не метки.</p>
    <h3>Входные файлы, SHA-256</h3>
  `,
};

const DICTS = { en, ru };

export function createI18n(initial) {
  let dict = DICTS[initial] || en;
  const listeners = new Set();
  const lookup = (key) => key.split(".").reduce((node, part) => (node == null ? node : node[part]), dict);

  const api = {
    get lang() {
      return dict.lang;
    },
    t(key, vars) {
      let value = lookup(key);
      if (value == null) value = key.split(".").reduce((node, part) => (node == null ? node : node[part]), en) ?? key;
      if (typeof value === "string" && vars) value = value.replace(/\{(\w+)\}/g, (_, name) => (name in vars ? vars[name] : `{${name}}`));
      return value;
    },
    num(value, digits = 0) {
      return new Intl.NumberFormat(dict.lang === "ru" ? "ru-RU" : "en-US", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }).format(value);
    },
    pct(fraction, digits = 1) {
      return new Intl.NumberFormat(dict.lang === "ru" ? "ru-RU" : "en-US", {
        style: "percent",
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }).format(fraction);
    },
    voxels(n) {
      return dict.voxels(n);
    },
    about(manifest) {
      return dict.aboutHtml(manifest);
    },
    set(lang) {
      if (!DICTS[lang] || lang === dict.lang) return;
      dict = DICTS[lang];
      listeners.forEach((fn) => fn(lang));
    },
    onChange(fn) {
      listeners.add(fn);
    },
  };
  return api;
}

export function preferredLanguage() {
  try {
    const fromUrl = new URLSearchParams(location.search).get("lang");
    if (fromUrl === "ru" || fromUrl === "en") return fromUrl;
    const saved = localStorage.getItem("hmnunet3d.lang");
    if (saved === "ru" || saved === "en") return saved;
  } catch {}
  return (navigator.language || "en").toLowerCase().startsWith("ru") ? "ru" : "en";
}

export function rememberLanguage(lang) {
  try {
    localStorage.setItem("hmnunet3d.lang", lang);
  } catch {}
}
