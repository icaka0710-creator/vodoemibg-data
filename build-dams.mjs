// Ежедневно: взима последния „Ежедневен бюлетин за състоянието на водите“ на МОСВ,
// превръща таблицата с 52-та комплексни и значими язовира в dams.json.
// Нужни: Node 20+ и LibreOffice (soffice) за превръщане на .doc в HTML.
//
//   node build-dams.mjs              – само последният бюлетин (ако е нов)
//   node build-dams.mjs --backfill 30 – и историята за последните 30 бюлетина
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = 'https://www.moew.government.bg';
const LIST = `${BASE}/bg/prescentur/byuletini-na-nkc-kum-mosv/vodi/`;
const OUT = 'dams.json';
const HISTORY_DAYS = 60;
const UA = 'VodoemiBG-data/1.0 (+https://github.com/icaka0710-creator/vodoemibg-data)';
const SOFFICE = process.env.SOFFICE || (process.platform === 'win32'
  ? 'C:\\Program Files\\LibreOffice\\program\\soffice.exe' : 'soffice');

async function get(url, binary = false) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
      return binary ? Buffer.from(await r.arrayBuffer()) : await r.text();
    } catch (e) {
      if (i === 2) throw e;
      await new Promise(res => setTimeout(res, 3000 * (i + 1)));
    }
  }
}

/** Страниците на бюлетините (най-новите първо). */
async function bulletinPages(count) {
  const pages = [];
  for (let p = 1; pages.length < count && p <= 20; p++) {
    const html = await get(p === 1 ? LIST : `${BASE}/bg/prescentur/byuletini-na-mosv/vodi/page/${p}/`);
    const found = [...html.matchAll(/href="(\/bg\/ejedneven-byuletin-za-sustoyanieto-na-vodite-za-[^"#]+\/)"/g)].map(m => m[1]);
    for (const f of found) if (!pages.includes(f)) pages.push(f);
    if (!found.length) break;
  }
  return pages.slice(0, count);
}

const num = s => {
  const v = parseFloat(String(s ?? '').replace(/\s/g, '').replace('%', '').replace(',', '.'));
  return Number.isFinite(v) ? v : null;
};

function trendOf(s) {
  if (!s) return null;
  if (s.includes('ʅ')) return 'overflow';
  if (s.includes('↑')) return 'up';
  if (s.includes('↓')) return 'down';
  if (s.includes('~')) return 'steady';
  return null;
}

/** Таблицата от HTML-а, който прави LibreOffice. */
export function parseTable(html) {
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(m =>
    [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(c =>
      c[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()));
  const dams = [];
  for (const r of rows) {
    if (!/^\d{1,2}$/.test(r[0] ?? '') || r.length < 7 || !/^БД/.test(r[1] ?? '')) continue;
    const pct = num(r[6]);
    if (pct === null || !String(r[6]).includes('%')) continue;     // „не се получава ежедневна информация“
    const raw = r[2].replace(/\*+/g, '').trim();
    const name = raw.split(/\s+-\s+/)[0].replace(/\s*\(.*\)\s*/, '').trim();
    const alias = /\(([^)]+)\)/.exec(raw)?.[1]?.trim();
    const last = r[r.length - 1];
    dams.push({
      name,
      ...(alias ? { alias } : {}),
      ...(/рез/.test(raw) ? { reserve: true } : {}),
      basin: r[1],
      totalMm3: num(r[3]),
      availableMm3: num(r[5]),
      pct,
      usefulPct: num(r[8]),
      inflow: r[9] && !/не се/.test(r[9]) ? num(r[9]) : null,
      outflow: r[10] ? num(r[10]) : null,
      trend: trendOf(last),
    });
  }
  return dams;
}

/** Сваля и разчита един бюлетин. */
async function readBulletin(pagePath) {
  const page = await get(BASE + pagePath);
  const doc = /href="([^"]+_Bulletin_Daily\.docx?)"/i.exec(page)?.[1];
  if (!doc) throw new Error('Няма .doc в ' + pagePath);
  const m = /(\d{2})(\d{2})(\d{4})_Bulletin_Daily/i.exec(doc);
  const date = `${m[3]}-${m[2]}-${m[1]}`;
  const dir = mkdtempSync(join(tmpdir(), 'dams-'));
  try {
    const ext = doc.toLowerCase().endsWith('.docx') ? 'docx' : 'doc';
    const file = join(dir, `b.${ext}`);
    writeFileSync(file, await get(BASE + doc, true));
    execFileSync(SOFFICE, ['--headless', '--convert-to', 'html', '--outdir', dir, file], { stdio: 'ignore', timeout: 120000 });
    const dams = parseTable(readFileSync(join(dir, 'b.html'), 'utf8'));
    if (dams.length < 30) throw new Error(`Само ${dams.length} язовира в ${doc} – форматът се е променил?`);
    return { date, url: BASE + doc, dams };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  const backfill = process.argv.includes('--backfill')
    ? parseInt(process.argv[process.argv.indexOf('--backfill') + 1] || '30', 10) : 0;
  const old = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : null;

  const pages = await bulletinPages(Math.max(1, backfill));
  const latest = await readBulletin(pages[0]);
  if (old && old.date === latest.date && !backfill) {
    console.log('Няма нов бюлетин (последен:', old.date + ')');
    return;
  }

  // История: дата → % по язовир
  const hist = {};
  for (const d of old?.dams ?? []) hist[d.name] = Object.fromEntries(d.history ?? []);
  const add = b => b.dams.forEach(d => { (hist[d.name] ??= {})[b.date] = d.pct; });
  for (const p of pages.slice(1)) {
    try { add(await readBulletin(p)); console.log('история:', p); }
    catch (e) { console.warn('пропуснат', p, e.message); }
  }
  add(latest);

  const out = {
    date: latest.date,
    time: '08:00',
    updatedAt: new Date().toISOString(),
    source: 'МОСВ – Ежедневен бюлетин за състоянието на водите',
    sourceUrl: latest.url,
    dams: latest.dams.map(d => ({
      ...d,
      history: Object.entries(hist[d.name] ?? {}).sort(([a], [b]) => a.localeCompare(b)).slice(-HISTORY_DAYS),
    })),
  };
  writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
  console.log(`Записан ${OUT}: ${out.date}, ${out.dams.length} язовира`);
}

main().catch(e => { console.error(e); process.exit(1); });
