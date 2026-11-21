export class HeroVisualEngine {
  #stage;
  #canvas;
  #ctx = null;
  #rafId = 0;
  #width = 0;
  #height = 0;
  #dpr = 1;
  #particles = [];
  #openRatio = 0;
  #flir = false;
  #airCurtain = true;
  #thicknessMm = 150;
  #reducedMotion = false;
  #events = new AbortController();
  #resizeObserver = null;
  #scanY = 0;
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
    if (!this.#canvas || !this.#stage) return;
    this.#ctx = this.#canvas.getContext('2d');
    if (!this.#ctx) return;

    const signal = this.#events.signal;
    this.#stage.addEventListener(
      'pointermove',
      event => {
        const rect = this.#stage.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const x = (((event.clientX - rect.left) / rect.width) * 100).toFixed(2);
        const y = (((event.clientY - rect.top) / rect.height) * 100).toFixed(2);
        this.#stage.style.setProperty('--mx', `${x}%`);
        this.#stage.style.setProperty('--my', `${y}%`);
      },
      { passive: true, signal }
    );

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

  setState({ openRatio, flir, airCurtain, thicknessMm }) {
    const prevOpen = this.#openRatio;
    if (typeof openRatio === 'number') this.#openRatio = openRatio;
    if (typeof flir === 'boolean') this.#flir = flir;
    if (typeof airCurtain === 'boolean') this.#airCurtain = airCurtain;
    if (typeof thicknessMm === 'number') this.#thicknessMm = thicknessMm;

    if (this.#openRatio - prevOpen > 0.12 && !this.#reducedMotion) {
      this.triggerCryoBurst(52);
    }
    if (this.#reducedMotion && this.#ctx) {
      this.#drawFrame(0);
    }
  }

  triggerCryoBurst(count = 48) {
    if (!this.#width || !this.#height) return;
    const originX = this.#width * 0.62;
    const originY = this.#height * 0.66;
    for (let i = 0; i < count; i++) {
      const angle = Math.PI * (0.65 + Math.random() * 0.9);
      const speed = 1.4 + Math.random() * 4.2;
      this.#particles.push({
        kind: Math.random() > 0.35 ? 'mist' : 'crystal',
        x: originX + (Math.random() - 0.5) * 90,
        y: originY + (Math.random() - 0.5) * 140,
        vx: Math.cos(angle) * speed - 0.6,
        vy: Math.sin(angle) * speed * 0.45 - 0.2,
        r: Math.random() > 0.35 ? 16 + Math.random() * 34 : 1.5 + Math.random() * 2.8,
        alpha: 0.48 + Math.random() * 0.4,
        life: 0,
        maxLife: 70 + Math.random() * 85,
        burst: true
      });
    }
    if (this.#particles.length > 220) {
      this.#particles.splice(0, this.#particles.length - 220);
    }
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
    for (let i = 0; i < 64; i++) {
      const isHeat = i >= 48;
      this.#particles.push({
        kind: isHeat ? 'heat' : i % 3 === 0 ? 'mist' : 'crystal',
        x: isHeat
          ? this.#width * (0.76 + Math.random() * 0.24)
          : this.#width * (0.08 + Math.random() * 0.68),
        y: isHeat
          ? this.#height * (0.15 + Math.random() * 0.8)
          : this.#height * (0.45 + Math.random() * 0.52),
        vx: isHeat ? -(0.12 + Math.random() * 0.25) : -(0.22 + Math.random() * 0.65),
        vy: isHeat ? -(0.3 + Math.random() * 0.6) : (Math.random() - 0.5) * 0.25,
        r: isHeat ? 1.4 + Math.random() * 2.2 : i % 3 === 0 ? 22 + Math.random() * 44 : 1.1 + Math.random() * 2.3,
        alpha: isHeat ? 0.32 + Math.random() * 0.45 : i % 3 === 0 ? 0.08 + Math.random() * 0.12 : 0.35 + Math.random() * 0.55,
        life: Math.random() * 200,
        maxLife: 240,
        burst: false
      });
    }
  }

  #drawFrame(now) {
    const ctx = this.#ctx;
    if (!ctx) return;
    ctx.save();
    ctx.scale(this.#dpr, this.#dpr);
    ctx.clearRect(0, 0, this.#width, this.#height);

    const cryoIntensity = 0.65 + ((this.#thicknessMm - 75) / 75) * 0.5 + this.#openRatio * 0.45;

    // Subtle vertical FLIR thermal scanline
    this.#scanY = (this.#scanY + (this.#flir ? 2.4 : 0.9)) % Math.max(1, this.#height);
    const scanGrad = ctx.createLinearGradient(0, this.#scanY - 24, 0, this.#scanY + 24);
    if (this.#flir) {
      scanGrad.addColorStop(0, 'rgba(255, 107, 44, 0)');
      scanGrad.addColorStop(0.5, 'rgba(255, 130, 50, 0.22)');
      scanGrad.addColorStop(1, 'rgba(56, 232, 255, 0)');
    } else {
      scanGrad.addColorStop(0, 'rgba(56, 232, 255, 0)');
      scanGrad.addColorStop(0.5, 'rgba(56, 232, 255, 0.08)');
      scanGrad.addColorStop(1, 'rgba(56, 232, 255, 0)');
    }
    ctx.fillStyle = scanGrad;
    ctx.fillRect(0, this.#scanY - 24, this.#width, 48);

    // Draw particles
    for (let i = this.#particles.length - 1; i >= 0; i--) {
      const p = this.#particles[i];
      if (!this.#reducedMotion) {
        const speedBoost = p.kind !== 'heat' ? 1 + this.#openRatio * 1.4 : 1;
        p.x += p.vx * speedBoost;
        p.y += p.vy;
        p.life += 1;

        if (p.burst) {
          p.vx *= 0.985;
          p.vy *= 0.985;
          if (p.life >= p.maxLife) {
            this.#particles.splice(i, 1);
            continue;
          }
        } else {
          if (p.x < -80) p.x = this.#width * 0.72 + Math.random() * 80;
          if (p.x > this.#width + 60) p.x = this.#width * 0.78;
          if (p.y < -40) p.y = this.#height + 20;
          if (p.y > this.#height + 60) p.y = this.#height * 0.55;
        }
      }

      const fade = p.burst ? Math.max(0, 1 - p.life / p.maxLife) : 1;
      const alpha = Math.min(0.9, p.alpha * fade * (p.kind === 'heat' ? 1 : cryoIntensity));

      if (p.kind === 'mist') {
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
        if (this.#flir) {
          grad.addColorStop(0, `rgba(116, 84, 255, ${alpha})`);
          grad.addColorStop(1, 'rgba(56, 232, 255, 0)');
        } else {
          grad.addColorStop(0, `rgba(110, 238, 255, ${alpha})`);
          grad.addColorStop(1, 'rgba(56, 232, 255, 0)');
        }
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.kind === 'crystal') {
        const twinkle = this.#reducedMotion ? 1 : 0.65 + 0.35 * Math.sin(now * 0.004 + i);
        ctx.fillStyle = this.#flir
          ? `rgba(166, 240, 255, ${alpha * twinkle})`
          : `rgba(196, 250, 255, ${alpha * twinkle})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = `rgba(255, 134, 64, ${alpha})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  dispose() {
    this.#disposed = true;
    if (this.#rafId) cancelAnimationFrame(this.#rafId);
    this.#events.abort();
    this.#resizeObserver?.disconnect();
  }
}
