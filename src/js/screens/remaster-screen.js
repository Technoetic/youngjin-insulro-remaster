import { CatalogService } from '../services/catalog-service.js';
import { VersionService } from '../services/version-service.js';
import { QuoteService } from '../services/quote-service.js';
import { HeroVisualEngine } from './hero-visual-engine.js';
import {
  clamp,
  computeThermalSpec,
  escapeHtml,
  formatNumber,
  parseRoute
} from '../shared/format.js';

const HOTSPOT_COORDS = [
  { left: '26%', top: '48%' },
  { left: '54%', top: '38%' },
  { left: '72%', top: '55%' },
  { left: '34%', top: '84%' },
  { left: '78%', top: '16%' },
  { left: '49%', top: '88%' }
];

export class RemasterScreen {
  #catalogService;
  #versionService;
  #quoteService;
  #heroEngine = null;
  #events = new AbortController();
  #catalog = null;
  #disposed = false;
  #loadGen = 0;
  #checkedHashURL = null;
  #initialDeepLink = false;

  // Interactive Hero State
  #thicknessMm = 150;
  #openRatio = 0;
  #airCurtain = true;
  #flirMode = false;

  // View State
  #activeCategory = 'doors';
  #activeLayerId = 'sus-skin';
  #activeRecordFilter = '전체';

