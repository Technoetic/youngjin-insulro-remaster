import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

test('dist build artifacts satisfy GitHub Pages subpath, zero legacy bugs, and 19-item catalog contracts', async () => {
  const versionRaw = await readFile(path.join(dist, 'version.json'), 'utf8');
  const { build } = JSON.parse(versionRaw);
  assert.match(build, /^[a-f0-9]{16}$/);

  const html = await readFile(path.join(dist, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /\{\{[A-Z0-9_]+\}\}/, 'Unresolved template tokens in index.html');
  assert.match(html, new RegExp(`meta name="app-build" content="${build}"`));
  assert.match(html, new RegExp(`href="\\./assets/${build}/styles\\.css"`));
  assert.match(html, new RegExp(`src="\\./assets/${build}/app\\.js"`));
  assert.doesNotMatch(html, /Owellsteel/i, 'Legacy third-party copyright bug must not exist');
  assert.doesNotMatch(html, /축전된 노하우/, 'Legacy typo must not exist');

  await access(path.join(dist, '.nojekyll'));
  await access(path.join(dist, '404.html'));
  await access(path.join(dist, 'assets', build, 'styles.css'));
  await access(path.join(dist, 'assets', build, 'app.js'));

  const catalogRaw = await readFile(path.join(dist, 'assets', build, 'catalog.json'), 'utf8');
  assert.doesNotMatch(catalogRaw, /\{\{[A-Z0-9_]+\}\}/, 'Unresolved tokens in catalog.json');
  const catalog = JSON.parse(catalogRaw);
  assert.equal(catalog.categories.length, 4);
  const totalItems = catalog.categories.reduce((acc, c) => acc + c.items.length, 0);
  assert.equal(totalItems, 19);

  for (const url of Object.values(catalog.media)) {
    assert.match(url, /^\.\/media\/[a-f0-9]{12}-.+\.(jpg|png|svg)$/);
    await access(path.join(dist, url.replace(/^\.\//, '')));
  }

  const companyAndProducts = JSON.stringify({
    company: catalog.company,
    categories: catalog.categories,
    cutawayLayers: catalog.cutawayLayers,
    trackRecords: catalog.trackRecords
  });
  assert.doesNotMatch(companyAndProducts, /Owellsteel/i);
  assert.doesNotMatch(companyAndProducts, /제철소/);
  assert.doesNotMatch(companyAndProducts, /축전된 노하우/);
  assert.doesNotMatch(html, /flag-kr/i, 'KR flag image must be completely removed');
  assert.doesNotMatch(html, /ci-plate-flag/, 'Flag tile must be removed from CI marquee');
  assert.doesNotMatch(html, /ci-youngjin-color/i, 'Color boxed Youngjin CI must be removed');
  assert.doesNotMatch(catalogRaw, /ci-youngjin-color/i, 'Color boxed Youngjin CI must not exist in catalog');
  assert.match(html, /ci-youngjin-white\.png/, 'Authentic white Youngjin CI must be wired across header, showcase, and footer');

  // All 17 institutional & partner CIs must be pure vector SVGs with zero embedded raster <image> tags
  const vectorCis = [
    'ci-haccp.svg',
    'ci-incheon.svg',
    'ci-suhyup.svg',
    'ci-at.svg',
    'ci-garak.svg',
    'ci-gamaco.svg',
    'ci-incheon-cci.svg',
    'ci-kicox.svg',
    'partner-samlip.svg',
    'partner-parisbaguette.svg',
    'partner-pariscroissant.svg',
    'partner-aj.svg',
    'partner-lottesamgang.svg',
    'partner-binggrae.svg',
    'partner-cjcheiljedang.svg',
    'partner-pulmuone.svg',
    'partner-cjfreshway.svg'
  ];
  for (const slug of vectorCis) {
    assert.match(html, new RegExp(slug.replace('.', '\\.')), `Missing pure vector CI: ${slug}`);
  }
  for (const [k, url] of Object.entries(catalog.media)) {
    if ((k.startsWith('ci') && k !== 'ciYoungjinWhite') || k.startsWith('partner')) {
      assert.match(url, /\.svg$/, `CI asset ${k} must be vector SVG, got ${url}`);
      const svgBody = await readFile(path.join(dist, url.replace(/^\.\//, '')), 'utf8');
      assert.doesNotMatch(svgBody, /<image\b|base64,/i, `Vector SVG ${k} must not embed raster images`);
    }
  }
  assert.doesNotMatch(catalogRaw, /flag-kr/i, 'KR flag image must not exist in catalog');
  assert.doesNotMatch(html, /class="ci-meta"/, 'CI marquee must display pure CI images only');
  assert.equal((html.match(/class="ci-track"/g) || []).length, 1, 'CI marquee must be a single row');
  assert.match(html, /data-count-to="1991"/, 'Hero must align with SINCE 1991 CI');
  assert.doesNotMatch(html, /EST\. <span[^>]*>1987/, 'Hero must not conflict with SINCE 1991 CI');
  assert.match(html, /data-count-to="-40"/);
  assert.match(html, /axis-pulse-cryo/);
  assert.ok(catalog.remasterAudit.length >= 5);
});
