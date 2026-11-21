export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function clamp(value, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return min;
  return Math.min(max, Math.max(min, num));
}

export function formatNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '0';
  return num.toLocaleString('ko-KR');
}

export function parseRoute(hashValue) {
  const raw = String(hashValue || '#hero').replace(/^#/, '').trim();
  if (!raw) return { section: 'hero', sub: '' };
  const [section, sub = ''] = raw.split('/');
  const validSections = new Set([
    'hero',
    'haccp-standard',
    'engineering',
    'products',
    'track-record',
    'heritage',
    'quote',
    'audit'
  ]);
  if (!validSections.has(section)) return { section: 'hero', sub: '' };
  return { section, sub };
}

export function computeThermalSpec({ thicknessMm, ambientC = 35, openRatio = 0, airCurtain = true }) {
  const map = {
    75: { targetC: -10, uValue: 0.28, label: '냉장·예냉 표준', grade: 'CRYO-75' },
    100: { targetC: -25, uValue: 0.21, label: '냉동창고 표준', grade: 'CRYO-100' },
    125: { targetC: -30, uValue: 0.17, label: '강냉동·물류센터', grade: 'CRYO-125' },
    150: { targetC: -40, uValue: 0.14, label: '초저온 급속동결', grade: 'CRYO-150 MAX' }
  };
  const spec = map[thicknessMm] || map[150];
  const deltaT = Math.round((ambientC - spec.targetC) * 10) / 10;
  const clampedOpen = clamp(openRatio, 0, 1);
  // Sealed efficiency vs infiltration under door open state
  const curtainFactor = airCurtain ? 0.34 : 1.0;
  const leakKw = Number((spec.uValue * deltaT * 0.018 + clampedOpen * deltaT * 0.42 * curtainFactor).toFixed(2));
  const sealIntegrity = Number(Math.max(0, 100 - clampedOpen * (airCurtain ? 38 : 84)).toFixed(1));
  const coreTempC = Number((spec.targetC + clampedOpen * (airCurtain ? 2.4 : 8.6)).toFixed(1));
  return {
    thicknessMm: Number(thicknessMm) in map ? Number(thicknessMm) : 150,
    ...spec,
    ambientC,
    deltaT,
    leakKw,
    sealIntegrity,
    coreTempC
  };
}

export function formatQuoteBrief(draft) {
  const lines = [
    '[영진인슈로산업(주) 방열도어·콜드체인 견적 요청서]',
    `• 요청 제품군: ${draft.doorType}`,
    `• 사용 온도 / 권장 두께: ${draft.targetTemp} (${draft.thicknessMm}mm)`,
    `• 유효 개구부 치수: W ${formatNumber(draft.widthMm)}mm × H ${formatNumber(draft.heightMm)}mm`,
    `• 현장 유형: ${draft.siteType}`,
    `• 선택 옵션: ${draft.options.length ? draft.options.join(', ') : '기본 사양'}`,
    `• 담당자 / 회사명: ${draft.contactName || '(미입력)'} / ${draft.companyName || '(미입력)'}`,
    `• 연락처: ${draft.phone || '(미입력)'}`,
    `• 현장 위치·메모: ${draft.notes || '(없음)'}`,
    '',
    '※ 수신: 영진인슈로산업(주) (인천 남동구 함박뫼로377번길 43 / TEL 032-815-7431~4 / yj7431@korea.com)'
  ];
  return lines.join('\n');
}
