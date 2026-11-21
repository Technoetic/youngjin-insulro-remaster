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
  assert.ok(catalog.remasterAudit.length >= 5);
});
