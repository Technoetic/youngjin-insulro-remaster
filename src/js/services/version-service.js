const VALID_BUILD_RE = /^[a-f0-9]{12,64}$/;

export function defaultVersionURL() {
  return new URL('../../../version.json', import.meta.url).href;
}

async function defaultFetchVersion(signal, versionURL) {
  const response = await fetch(versionURL, {
    cache: 'no-store',
    signal,
    headers: { Accept: 'application/json' }
  });
  if (!response.ok) throw new Error(`Version HTTP ${response.status}`);
  return response.json();
}

export class VersionService {
  #loaded;
  #latest;
  #fetch;
  #versionURL;
  #onPending;
  #sequence = 0;
  #navigation = 0;
  #controller = null;
  #inFlightNavCheck = null;
  #disposed = false;

  constructor({
    loadedBuild,
    versionURL = defaultVersionURL(),
    fetchVersion = defaultFetchVersion,
    onPending = () => {}
  }) {
    if (typeof loadedBuild !== 'string' || !VALID_BUILD_RE.test(loadedBuild)) {
      throw new Error('Invalid loaded build identity');
    }
    this.#loaded = loadedBuild;
    this.#latest = loadedBuild;
    this.#versionURL = versionURL;
    this.#fetch = fetchVersion;
    this.#onPending = onPending;
  }

  get loadedBuild() {
    return this.#loaded;
  }

  get latestBuild() {
    return this.#latest;
  }

  get changed() {
    return this.#latest !== this.#loaded;
  }

  async check({ priority = 'background' } = {}) {
    if (this.#disposed) return { ok: false, changed: this.changed, build: this.#latest };
    // Never let a background focus/visibility check abort an active navigation check
    if (priority === 'background' && this.#inFlightNavCheck) {
      return this.#inFlightNavCheck;
    }

    const requestId = ++this.#sequence;
    this.#controller?.abort();
    const controller = new AbortController();
    this.#controller = controller;
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    const task = (async () => {
      try {
        const data = await this.#fetch(controller.signal, this.#versionURL);
        if (typeof data?.build !== 'string' || !VALID_BUILD_RE.test(data.build)) {
          throw new Error('Invalid version response');
        }
        if (this.#disposed || requestId !== this.#sequence) {
          return { ok: false, changed: this.changed, build: this.#latest };
        }
        this.#latest = data.build;
        this.#onPending(this.changed, this.#latest);
        return { ok: true, changed: this.changed, build: this.#latest };
      } catch {
        return { ok: false, changed: this.changed, build: this.#latest };
      } finally {
        clearTimeout(timeoutId);
        if (this.#inFlightNavCheck === task) this.#inFlightNavCheck = null;
      }
    })();

    if (priority === 'navigation') {
      this.#inFlightNavCheck = task;
    }
    return task;
  }

  async navigationDecision(targetURL, { currentURL, isBusy, replace = false }) {
    const navId = ++this.#navigation;
    const result = await this.check({ priority: 'navigation' });
    if (this.#disposed || navId !== this.#navigation) {
      return { kind: 'cancel', pending: this.changed };
    }
    // Recheck dirty / save-in-flight state immediately before committing a document transition
    if (!result.ok || !result.changed || isBusy()) {
      return { kind: 'local', pending: this.changed };
    }
    const target = new URL(targetURL, currentURL);
    const current = new URL(currentURL);
    if (target.origin !== current.origin) {
      return { kind: 'local', pending: this.changed };
    }
    target.searchParams.set('__build', result.build);
    if (target.pathname + target.search === current.pathname + current.search) {
      const prev = Number(current.searchParams.get('__refresh'));
      target.searchParams.set('__refresh', String(Number.isSafeInteger(prev) ? prev + 1 : 1));
    }
    return { kind: 'document', url: target.href, replace, pending: true };
  }

  dispose() {
    this.#disposed = true;
    ++this.#sequence;
    ++this.#navigation;
    this.#inFlightNavCheck = null;
    this.#controller?.abort();
    this.#onPending = () => {};
  }
}
