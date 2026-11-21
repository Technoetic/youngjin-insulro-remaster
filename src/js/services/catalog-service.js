export class CatalogService {
  #url;
  #sequence = 0;
  #controller = null;

  constructor(catalogURL) {
    this.#url = catalogURL;
  }

  async load() {
    const requestId = ++this.#sequence;
    this.#controller?.abort();
    const controller = new AbortController();
    this.#controller = controller;
    const response = await fetch(this.#url, {
      cache: 'no-store',
      signal: controller.signal,
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) {
      throw new Error(`카탈로그 데이터를 불러오지 못했습니다 (HTTP ${response.status}).`);
    }
    const data = await response.json();
    if (requestId !== this.#sequence) return null;
    if (!data || !Array.isArray(data.categories) || !Array.isArray(data.cutawayLayers) || !Array.isArray(data.trackRecords)) {
      throw new Error('카탈로그 데이터 형식이 올바르지 않습니다.');
    }
    const seenCat = new Set();
    for (const cat of data.categories) {
      if (!cat?.id || seenCat.has(cat.id) || !Array.isArray(cat.items)) {
        throw new Error('중복되었거나 손상된 제품 카테고리 데이터입니다.');
      }
      seenCat.add(cat.id);
    }
    return data;
  }

  dispose() {
    ++this.#sequence;
    this.#controller?.abort();
  }
}
