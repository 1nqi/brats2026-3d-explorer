import * as THREE from "../vendor/three/three.min.js";

// HTML callouts anchored to 3D points. A callout is a dot on the anchor, a leader line and a
// text box. Boxes are kept inside the viewport; boxes flagged as a column line up beside
// their anchors, sorted by height, and stay clear of panels such as the view dock.

const projected = new THREE.Vector3();
const MARGIN = 8;
const TOP = 64;

export class Callouts {
  // obstacles() returns DOMRects (panels) that a label column must stay clear of.
  constructor(root, obstacles = () => []) {
    this.root = root;
    this.items = new Map();
    this.focus = new THREE.Vector3();
    this.obstacles = obstacles;
  }

  set(list, focus) {
    if (focus) this.focus.copy(focus);
    const keep = new Set(list.map((item) => item.id));
    for (const [id, item] of this.items) {
      if (!keep.has(id)) {
        item.el.style.opacity = "0";
        item.dead = true;
        setTimeout(() => {
          if (item.dead) {
            item.el.remove();
            this.items.delete(id);
          }
        }, 380);
      }
    }
    for (const spec of list) {
      let item = this.items.get(spec.id);
      if (!item) {
        const el = document.createElement("div");
        el.className = "callout";
        el.innerHTML = '<span class="callout-line"></span><span class="callout-dot"></span><span class="callout-text"></span>';
        el.style.opacity = "0";
        this.root.appendChild(el);
        item = { el, line: el.children[0], text: el.children[2] };
        this.items.set(spec.id, item);
        requestAnimationFrame(() => { if (!item.dead) el.style.opacity = "1"; });
      }
      item.dead = false;
      item.el.style.opacity = "1";
      item.anchor = spec.live ? spec.anchor : spec.anchor.clone();
      item.distance = spec.distance ?? 64;
      item.direction = spec.direction ?? null;
      item.plain = !!spec.plain;
      item.column = !!spec.column;
      item.el.classList.toggle("plain", item.plain);
      if (spec.tone) {
        item.el.dataset.tone = "";
        item.el.style.setProperty("--tone", spec.tone);
      } else {
        delete item.el.dataset.tone;
      }
      if (item.html !== spec.html) {
        item.text.innerHTML = spec.html;
        item.html = spec.html;
        item.size = null;
      }
    }
  }

  updateHtml(id, html) {
    const item = this.items.get(id);
    if (!item || item.html === html) return;
    item.text.innerHTML = html;
    item.html = html;
    item.size = null;
  }

  update(camera, width, height) {
    if (!this.items.size) return;
    projected.copy(this.focus).project(camera);
    const fx = (projected.x * 0.5 + 0.5) * width;
    const fy = (-projected.y * 0.5 + 0.5) * height;
    const column = [];

    for (const item of this.items.values()) {
      projected.copy(item.anchor).project(camera);
      const hidden = projected.z > 1 || projected.z < -1;
      item.el.style.visibility = hidden ? "hidden" : "visible";
      if (hidden) continue;
      const x = (projected.x * 0.5 + 0.5) * width;
      const y = (-projected.y * 0.5 + 0.5) * height;
      if (!item.size) item.size = [item.text.offsetWidth, item.text.offsetHeight];
      const [w, h] = item.size;

      if (item.column && !item.dead) {
        column.push({ item, x, y, w, h });
        continue;
      }
      if (item.plain) {
        this.place(item, x, y, x - w / 2, y - h / 2, width, height, false);
        continue;
      }
      let [dx, dy] = item.direction ?? [x - fx, y - fy];
      if (!item.direction && Math.hypot(dx, dy) < 8) [dx, dy] = [0.8, -0.6];
      const len = Math.hypot(dx, dy) || 1;
      const ex = x + (dx / len) * item.distance;
      const ey = y + (dy / len) * item.distance;
      const left = dx >= 0 ? ex + 4 : ex - w - 4;
      this.place(item, x, y, left, ey - h / 2, width, height, true);
    }
    if (column.length) this.layoutColumn(column, width, height);
  }

  // Positions one callout: the box is clamped into the viewport and the leader line runs from
  // the anchor to the nearer vertical edge of the box.
  place(item, x, y, left, top, width, height, withLine) {
    const [w, h] = item.size;
    const boxLeft = Math.min(Math.max(left, MARGIN), width - w - MARGIN);
    const boxTop = Math.min(Math.max(top, TOP), height - h - MARGIN);
    item.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    item.text.style.transform = `translate(${(boxLeft - x).toFixed(1)}px, ${(boxTop - y).toFixed(1)}px)`;
    if (!withLine) return;
    const endX = x <= boxLeft ? boxLeft : x >= boxLeft + w ? boxLeft + w : x;
    const endY = x > boxLeft && x < boxLeft + w ? (y < boxTop ? boxTop : boxTop + h) : boxTop + h / 2;
    const lx = endX - x;
    const ly = endY - y;
    item.line.style.width = `${Math.hypot(lx, ly).toFixed(1)}px`;
    item.line.style.transform = `rotate(${Math.atan2(ly, lx)}rad)`;
  }

  layoutColumn(column, width, height) {
    const widest = Math.max(...column.map((c) => c.w));
    let right = Math.max(...column.map((c) => c.x)) + 120;
    right = Math.min(right, width - widest - MARGIN - 4);
    let top = TOP + 12;
    let bottom = height - 24;
    for (const rect of this.obstacles()) {
      if (rect.width && right + widest > rect.left && right < rect.right) {
        if (rect.top > height / 2) bottom = Math.min(bottom, rect.top - 16);
        else top = Math.max(top, rect.bottom + 16);
      }
    }
    const tallest = Math.max(...column.map((c) => c.h));
    const gap = Math.max(tallest + 6, Math.min(48, (bottom - top) / Math.max(1, column.length - 1)));
    column.sort((a, b) => a.y - b.y);
    const ys = column.map((c) => c.y);
    for (let n = 1; n < ys.length; n++) ys[n] = Math.max(ys[n], ys[n - 1] + gap);
    const centre = (column[0].y + column[column.length - 1].y) / 2;
    let shift = (ys[0] + ys[ys.length - 1]) / 2 - centre;
    if (ys[ys.length - 1] - shift > bottom) shift = ys[ys.length - 1] - bottom;
    if (ys[0] - shift < top) shift = ys[0] - top;
    column.forEach(({ item, x, y, h }, n) => {
      this.place(item, x, y, right + 4, ys[n] - shift - h / 2, width, height, true);
    });
  }
}
