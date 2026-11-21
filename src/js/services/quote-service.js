import { clamp, formatQuoteBrief } from '../shared/format.js';

export const DEFAULT_QUOTE_DRAFT = Object.freeze({
  doorType: '전동 슬라이딩 방열문 (양개/편개)',
  thicknessMm: 150,
  targetTemp: '-40℃ 초저온 (150mm)',
  widthMm: 2800,
  heightMm: 3200,
  siteType: '기존 저온창고 방열도어 교체·보수(MRO)',
  options: ['에어커튼 연동', '지게차 원격 리모콘'],
  contactName: '',
  companyName: '',
  phone: '',
  notes: ''
});

export class QuoteService {
  #draft;
  #dirty = false;
  #saving = false;
  #editRev = 0;
  #saveSeq = 0;
  #disposed = false;
  #lastSavedBrief = '';
  #lastError = '';
  #onChange;

  constructor({ onChange = () => {} } = {}) {
    this.#draft = { ...DEFAULT_QUOTE_DRAFT, options: [...DEFAULT_QUOTE_DRAFT.options] };
    this.#onChange = onChange;
  }

  get state() {
    return {
      draft: { ...this.#draft, options: [...this.#draft.options] },
      dirty: this.#dirty,
      saving: this.#saving,
      lastSavedBrief: this.#lastSavedBrief,
      lastError: this.#lastError,
      previewBrief: formatQuoteBrief(this.#draft)
    };
  }

  get isBusy() {
    return this.#dirty || this.#saving;
  }

  update(patch) {
    if (this.#disposed) return;
    const next = { ...patch };
    if ('widthMm' in next) next.widthMm = clamp(next.widthMm, 800, 4500);
    if ('heightMm' in next) next.heightMm = clamp(next.heightMm, 1800, 4000);
    if ('thicknessMm' in next) {
      const t = Number(next.thicknessMm);
      const tempLabels = {
        75: '-10℃ 냉장·예냉 (75mm)',
        100: '-25℃ 표준 냉동 (100mm)',
        125: '-30℃ 강냉동 물류 (125mm)',
        150: '-40℃ 초저온 (150mm)'
      };
      next.thicknessMm = t in tempLabels ? t : 150;
      next.targetTemp = tempLabels[next.thicknessMm];
    }
    this.#draft = {
      ...this.#draft,
      ...next,
      options: Array.isArray(next.options) ? [...next.options] : this.#draft.options
    };
    ++this.#editRev;
    this.#dirty = true;
    this.#lastError = '';
    this.#emit();
  }

  toggleOption(optionLabel) {
    if (this.#disposed) return;
    const set = new Set(this.#draft.options);
    if (set.has(optionLabel)) set.delete(optionLabel);
    else set.add(optionLabel);
    this.update({ options: [...set] });
  }

  discard() {
    if (this.#disposed) return;
    ++this.#saveSeq;
    ++this.#editRev;
    this.#draft = { ...DEFAULT_QUOTE_DRAFT, options: [...DEFAULT_QUOTE_DRAFT.options] };
    this.#dirty = false;
    this.#saving = false;
    this.#lastError = '';
    this.#emit();
  }

  async saveDraft(persistFn) {
    if (this.#disposed) return { ok: false, stale: true };
    const seq = ++this.#saveSeq;
    const savedRev = this.#editRev;
    const brief = formatQuoteBrief(this.#draft);
    this.#saving = true;
    this.#lastError = '';
    this.#emit();
    try {
      await persistFn(brief, { ...this.#draft });
      if (this.#disposed || seq !== this.#saveSeq) return { ok: false, stale: true };
      this.#saving = false;
      // Only clear dirty flag if no newer edits occurred while save was in flight
      this.#dirty = this.#editRev !== savedRev;
      this.#lastSavedBrief = brief;
      this.#emit();
      return { ok: true, brief, editedDuringSave: this.#dirty };
    } catch (error) {
      if (this.#disposed || seq !== this.#saveSeq) return { ok: false, stale: true };
      // Never mark a failed save as clean/complete
      this.#saving = false;
      this.#dirty = true;
      this.#lastError = error?.message || '견적서 복사·저장에 실패했습니다. 다시 시도해 주세요.';
      this.#emit();
      return { ok: false, error: this.#lastError };
    }
  }

  dispose() {
    this.#disposed = true;
    ++this.#saveSeq;
    this.#saving = false;
    this.#onChange = () => {};
  }

  #emit() {
    if (!this.#disposed) this.#onChange(this.state);
  }
}
