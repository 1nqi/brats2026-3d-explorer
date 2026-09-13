// Minimal tween engine for numbers and THREE.Vector3 values. A new tween on a property
// replaces any running tween on the same property of the same object.

const EASINGS = {
  linear: (t) => t,
  out: (t) => 1 - Math.pow(1 - t, 3),
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
};

export const reducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export class Tweens {
  constructor() {
    this.items = [];
  }

  to(target, props, { duration = 900, delay = 0, ease = "inOut", onDone } = {}) {
    const keys = Object.keys(props);
    for (const item of this.items) {
      if (item.target !== target) continue;
      for (const key of keys) delete item.props[key];
    }
    this.items = this.items.filter((item) => Object.keys(item.props).length > 0);
    const item = {
      target,
      props: Object.fromEntries(keys.map((key) => [key, { to: props[key], from: null }])),
      start: performance.now() + (reducedMotion() ? 0 : delay),
      duration: reducedMotion() ? 0 : duration,
      ease: EASINGS[ease] || EASINGS.inOut,
      onDone,
      begun: false,
    };
    this.items.push(item);
    return item;
  }

  // Rewrites the end value of a running tween, e.g. when the viewport changes mid-flight.
  retarget(target, key, map) {
    for (const item of this.items) {
      if (item.target === target && item.props[key]) item.props[key].to = map(item.props[key].to);
    }
  }

  cancel(target, keys) {
    for (const item of this.items) {
      if (item.target !== target) continue;
      for (const key of keys ?? Object.keys(item.props)) delete item.props[key];
    }
    this.items = this.items.filter((item) => Object.keys(item.props).length > 0);
  }

  get active() {
    return this.items.length > 0;
  }

  update(now) {
    if (!this.items.length) return false;
    for (const item of [...this.items]) {
      if (now < item.start) continue;
      if (!item.begun) {
        for (const [key, prop] of Object.entries(item.props)) {
          const value = item.target[key];
          prop.from = typeof value === "number" ? value : value.clone();
        }
        item.begun = true;
      }
      const t = item.duration > 0 ? Math.min(1, (now - item.start) / item.duration) : 1;
      const k = item.ease(t);
      for (const [key, prop] of Object.entries(item.props)) {
        if (typeof prop.to === "number") item.target[key] = prop.from + (prop.to - prop.from) * k;
        else item.target[key].lerpVectors(prop.from, prop.to, k);
      }
      if (t >= 1) {
        this.items.splice(this.items.indexOf(item), 1);
        item.onDone?.();
      }
    }
    return true;
  }
}
