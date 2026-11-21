import test from 'node:test';
import assert from 'node:assert/strict';
import { VersionService } from '../src/js/services/version-service.js';
import { CatalogService } from '../src/js/services/catalog-service.js';
import { QuoteService } from '../src/js/services/quote-service.js';
import { computeThermalSpec, escapeHtml, formatQuoteBrief, parseRoute } from '../src/js/shared/format.js';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

test('VersionService detects rollback (B -> A) and returns full-document navigation preserving subpath and hash', async () => {
  const service = new VersionService({
    loadedBuild: 'bbbbbbbbbbbbbbbb',
    versionURL: 'https://technoetic.github.io/youngjin-insulro-remaster/version.json',
    fetchVersion: async () => ({ build: 'aaaaaaaaaaaaaaaa' })
  });
  const decision = await service.navigationDecision(
    'https://technoetic.github.io/youngjin-insulro-remaster/#products/doors',
    {
      currentURL: 'https://technoetic.github.io/youngjin-insulro-remaster/#hero',
      isBusy: () => false
    }
  );
  assert.equal(decision.kind, 'document');
  const next = new URL(decision.url);
  assert.equal(next.pathname, '/youngjin-insulro-remaster/');
  assert.equal(next.hash, '#products/doors');
  assert.equal(next.searchParams.get('__build'), 'aaaaaaaaaaaaaaaa');
});

test('VersionService rechecks dirty/saving state immediately before committing document navigation', async () => {
  const pending = deferred();
  let busy = false;
  const service = new VersionService({
    loadedBuild: 'aaaaaaaaaaaaaaaa',
    versionURL: 'https://example.test/version.json',
    fetchVersion: () => pending.promise
  });
  const navPromise = service.navigationDecision('https://example.test/#quote', {
    currentURL: 'https://example.test/#hero',
    isBusy: () => busy
  });
  busy = true;
  pending.resolve({ build: 'cccccccccccccccc' });
  const decision = await navPromise;
  assert.equal(decision.kind, 'local');
  assert.equal(decision.pending, true);
});

test('VersionService ignores stale slow responses and survives network failures without reload loops', async () => {
  const slow = deferred();
  let call = 0;
  const service = new VersionService({
    loadedBuild: 'aaaaaaaaaaaaaaaa',
    versionURL: 'https://example.test/version.json',
    fetchVersion: () => (++call === 1 ? slow.promise : Promise.resolve({ build: 'aaaaaaaaaaaaaaaa' }))
  });
  const first = service.check();
  await service.check();
  slow.resolve({ build: 'dddddddddddddddd' });
  await first;
  assert.equal(service.changed, false);

  const failing = new VersionService({
    loadedBuild: 'aaaaaaaaaaaaaaaa',
    versionURL: 'https://example.test/version.json',
    fetchVersion: async () => {
      throw new Error('offline');
    }
  });
  const decision = await failing.navigationDecision('https://example.test/#products', {
    currentURL: 'https://example.test/#hero',
    isBusy: () => false
  });
  assert.equal(decision.kind, 'local');
});

test('CatalogService rejects malformed or duplicate category payloads and ignores stale responses', async context => {
  const slow = deferred();
  let count = 0;
  context.mock.method(globalThis, 'fetch', async () => {
    if (++count === 1) return slow.promise;
    return new Response(
      JSON.stringify({
        categories: [{ id: 'doors', items: [] }],
        cutawayLayers: [],
        trackRecords: []
      }),
      { status: 200 }
    );
  });
  const svc = new CatalogService('https://example.test/catalog.json');
  const first = svc.load();
  const second = await svc.load();
  slow.resolve(new Response(JSON.stringify({ categories: [{ id: 'stale', items: [] }], cutawayLayers: [], trackRecords: [] }), { status: 200 }));
  assert.equal(await first, null);
  assert.equal(second.categories[0].id, 'doors');

  context.mock.method(globalThis, 'fetch', async () =>
    new Response(
      JSON.stringify({
        categories: [
          { id: 'doors', items: [] },
          { id: 'doors', items: [] }
        ],
        cutawayLayers: [],
        trackRecords: []
      }),
      { status: 200 }
    )
  );
  await assert.rejects(() => svc.load(), /중복되었거나 손상된/);
});

