const SCENE_DURATION_MS = 6800;

export class HeroVisualEngine {
  #stage;
  #canvas;
  #ctx = null;
  #rafId = 0;
  #timerId = 0;
  #width = 0;
  #height = 0;
  #dpr = 1;
  #particles = [];
  #sceneIndex = 0;
  #sceneCount = 3;
  #reducedMotion = false;
  #events = new AbortController();
  #resizeObserver = null;
  #disposed = false;

  constructor({ stage, canvas }) {
    this.#stage = stage;
    this.#canvas = canvas;
    this.#reducedMotion =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  start() {
    if (!this.#stage) return;
    const slides = this.#stage.querySelectorAll('[data-cinema-slide]');
    this.#sceneCount = Math.max(1, slides.length);
    this.#applyScene(0);

    // Subtle film-reel indicator switching (optional, pure passive auto-cinema by default)
    const signal = this.#events.signal;
    this.#stage.querySelectorAll('[data-reel-dot]').forEach(dot => {
      dot.addEventListener(
        'click',
        () => {
          const idx = Number(dot.dataset.reelDot);
          if (Number.isInteger(idx) && idx >= 0 && idx < this.#sceneCount) {
            this.#applyScene(idx);
            this.#restartTimer();
          }
        },
        { signal }
      );
    });

    if (!this.#reducedMotion && this.#sceneCount > 1) {
      this.#restartTimer();
    }

    if (!this.#canvas) return;
    this.#ctx = this.#canvas.getContext('2d');
    if (!this.#ctx) return;

    this.#resize();
    if (typeof ResizeObserver === 'function') {
      this.#resizeObserver = new ResizeObserver(() => this.#resize());
      this.#resizeObserver.observe(this.#stage);
    } else {
      window.addEventListener('resize', () => this.#resize(), { passive: true, signal });
    }

    this.#seedParticles();
    if (this.#reducedMotion) {
      this.#drawFrame(0);
      return;
    }

    const tick = now => {
      if (this.#disposed) return;
      this.#drawFrame(now);
      this.#rafId = requestAnimationFrame(tick);
    };
    this.#rafId = requestAnimationFrame(tick);
  }

  #restartTimer() {
    if (this.#timerId) clearInterval(this.#timerId);
    if (this.#disposed || this.#reducedMotion || this.#sceneCount <= 1) return;
    this.#timerId = setInterval(() => {
      if (document.hidden || this.#disposed) return;
      this.#applyScene((this.#sceneIndex + 1) % this.#sceneCount);
    }, SCENE_DURATION_MS);
  }

  #applyScene(index) {
    if (this.#disposed || !this.#stage) return;
    this.#sceneIndex = index;
    this.#stage.dataset.scene = String(index);

    this.#stage.querySelectorAll('[data-cinema-slide]').forEach((el, i) => {
      const active = i === index;
      el.classList.toggle('is-active', active);
      el.setAttribute('aria-hidden', String(!active));
    });

    this.#stage.querySelectorAll('[data-cinema-copy]').forEach((el, i) => {
      const active = i === index;
      el.classList.toggle('is-active', active);
      el.hidden = !active;
    });

    this.#stage.querySelectorAll('[data-reel-dot]').forEach((el, i) => {
      const active = i === index;
      el.classList.toggle('is-active', active);
      el.setAttribute('aria-current', active ? 'true' : 'false');
    });
  }

  #resize() {
    if (!this.#canvas || !this.#stage) return;
    const rect = this.#stage.getBoundingClientRect();
    this.#dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.#width = Math.max(1, Math.round(rect.width));
    this.#height = Math.max(1, Math.round(rect.height));
    this.#canvas.width = Math.round(this.#width * this.#dpr);
    this.#canvas.height = Math.round(this.#height * this.#dpr);
  }

  #seedParticles() {
    this.#particles = [];
    for (let i = 0; i < 72; i++) {
      const isEmber = i % 2 === 0;
      this.#particles.push({
        kind: isEmber ? 'ember' : 'frost',
        x: isEmber
          ? this.#width * (0.58 + Math.random() * 0.44)
          : this.#width * (0.02 + Math.random() * 0.52),
        y: Math.random() * this.#height,
        vx: isEmber ? -(0.35 + Math.random() * 1.1) : 0.25 + Math.random() * 0.8,
        vy: isEmber ? -(0.6 + Math.random() * 1.4) : 0.15 + Math.random() * 0.55,
        r: isEmber ? 1.1 + Math.random() * 2.4 : 1.2 + Math.random() * 2.6,
        alpha: 0.35 + Math.random() * 0.55,
        phase: Math.random() * Math.PI * 2
      });
    }
  }

  #drawFrame(now) {
    const ctx = this.#ctx;
    if (!ctx) return;
    ctx.save();
    ctx.scale(this.#dpr, this.#dpr);
    ctx.clearRect(0, 0, this.#width, this.#height);

    for (let i = 0; i < this.#particles.length; i++) {
      const p = this.#particles[i];
      if (!this.#reducedMotion) {
        p.x += p.vx;
        p.y += p.vy + Math.sin(now * 0.002 + p.phase) * 0.22;

        if (p.kind === 'ember') {
          if (p.y < -20 || p.x < this.#width * 0.45) {
            p.x = this.#width * (0.68 + Math.random() * 0.34);
            p.y = this.#height * (0.35 + Math.random() * 0.7);
          }
        } else {
          if (p.y > this.#height + 20 || p.x > this.#width * 0.62) {
            p.x = this.#width * (0.02 + Math.random() * 0.42);
            p.y = -10 + Math.random() * (this.#height * 0.55);
          }
        }
      }

      const twinkle = this.#reducedMotion ? 0.85 : 0.55 + 0.45 * Math.sin(now * 0.005 + p.phase);
      if (p.kind === 'ember') {
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 3.4);
        grad.addColorStop(0, `rgba(255, 214, 130, ${p.alpha * twinkle})`);
        grad.addColorStop(0.45, `rgba(255, 102, 28, ${p.alpha * 0.65 * twinkle})`);
        grad.addColorStop(1, 'rgba(255, 60, 0, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 3.4, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 3.2);
        grad.addColorStop(0, `rgba(224, 253, 255, ${p.alpha * twinkle})`);
        grad.addColorStop(0.5, `rgba(56, 232, 255, ${p.alpha * 0.55 * twinkle})`);
        grad.addColorStop(1, 'rgba(0, 174, 255, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  dispose() {
    this.#disposed = true;
    if (this.#rafId) cancelAnimationFrame(this.#rafId);
    if (this.#timerId) clearInterval(this.#timerId);
    this.#events.abort();
    this.#resizeObserver?.disconnect();
  }
}
