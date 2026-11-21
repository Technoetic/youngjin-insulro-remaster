import { createHash } from 'node:crypto';
import { readdir, readFile, mkdir, writeFile, copyFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'src');
const output = path.join(root, 'dist');

if (path.dirname(output) !== root || path.basename(output) !== 'dist') {
  throw new Error('Invalid build destination');
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

async function listFiles(directory) {
  const items = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    items.map(item =>
      item.isDirectory()
        ? listFiles(path.join(directory, item.name))
        : [path.join(directory, item.name)]
    )
  );
  return nested.flat().sort();
}

const allSource = await listFiles(source);
const hash = createHash('sha256');
for (const file of allSource) {
  hash
    .update(path.relative(source, file).replaceAll('\\', '/'))
    .update('\0')
    .update(await readFile(file));
}

const sourceMedia = [
  ['hero-fire-ice-monolith.jpg', 'HERO_MONOLITH_URL'],
  ['hero-macro-150mm.jpg', 'HERO_MACRO_URL'],
  ['hero-cryo-cathedral.jpg', 'HERO_CATHEDRAL_URL'],
  ['door-cutaway.jpg', 'DOOR_CUTAWAY_URL'],
  ['panel-corridor.jpg', 'PANEL_CORRIDOR_URL'],
  ['dock-equipment.jpg', 'DOCK_EQUIPMENT_URL'],
  ['ci/ci-youngjin-white.png', 'CI_YOUNGJIN_WHITE_URL'],
  ['ci/ci-haccp.svg', 'CI_HACCP_URL'],
  ['ci/ci-incheon.svg', 'CI_INCHEON_URL'],
  ['ci/ci-suhyup.svg', 'CI_SUHYUP_URL'],
  ['ci/ci-at.svg', 'CI_AT_URL'],
  ['ci/ci-garak.svg', 'CI_GARAK_URL'],
  ['ci/ci-gamaco.svg', 'CI_GAMACO_URL'],
  ['ci/ci-incheon-cci.svg', 'CI_INCHEON_CCI_URL'],
  ['ci/ci-kicox.svg', 'CI_KICOX_URL'],
  ['ci/flag-it.svg', 'FLAG_IT_URL'],
  ['ci/partner-samlip.svg', 'PARTNER_SAMLIP_URL'],
  ['ci/partner-parisbaguette.svg', 'PARTNER_PARISBAGUETTE_URL'],
  ['ci/partner-pariscroissant.svg', 'PARTNER_PARISCROISSANT_URL'],
  ['ci/partner-aj.svg', 'PARTNER_AJ_URL'],
  ['ci/partner-lottesamgang.svg', 'PARTNER_LOTTESAMGANG_URL'],
  ['ci/partner-binggrae.svg', 'PARTNER_BINGGRAE_URL'],
  ['ci/partner-cjcheiljedang.svg', 'PARTNER_CJCHEILJEDANG_URL'],
  ['ci/partner-pulmuone.svg', 'PARTNER_PULMUONE_URL'],
  ['ci/partner-cjfreshway.svg', 'PARTNER_CJFRESHWAY_URL']
];

const media = {};
await mkdir(path.join(output, 'media'), { recursive: true });
for (const [relPath, tokenName] of sourceMedia) {
  const bytes = await readFile(path.join(root, 'source-media', relPath));
  const digest = createHash('sha256').update(bytes).digest('hex');
  hash.update(relPath).update(digest);
  const baseName = path.basename(relPath);
  const hashedName = `${digest.slice(0, 12)}-${baseName}`;
  await writeFile(path.join(output, 'media', hashedName), bytes);
  media[tokenName] = {
    url: `./media/${hashedName}`,
    bytes: bytes.length,
    sha256: digest
  };
}

const build = hash.digest('hex').slice(0, 16);
const assetsDir = path.join(output, 'assets', build);
await mkdir(assetsDir, { recursive: true });

for (const file of allSource.filter(f => f.startsWith(path.join(source, 'js') + path.sep))) {
  const dest = path.join(assetsDir, path.relative(path.join(source, 'js'), file));
  await mkdir(path.dirname(dest), { recursive: true });
  await copyFile(file, dest);
}

const cssLayers = await Promise.all(
  ['tokens.css', 'base.css', 'components.css'].map(name =>
    readFile(path.join(source, 'styles', name), 'utf8')
  )
);
await writeFile(path.join(assetsDir, 'styles.css'), cssLayers.join('\n\n'));
await copyFile(path.join(source, 'static', 'favicon.svg'), path.join(assetsDir, 'favicon.svg'));

const tokens = {
  BUILD_ID: build,
  STYLE_URL: `./assets/${build}/styles.css`,
  APP_URL: `./assets/${build}/app.js`,
  FAVICON_URL: `./assets/${build}/favicon.svg`,
  ...Object.fromEntries(Object.entries(media).map(([k, v]) => [k, v.url]))
};

const replaceTokens = input =>
  input.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_match, name) => {
    if (!(name in tokens)) throw new Error(`Unknown build token: ${name}`);
    return tokens[name];
  });

const html = replaceTokens(await readFile(path.join(source, 'index.html'), 'utf8'));
await writeFile(path.join(output, 'index.html'), html);

const catalogJson = replaceTokens(await readFile(path.join(source, 'data', 'catalog.json'), 'utf8'));
JSON.parse(catalogJson);
await writeFile(path.join(assetsDir, 'catalog.json'), catalogJson);

await writeFile(path.join(output, 'version.json'), JSON.stringify({ build }) + '\n');
await writeFile(path.join(output, '.nojekyll'), '');
await writeFile(
  path.join(output, '404.html'),
  `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>페이지를 찾을 수 없습니다 · 영진인슈로산업(주)</title>
  <style>
    body{margin:0;min-height:100vh;display:grid;place-items:center;background:#050914;color:#e6f6ff;font-family:system-ui,-apple-system,sans-serif;padding:24px}
    main{max-width:520px;border:1px solid rgba(56,232,255,.3);border-radius:20px;padding:32px;background:rgba(10,18,36,.92)}
    h1{margin:0 0 12px;font-size:1.6rem}
    p{color:#9eb5cc;line-height:1.6;margin:0 0 20px}
    a{display:inline-block;padding:12px 20px;border-radius:10px;background:#38e8ff;color:#04101d;font-weight:700;text-decoration:none}
  </style>
</head>
<body>
  <main>
    <h1>요청하신 경로를 찾을 수 없습니다 (404)</h1>
    <p>영진인슈로산업(주) 리마스터 메인 페이지에서 방열문·우레탄판넬·콜드체인 설비와 견적 사양서를 확인해 주세요.</p>
    <a href="/youngjin-insulro-remaster/">영진인슈로산업(주) 메인으로 돌아가기</a>
  </main>
</body>
</html>
`
);
await writeFile(
  path.join(output, '_headers'),
  `/*\n  Cache-Control: no-cache\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n/version.json\n  Cache-Control: no-store\n`
);

await mkdir(path.join(root, '.artifacts'), { recursive: true });
await writeFile(
  path.join(root, '.artifacts', 'build.json'),
  JSON.stringify({ build, media, sourceFiles: allSource.length }, null, 2) + '\n'
);

console.log(
  JSON.stringify({
    build,
    dist: 'dist',
    source_files: allSource.length,
    media_files: sourceMedia.length
  })
);