  constructor({ build, catalogURL, versionURL }) {
    this.#catalogService = new CatalogService(catalogURL);
    this.#versionService = new VersionService({
      loadedBuild: build,
      versionURL,
      onPending: changed => this.#renderUpdateNotice(changed)
    });
    this.#quoteService = new QuoteService({
      onChange: state => this.#renderQuoteState(state)
    });
  }

  async mount() {
    const signal = this.#events.signal;
    this.#initialDeepLink = Boolean(location.hash && parseRoute(location.hash).section !== 'hero');

    // 1. Start Real-time Cryo-Thermal Hero Engine
    this.#heroEngine = new HeroVisualEngine({
      stage: document.querySelector('#hero'),
      canvas: document.querySelector('#hero-canvas')
    });
    this.#heroEngine.start();

    // 2. Header scroll state & mobile nav toggle
    const header = document.querySelector('#site-header');
    const syncHeader = () => header?.classList.toggle('is-scrolled', window.scrollY > 24);
    syncHeader();
    window.addEventListener('scroll', syncHeader, { passive: true, signal });

    const menuToggle = document.querySelector('#menu-toggle');
    const siteNav = document.querySelector('#site-nav');
    menuToggle?.addEventListener(
      'click',
      () => {
        const expanded = menuToggle.getAttribute('aria-expanded') === 'true';
        menuToggle.setAttribute('aria-expanded', String(!expanded));
        siteNav?.classList.toggle('is-open', !expanded);
      },
      { signal }
    );

    // 3. Hero Interactive Actuator Controls
    document.querySelectorAll('[data-thickness]').forEach(btn => {
      btn.addEventListener(
        'click',
        () => {
          this.#setThickness(Number(btn.dataset.thickness), true);
        },
        { signal }
      );
    });

    const toggleDoor = () => {
      const next = this.#openRatio > 0.35 ? 0 : 1;
      this.#setDoorOpen(next, true);
    };

    document.querySelector('#hero-actuate-btn')?.addEventListener('click', toggleDoor, { signal });
    document.querySelector('#cockpit-actuate-btn')?.addEventListener('click', toggleDoor, { signal });

    document.querySelector('#door-slider')?.addEventListener(
      'input',
      event => {
        const pct = clamp(Number(event.target.value), 0, 100);
        this.#setDoorOpen(pct / 100, false);
      },
      { signal }
    );

    document.querySelector('#curtain-toggle')?.addEventListener(
      'click',
      () => {
        this.#airCurtain = !this.#airCurtain;
        this.#renderHeroTelemetry();
      },
      { signal }
    );

    document.querySelector('#flir-toggle')?.addEventListener(
      'click',
      () => {
        this.#flirMode = !this.#flirMode;
        this.#renderHeroTelemetry();
      },
      { signal }
    );

    // 4. Delegated listeners for dynamic catalog/cutaway/record controls (cleaned up via AbortSignal)
    document.querySelector('#engineering')?.addEventListener(
      'click',
      event => {
        const btn = event.target.closest('[data-layer-id]');
        if (!btn) return;
        this.#activeLayerId = btn.dataset.layerId;
        this.#renderCutaway();
      },
      { signal }
    );

    document.querySelector('#product-panel')?.addEventListener(
      'click',
      event => {
        const btn = event.target.closest('[data-select-product]');
        if (!btn) return;
        const productName = btn.dataset.selectProduct;
        const select = document.querySelector('#q-door-type');
        if (select) {
          let found = false;
          for (const opt of select.options) {
            if (opt.value === productName) {
              select.value = productName;
              found = true;
              break;
            }
          }
          if (!found) {
            const opt = document.createElement('option');
            opt.value = productName;
            opt.textContent = productName;
            select.appendChild(opt);
            select.value = productName;
          }
        }
        this.#quoteService.update({ doorType: productName });
        void this.#navigate(new URL('#quote', location.href).href);
      },
      { signal }
    );

    document.querySelector('#record-filters')?.addEventListener(
      'click',
      event => {
        const btn = event.target.closest('[data-rec-filter]');
        if (!btn) return;
        this.#activeRecordFilter = btn.dataset.recFilter;
        this.#renderTrackRecords();
      },
      { signal }
    );

    // 5. Retry Catalog Load
    document.querySelector('#retry-catalog')?.addEventListener(
      'click',
      () => {
        void this.#loadCatalog();
      },
      { signal }
    );

    // 6. Remaster Before/After Audit Modal
    const auditDialog = document.querySelector('#audit-dialog');
    document.querySelectorAll('[data-open-audit]').forEach(btn => {
      btn.addEventListener(
        'click',
        () => {
          auditDialog?.showModal();
        },
        { signal }
      );
    });
    document.querySelector('[data-close-audit]')?.addEventListener(
      'click',
      () => auditDialog?.close(),
      { signal }
    );
    auditDialog?.addEventListener(
      'click',
      event => {
        if (event.target === auditDialog) {
          const rect = auditDialog.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          ) {
            auditDialog.close();
          }
        }
      },
      { signal }
    );

    // 7. Quote Configurator Events (Dirty State & Async Save)
    this.#bindQuoteForm(signal);

    // 8. Navigation & Rule 6 Deployment Update Lifecycle
    document.addEventListener(
      'click',
      event => {
        const link = event.target.closest('a[data-nav]');
        if (!link || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
          return;
        }
        event.preventDefault();
        menuToggle?.setAttribute('aria-expanded', 'false');
        siteNav?.classList.remove('is-open');
        void this.#navigate(link.href);
      },
      { signal }
    );

    document.addEventListener(
      'keydown',
      event => {
        if (event.key === 'Escape') {
          menuToggle?.setAttribute('aria-expanded', 'false');
          siteNav?.classList.remove('is-open');
        }
      },
      { signal }
    );

    window.addEventListener('focus', () => void this.#versionService.check({ priority: 'background' }), { signal });
    window.addEventListener('pageshow', () => void this.#versionService.check({ priority: 'background' }), { signal });
    document.addEventListener(
      'visibilitychange',
      () => {
        if (!document.hidden) void this.#versionService.check({ priority: 'background' });
      },
      { signal }
    );

    window.addEventListener(
      'hashchange',
      event => {
        const currentURL = location.href;
        if (event.newURL && event.newURL !== currentURL) return;
        this.#applyRouteFromHash(true);
        const alreadyChecked = this.#checkedHashURL === currentURL;
        this.#checkedHashURL = null;
        if (!alreadyChecked) {
          void this.#navigate(currentURL, true);
        }
      },
      { signal }
    );

    window.addEventListener(
      'beforeunload',
      event => {
        if (this.#quoteService.isBusy) {
          event.preventDefault();
          event.returnValue = '';
        }
      },
      { signal }
    );

    window.addEventListener(
      'pagehide',
      event => {
        if (!event.persisted) this.dispose();
      },
      { signal }
    );

    // 9. Initial Render & Async Data Load
    this.#renderHeroTelemetry();
    this.#renderQuoteState(this.#quoteService.state);
    this.#applyRouteFromHash(false);
    void this.#versionService.check({ priority: 'background' });
    await this.#loadCatalog();
  }

  #setThickness(mm, syncQuote = false) {
    this.#thicknessMm = mm;
    this.#renderHeroTelemetry();
    if (syncQuote) {
      const sel = document.querySelector('#q-thickness');
      if (sel) sel.value = String(mm);
      this.#quoteService.update({ thicknessMm: mm });
    }
  }

  #setDoorOpen(ratio, animateFlash = false) {
    const prev = this.#openRatio;
    this.#openRatio = clamp(ratio, 0, 1);
    this.#renderHeroTelemetry();

    if (animateFlash && prev > 0.25 && this.#openRatio <= 0.05) {
      const flash = document.querySelector('#sim-seal-flash');
      if (flash) {
        flash.classList.remove('is-flashing');
        void flash.offsetWidth;
        flash.classList.add('is-flashing');
      }
    }
  }

  #renderHeroTelemetry() {
    if (this.#disposed) return;
    const stage = document.querySelector('#hero');
    const simStage = document.querySelector('#door-sim-stage');
    const spec = computeThermalSpec({
      thicknessMm: this.#thicknessMm,
      ambientC: 35,
      openRatio: this.#openRatio,
      airCurtain: this.#airCurtain
    });

    const isOpen = this.#openRatio > 0.05;
    stage?.classList.toggle('is-flir', this.#flirMode);
    stage?.classList.toggle('is-open', isOpen);
    simStage?.classList.toggle('is-sealed', !isOpen);
    simStage?.classList.toggle('is-flir-mini', this.#flirMode);
    simStage?.classList.toggle('is-curtain-active', isOpen && this.#airCurtain);
    simStage?.style.setProperty('--open-ratio', String(this.#openRatio));

    const foamPct = ((spec.thicknessMm - 45) / 105) * 100;
    simStage?.style.setProperty('--foam-pct', String(Math.round(foamPct)));

    document.querySelectorAll('[data-thickness]').forEach(btn => {
      const active = Number(btn.dataset.thickness) === spec.thicknessMm;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    });

    const flirBtn = document.querySelector('#flir-toggle');
    if (flirBtn) {
      flirBtn.classList.toggle('is-active', this.#flirMode);
      flirBtn.setAttribute('aria-pressed', String(this.#flirMode));
    }

    const curtainBtn = document.querySelector('#curtain-toggle');
    if (curtainBtn) {
      curtainBtn.setAttribute('aria-pressed', String(this.#airCurtain));
      curtainBtn.textContent = this.#airCurtain ? '에어커튼 ON' : '에어커튼 OFF';
    }

    const slider = document.querySelector('#door-slider');
    if (slider) slider.value = String(Math.round(this.#openRatio * 100));
    const sliderPct = document.querySelector('#slider-pct');
    if (sliderPct) sliderPct.textContent = `${Math.round(this.#openRatio * 100)}%`;

    const statusBadge = document.querySelector('#cockpit-status-badge');
    if (statusBadge) {
      statusBadge.classList.toggle('is-open', isOpen);
      statusBadge.textContent = isOpen
        ? this.#airCurtain
          ? 'OPEN · AIR CURTAIN ACTIVE'
          : 'OPEN · UNSHIELDED'
        : 'AIRTIGHT SEAL LOCKED';
    }

    const actuateLabel = isOpen ? '도어 완전 밀폐 (SEAL)' : 'BLDC 도어 개방 (OPEN)';
    const cockpitBtn = document.querySelector('#cockpit-actuate-btn');
    if (cockpitBtn) cockpitBtn.textContent = actuateLabel;

    const heroActuateBtn = document.querySelector('#hero-actuate-btn');
    if (heroActuateBtn) {
      heroActuateBtn.textContent = isOpen ? '⚡ EPDM 완전 밀폐 실행' : '⚡ BLDC 도어 개방 체험';
    }

    const setTxt = (id, text) => {
      const el = document.querySelector(id);
      if (el) el.textContent = text;
    };

    setTxt('#sim-core-temp', `${spec.coreTempC.toFixed(1)}°C`);
    setTxt('#sim-grade', `${spec.grade} · ${spec.thicknessMm}mm`);
    setTxt('#sim-foam-mm', `PU CORE ${spec.thicknessMm}mm`);
    setTxt('#tele-delta', `${spec.deltaT.toFixed(0)}°C ΔT`);
    setTxt('#tele-seal', `${spec.sealIntegrity.toFixed(1)}%`);
    setTxt('#tele-leak', `${spec.leakKw.toFixed(2)} kW`);
    setTxt('#tele-drive', isOpen ? 'BLDC 148W' : 'HOLD 0W');
    setTxt('#selector-active-label', `${spec.thicknessMm}mm · ${spec.targetC}°C (${spec.label})`);

    const sealEl = document.querySelector('#tele-seal');
    if (sealEl) {
      sealEl.classList.toggle('is-good', spec.sealIntegrity >= 95);
      sealEl.classList.toggle('is-heat', spec.sealIntegrity < 70);
    }

    this.#heroEngine?.setState({
      openRatio: this.#openRatio,
      flir: this.#flirMode,
      airCurtain: this.#airCurtain,
      thicknessMm: spec.thicknessMm
    });
  }

  async #loadCatalog() {
    const requestId = ++this.#loadGen;
    const statusBox = document.querySelector('#catalog-loading');
    const errorBox = document.querySelector('#catalog-error');
    const contentWrap = document.querySelector('#catalog-content');

    if (statusBox) statusBox.hidden = false;
    if (errorBox) errorBox.hidden = true;
    if (contentWrap) contentWrap.setAttribute('aria-busy', 'true');

    try {
      const data = await this.#catalogService.load();
      if (!data || this.#disposed || requestId !== this.#loadGen) return;
      this.#catalog = data;
      if (statusBox) statusBox.hidden = true;
      if (contentWrap) contentWrap.setAttribute('aria-busy', 'false');
      this.#renderAllCatalogSections();
      this.#applyRouteFromHash(this.#initialDeepLink);
      this.#initialDeepLink = false;
    } catch (error) {
      if (this.#disposed || requestId !== this.#loadGen) return;
      if (statusBox) statusBox.hidden = true;
      if (errorBox) {
        errorBox.hidden = false;
        const msg = errorBox.querySelector('[data-error-text]');
        if (msg) msg.textContent = error?.message || '데이터를 불러오지 못했습니다.';
      }
      if (contentWrap) contentWrap.setAttribute('aria-busy', 'false');
    }
  }

  #renderAllCatalogSections() {
    if (!this.#catalog || this.#disposed) return;
    this.#renderCutaway();
    this.#renderCategoryTabs();
    this.#renderProducts();
    this.#renderTrackRecords();
    this.#renderTimeline();
    this.#renderAuditModal();
  }

  #renderCutaway() {
    const layers = this.#catalog?.cutawayLayers || [];
    const hotspotsMount = document.querySelector('#cutaway-hotspots');
    const detailMount = document.querySelector('#cutaway-active-detail');
    const listMount = document.querySelector('#cutaway-layer-list');
    if (layers.length === 0) {
      if (hotspotsMount) hotspotsMount.innerHTML = '';
      if (detailMount) detailMount.innerHTML = '<p class="sub-note">단면 구조 데이터가 없습니다.</p>';
      if (listMount) listMount.innerHTML = '';
      return;
    }

    const active = layers.find(l => l.id === this.#activeLayerId) || layers[0];
    this.#activeLayerId = active.id;

    if (hotspotsMount) {
      hotspotsMount.innerHTML = layers
        .map((layer, idx) => {
          const coord = HOTSPOT_COORDS[idx] || { left: '50%', top: '50%' };
          const isActive = layer.id === active.id;
          return `<button type="button" class="cutaway-hotspot ${isActive ? 'is-active' : ''}" data-layer-id="${escapeHtml(layer.id)}" style="left:${coord.left};top:${coord.top}" aria-label="${escapeHtml(layer.title)}" aria-pressed="${isActive}">${idx + 1}</button>`;
        })
        .join('');
    }

    if (detailMount) {
      detailMount.innerHTML = `
        <div class="cutaway-detail-meta">
          <span class="cutaway-detail-code">${escapeHtml(active.code)} · STRUCTURE X-RAY</span>
          <span class="cutaway-detail-metric">${escapeHtml(active.metric)}</span>
        </div>
        <h3>${escapeHtml(active.title)}</h3>
        <p>${escapeHtml(active.summary)}</p>
        <p class="sub-note">${escapeHtml(active.detail)}</p>
      `;
    }

    if (listMount) {
      listMount.innerHTML = layers
        .map(layer => {
          const isActive = layer.id === active.id;
          return `
            <button type="button" class="layer-btn ${isActive ? 'is-active' : ''}" data-layer-id="${escapeHtml(layer.id)}" aria-pressed="${isActive}">
              <span class="layer-code">${escapeHtml(layer.code)}</span>
              <div>
                <strong>${escapeHtml(layer.title)}</strong>
                <span>${escapeHtml(layer.summary)}</span>
              </div>
              <span class="layer-metric-chip">${escapeHtml(layer.metric)}</span>
            </button>
          `;
        })
        .join('');
    }
  }

  #renderCategoryTabs() {
    const mount = document.querySelector('#category-tabs');
    if (!mount || !this.#catalog) return;
    mount.innerHTML = this.#catalog.categories
      .map(cat => {
        const isActive = cat.id === this.#activeCategory;
        return `
          <a href="#products/${escapeHtml(cat.id)}" data-nav class="cat-tab ${isActive ? 'is-active' : ''}" role="tab" aria-selected="${isActive}">
            <span class="cat-code">${escapeHtml(cat.code)}</span>
            <span>${escapeHtml(cat.name)}</span>
          </a>
        `;
      })
      .join('');
  }

  #renderProducts() {
    const mount = document.querySelector('#product-panel');
    if (!mount || !this.#catalog) return;
    if (this.#catalog.categories.length === 0) {
      mount.innerHTML = '<div class="state-panel">등록된 제품 카테고리가 없습니다.</div>';
      return;
    }
    const cat =
      this.#catalog.categories.find(c => c.id === this.#activeCategory) ||
      this.#catalog.categories[0];
    this.#activeCategory = cat.id;

    const complianceHtml = cat.complianceNote
      ? `<div class="compliance-callout" role="note">${escapeHtml(cat.complianceNote)}</div>`
      : '';

    const cardsHtml = cat.items
      .map(
        item => `
        <article class="product-card">
          <div>
            <div class="product-card-top">
              <span class="product-badge">${escapeHtml(item.badge)}</span>
              <span class="product-temp">${escapeHtml(item.temp)}</span>
            </div>
            <h4>${escapeHtml(item.name)}</h4>
            <p class="product-en">${escapeHtml(item.en)}</p>
            <ul class="product-specs">
              ${item.specs.map(s => `<li>${escapeHtml(s)}</li>`).join('')}
            </ul>
          </div>
          <div>
            <p class="product-use"><strong>적용 현장:</strong> ${escapeHtml(item.use)}</p>
            <button type="button" class="btn-card-quote" data-select-product="${escapeHtml(item.name)}">
              이 사양으로 견적 구성 →
            </button>
          </div>
        </article>
      `
      )
      .join('');

    mount.innerHTML = `
      <div class="category-banner">
        <img src="${escapeHtml(cat.heroImage)}" alt="${escapeHtml(cat.name)} 시네마 대표 이미지" loading="lazy">
        <div class="category-banner-content">
          <span class="section-eyebrow">${escapeHtml(cat.code)} · ${escapeHtml(cat.enName)}</span>
          <h3>${escapeHtml(cat.name)}</h3>
          <p>${escapeHtml(cat.tagline)}</p>
        </div>
      </div>
      ${complianceHtml}
      <div class="product-grid">${cardsHtml}</div>
    `;
  }

  #renderTrackRecords() {
    const filterMount = document.querySelector('#record-filters');
    const bodyMount = document.querySelector('#record-tbody');
    if (!bodyMount || !this.#catalog) return;

    const categories = ['전체', ...new Set(this.#catalog.trackRecords.map(r => r.category))];
    if (filterMount) {
      filterMount.innerHTML = categories
        .map(
          cat =>
            `<button type="button" class="filter-pill ${cat === this.#activeRecordFilter ? 'is-active' : ''}" data-rec-filter="${escapeHtml(cat)}" aria-pressed="${cat === this.#activeRecordFilter}">${escapeHtml(cat)}</button>`
        )
        .join('');
    }

    const filtered =
      this.#activeRecordFilter === '전체'
        ? this.#catalog.trackRecords
        : this.#catalog.trackRecords.filter(r => r.category === this.#activeRecordFilter);

    bodyMount.innerHTML = filtered
      .map(
        row => `
        <tr>
          <td class="mono">${escapeHtml(row.date)}</td>
          <td><strong>${escapeHtml(row.client)}</strong></td>
          <td>${escapeHtml(row.project)}</td>
          <td><span class="record-cat-badge">${escapeHtml(row.category)}</span></td>
          <td class="mono">${escapeHtml(row.amount)}</td>
          <td><span class="verify-tag">${escapeHtml(row.verification)}</span></td>
        </tr>
      `
      )
      .join('');
  }

  #renderTimeline() {
    const mount = document.querySelector('#timeline-list');
    if (!mount || !this.#catalog) return;
    mount.innerHTML = this.#catalog.timeline
      .map(
        item => `
        <article class="timeline-item">
          <div class="timeline-year">${escapeHtml(item.year)}</div>
          <h3>${escapeHtml(item.title)}</h3>
          <p>${escapeHtml(item.detail)}</p>
        </article>
      `
      )
      .join('');
  }

  #renderAuditModal() {
    const mount = document.querySelector('#audit-dialog-body');
    if (!mount || !this.#catalog) return;
    mount.innerHTML = this.#catalog.remasterAudit
      .map(
        row => `
        <article class="audit-row">
          <h3>${escapeHtml(row.area)}</h3>
          <div class="audit-compare">
            <div class="audit-before"><strong>BEFORE (기존 사이트)</strong><br>${escapeHtml(row.before)}</div>
            <div class="audit-after"><strong>AFTER (리마스터 개선)</strong><br>${escapeHtml(row.after)}</div>
          </div>
        </article>
      `
      )
      .join('');
  }

  #bindQuoteForm(signal) {
    document.querySelector('#quote-form')?.addEventListener(
      'submit',
      event => event.preventDefault(),
      { signal }
    );

    const bindInput = (selector, field, transform = v => v) => {
      const el = document.querySelector(selector);
      if (!el) return;
      const evt = el.tagName === 'SELECT' ? 'change' : 'input';
      el.addEventListener(
        evt,
        event => {
          this.#quoteService.update({ [field]: transform(event.target.value) });
        },
        { signal }
      );
    };

    bindInput('#q-door-type', 'doorType');
    bindInput('#q-thickness', 'thicknessMm', v => {
      const n = Number(v);
      this.#thicknessMm = n;
      this.#renderHeroTelemetry();
      return n;
    });
    bindInput('#q-width', 'widthMm', v => Number(v));
    bindInput('#q-height', 'heightMm', v => Number(v));
    bindInput('#q-site-type', 'siteType');
    bindInput('#q-contact', 'contactName');
    bindInput('#q-company', 'companyName');
    bindInput('#q-phone', 'phone');
    bindInput('#q-notes', 'notes');

    document.querySelectorAll('[data-quote-option]').forEach(btn => {
      btn.addEventListener(
        'click',
        () => {
          this.#quoteService.toggleOption(btn.dataset.quoteOption);
        },
        { signal }
      );
    });

    document.querySelector('#q-copy-btn')?.addEventListener(
      'click',
      async () => {
        const res = await this.#quoteService.saveDraft(async brief => {
          if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            await navigator.clipboard.writeText(brief);
          } else {
            const ta = document.createElement('textarea');
            ta.value = brief;
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            const ok = document.execCommand('copy');
            document.body.removeChild(ta);
            if (!ok) throw new Error('클립보드 복사가 차단되었습니다.');
          }
        });
        const statusEl = document.querySelector('#draft-status');
        if (res.ok && statusEl && !this.#disposed) {
          statusEl.classList.remove('is-error');
          statusEl.textContent = '✓ 견적 사양서가 클립보드에 복사되었습니다. 이메일 또는 문자로 바로 붙여넣기 하실 수 있습니다.';
        }
      },
      { signal }
    );

    document.querySelector('#q-mailto-btn')?.addEventListener(
      'click',
      async () => {
        const res = await this.#quoteService.saveDraft(async brief => {
          const subject = encodeURIComponent('[영진인슈로산업] 방열도어·콜드체인 견적 문의');
          const body = encodeURIComponent(brief);
          window.location.href = `mailto:yj7431@korea.com?subject=${subject}&body=${body}`;
        });
        const statusEl = document.querySelector('#draft-status');
        if (res.ok && statusEl && !this.#disposed) {
          statusEl.classList.remove('is-error');
          statusEl.textContent = '✓ 기본 메일 앱으로 견적서 작성을 열었습니다 (수신: yj7431@korea.com).';
        }
      },
      { signal }
    );

    document.querySelector('#q-discard-btn')?.addEventListener(
      'click',
      () => {
        this.#quoteService.discard();
        const s = this.#quoteService.state.draft;
        const setVal = (sel, v) => {
          const el = document.querySelector(sel);
          if (el) el.value = String(v);
        };
        setVal('#q-door-type', s.doorType);
        setVal('#q-thickness', s.thicknessMm);
        setVal('#q-width', s.widthMm);
        setVal('#q-height', s.heightMm);
        setVal('#q-site-type', s.siteType);
        setVal('#q-contact', s.contactName);
        setVal('#q-company', s.companyName);
        setVal('#q-phone', s.phone);
        setVal('#q-notes', s.notes);
        const statusEl = document.querySelector('#draft-status');
        if (statusEl) {
          statusEl.classList.remove('is-error');
          statusEl.textContent = '초안이 초기화되었습니다.';
        }
      },
      { signal }
    );
  }

  #renderQuoteState(state) {
    if (this.#disposed) return;
    const preview = document.querySelector('#quote-brief-box');
    if (preview) preview.textContent = state.previewBrief;

    const dimsLabel = document.querySelector('#quote-dims-summary');
    if (dimsLabel) {
      dimsLabel.textContent = `W ${formatNumber(state.draft.widthMm)} × H ${formatNumber(state.draft.heightMm)} mm · ${state.draft.thicknessMm}mm`;
    }

    document.querySelectorAll('[data-quote-option]').forEach(btn => {
      const selected = state.draft.options.includes(btn.dataset.quoteOption);
      btn.setAttribute('aria-pressed', String(selected));
    });

    const copyBtn = document.querySelector('#q-copy-btn');
    if (copyBtn) copyBtn.disabled = state.saving;
    const mailBtn = document.querySelector('#q-mailto-btn');
    if (mailBtn) mailBtn.disabled = state.saving;

    const statusEl = document.querySelector('#draft-status');
    if (statusEl && state.lastError) {
      statusEl.classList.add('is-error');
      statusEl.textContent = state.lastError;
    }

    this.#renderUpdateNotice(this.#versionService.changed);
  }

  #renderUpdateNotice(changed) {
    if (this.#disposed) return;
    const banner = document.querySelector('#update-banner');
    if (!banner) return;
    banner.hidden = !changed;
    banner.textContent = this.#quoteService.isBusy
      ? '새 버전이 배포되었습니다. 작성 중인 견적 초안을 저장하거나 초기화한 뒤 다음 화면으로 이동하면 자동 적용됩니다.'
      : '새 버전이 배포되었습니다. 다음 메뉴로 이동하면 최신 화면이 자동으로 로드됩니다.';
  }

  async #navigate(targetHref, restored = false) {
    const decision = await this.#versionService.navigationDecision(targetHref, {
      currentURL: location.href,
      isBusy: () => this.#quoteService.isBusy,
      replace: restored
    });
    if (this.#disposed || decision.kind === 'cancel') return;
    if (decision.kind === 'document') {
      if (decision.replace) location.replace(decision.url);
      else location.assign(decision.url);
      return;
    }

    if (!restored) {
      const targetHash = new URL(targetHref, location.href).hash || '#hero';
      if (location.hash !== targetHash) {
        const nextUrl = new URL(location.href);
        nextUrl.hash = targetHash;
        this.#checkedHashURL = nextUrl.href;
        location.hash = targetHash;
      } else {
        this.#applyRouteFromHash(true);
      }
    }
  }

  #applyRouteFromHash(shouldScroll = true) {
    if (this.#disposed) return;
    const { section, sub } = parseRoute(location.hash);

    if (section === 'products' && this.#catalog?.categories.length) {
      const targetCat = sub && this.#catalog.categories.some(c => c.id === sub)
        ? sub
        : this.#catalog.categories[0].id;
      if (targetCat !== this.#activeCategory) {
        this.#activeCategory = targetCat;
        this.#renderCategoryTabs();
        this.#renderProducts();
      }
    }

    const dialog = document.querySelector('#audit-dialog');
    if (section === 'audit') {
      if (dialog && !dialog.open) dialog.showModal();
    } else if (dialog && dialog.open) {
      dialog.close();
    }

    for (const link of document.querySelectorAll('#site-nav a[data-nav]')) {
      const linkSection = parseRoute(link.hash).section;
      if (linkSection === section) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    }

    if (shouldScroll && section !== 'audit') {
      const targetEl = document.getElementById(section);
      if (targetEl) {
        const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
        targetEl.scrollIntoView({ behavior: reduce ? 'instant' : 'smooth' });
      }
    }
  }

  dispose() {
    this.#disposed = true;
    this.#events.abort();
    this.#heroEngine?.dispose();
    this.#catalogService.dispose();
    this.#versionService.dispose();
    this.#quoteService.dispose();
  }
}