test('QuoteService clamps dimensions, preserves dirty state on failed save, and clears on success or discard', async () => {
  const svc = new QuoteService();
  assert.equal(svc.isBusy, false);

  svc.update({ widthMm: 9999, heightMm: 500, thicknessMm: 100 });
  assert.equal(svc.state.draft.widthMm, 4500);
  assert.equal(svc.state.draft.heightMm, 1800);
  assert.equal(svc.state.draft.thicknessMm, 100);
  assert.equal(svc.isBusy, true);

  const failed = await svc.saveDraft(async () => {
    throw new Error('clipboard denied');
  });
  assert.equal(failed.ok, false);
  assert.equal(svc.isBusy, true);
  assert.match(svc.state.lastError, /clipboard denied/);

  const saved = await svc.saveDraft(async () => {});
  assert.equal(saved.ok, true);
  assert.equal(svc.isBusy, false);

  svc.update({ notes: '현장 긴급 실측' });
  assert.equal(svc.isBusy, true);
  svc.discard();
  assert.equal(svc.isBusy, false);

  // Edit while save is in flight must preserve dirty flag when older save finishes
  const saveGate = deferred();
  svc.update({ notes: '초기 메모' });
  const inFlight = svc.saveDraft(() => saveGate.promise);
  svc.update({ notes: '저장 중 추가 편집' });
  saveGate.resolve();
  const res = await inFlight;
  assert.equal(res.ok, true);
  assert.equal(res.editedDuringSave, true);
  assert.equal(svc.isBusy, true);

  // Explicit dispose silences future callbacks
  let notified = 0;
  const disposable = new QuoteService({ onChange: () => { notified += 1; } });
  disposable.update({ contactName: '홍길동' });
  assert.equal(notified, 1);
  disposable.dispose();
  disposable.update({ contactName: '김철수' });
  assert.equal(notified, 1);
});

test('VersionService background check does not abort an active navigationDecision check', async () => {
  const navPending = deferred();
  let calls = 0;
  const service = new VersionService({
    loadedBuild: 'aaaaaaaaaaaaaaaa',
    versionURL: 'https://example.test/version.json',
    fetchVersion: () => {
      calls += 1;
      return navPending.promise;
    }
  });
  const navPromise = service.navigationDecision('https://example.test/#quote', {
    currentURL: 'https://example.test/#hero',
    isBusy: () => false
  });
  const bgPromise = service.check({ priority: 'background' });
  assert.equal(calls, 1);
  navPending.resolve({ build: 'bbbbbbbbbbbbbbbb' });
  const [navDecision, bgResult] = await Promise.all([navPromise, bgPromise]);
  assert.equal(navDecision.kind, 'document');
  assert.equal(bgResult.ok, true);
  assert.equal(bgResult.changed, true);
  service.dispose();
});

test('Thermal calculation, route parsing, XSS escaping, and quote brief formatting are accurate', () => {
  const sealed = computeThermalSpec({ thicknessMm: 150, ambientC: 35, openRatio: 0, airCurtain: true });
  assert.equal(sealed.deltaT, 75);
  assert.equal(sealed.sealIntegrity, 100);
  assert.equal(sealed.coreTempC, -40);

  const openNoCurtain = computeThermalSpec({ thicknessMm: 150, ambientC: 35, openRatio: 1, airCurtain: false });
  const openWithCurtain = computeThermalSpec({ thicknessMm: 150, ambientC: 35, openRatio: 1, airCurtain: true });
  assert.ok(openWithCurtain.leakKw < openNoCurtain.leakKw);
  assert.ok(openWithCurtain.sealIntegrity > openNoCurtain.sealIntegrity);

  assert.deepEqual(parseRoute('#products/panels'), { section: 'products', sub: 'panels' });
  assert.deepEqual(parseRoute('#unknown-section'), { section: 'hero', sub: '' });
  assert.equal(escapeHtml('<script>"&\''), '&lt;script&gt;&quot;&amp;&#39;');
  assert.match(formatQuoteBrief(new QuoteService().state.draft), /032-815-7431~4/);
});
