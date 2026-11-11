import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { outlineImageText } from './image-font.js';
import { BRANCHES, MASTER } from './master.js';
import type { PhotoMessage } from './messages.js';
import { InputError, type Snapshot } from './report.js';
import type { Config } from './config.js';
import type { LiveUnspecReport } from './unspec-api.js';
import { UNSPEC_SERVICE_AREAS } from './unspec-service-areas.js';

export const VISUAL_KEYS = ['daily', 'daily_branch', 'performance', 'monthly', 'monthly_branch', 'imjas', 'imjas_trend'] as const;
export type VisualKey = typeof VISUAL_KEYS[number];
export const VISUAL_LABELS: Record<VisualKey, string> = {
  daily: 'TREN HARIAN PENCAPAIAN UNSPEC - REGIONAL SULBAGSEL',
  daily_branch: 'TREN HARIAN PENCAPAIAN UNSPEC - PER BRANCH',
  performance: 'PERFORMANSI PER BRANCH MTD',
  monthly: 'TREN PENCAPAIAN BULANAN UNSPEC - REGIONAL SULBAGSEL',
  monthly_branch: 'TREN PENCAPAIAN BULANAN UNSPEC - PER BRANCH',
  imjas: 'IMJAS REALISASI & LOSS REGIONAL SULBAGSEL',
  imjas_trend: 'TREN IMJAS - KONTRIBUSI KPI UNSPEC PER BULAN',
};
export interface VisualHistory {
  version: 1; requestId: string; date: string; fetchedAt: string;
  daily: Record<string, Record<string, number>>;
  monthly: Record<string, { saldo: Record<string, number>; customers: Record<string, number> }>;
  customers: Record<string, number>;
  imjas: { weight: number; branch: Record<string, number>; regionalReported: number };
}
const xml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!);
const integer = new Intl.NumberFormat('id-ID');
const percentage = (value: number) => value.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
const rupiah = (value: number) => 'Rp ' + integer.format(Math.round(value));
const codes = Object.keys(MASTER);
const palettes = ['#2563a3', '#c72e43', '#e2a23b', '#148060'];
const theme = { ink: '#18364b', muted: '#617587', green: '#148060', red: '#c72e43', line: '#dde6ee', pale: '#f5f8fc' };

function checkCounts(value: unknown, limit = 100000): value is Record<string, number> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.entries(value).every(([code, count]) =>
    codes.includes(code) && Number.isSafeInteger(count) && (count as number) >= 0 && (count as number) <= limit);
}
export function validateVisualHistory(value: unknown, live: LiveUnspecReport, requestId: string): VisualHistory {
  if (!value || typeof value !== 'object') throw new InputError('Data visual API tidak valid.');
  const visual = value as VisualHistory;
  if (visual.version !== 1 || visual.requestId !== requestId || visual.date !== live.date || visual.fetchedAt !== live.fetchedAt ||
      !visual.daily || typeof visual.daily !== 'object' || Array.isArray(visual.daily) || !visual.monthly || typeof visual.monthly !== 'object' || Array.isArray(visual.monthly) || !visual.imjas || !visual.imjas.branch || !checkCounts(visual.customers, 10_000_000) ||
      Object.keys(visual.daily).length > 50 || Object.keys(visual.monthly).length > 36 ||
      !Object.entries(visual.daily).every(([date, counts]) => /^\d{4}-\d\d-\d\d$/.test(date) && date <= live.date && checkCounts(counts)) ||
      !Object.entries(visual.monthly).every(([month, data]) => /^\d{4}-\d\d$/.test(month) && data && checkCounts(data.saldo) && checkCounts(data.customers, 10_000_000)) ||
      visual.imjas.weight !== 6 || !Number.isFinite(visual.imjas.regionalReported) || visual.imjas.regionalReported < 0 || !BRANCHES.every(branch => Number.isFinite(visual.imjas.branch[branch]) && visual.imjas.branch[branch]! >= 0))
    throw new InputError('Histori visual UNSPEC dari dashboard tidak lengkap.');
  // The frozen live request is authoritative for today's row, even if a newer sync already exists.
  visual.daily[live.date] = Object.fromEntries(BRANCHES.flatMap(branch => Object.entries(live.snapshot.branches[branch].stos)));
  if (live.date.slice(0, 7) !== '2026-10' || live.date <= '2026-10-30')
    visual.monthly[live.date.slice(0, 7)] = { saldo: visual.daily[live.date]!, customers: visual.customers };
  return visual;
}

export async function fetchVisualHistory(config: Pick<Config, 'unspecApiUrl' | 'unspecApiToken'>, live: LiveUnspecReport, requestId: string): Promise<VisualHistory> {
  if (!config.unspecApiUrl || !config.unspecApiToken) throw new InputError('API UNSPEC belum dikonfigurasi.');
  const endpoint = new URL('/api/bot/visuals', config.unspecApiUrl);
  endpoint.searchParams.set('requestId', requestId);
  try {
    const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${config.unspecApiToken}` }, redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('HTTP');
    const body = await response.text();
    if (Buffer.byteLength(body) > 180000) throw new Error('Too large');
    return validateVisualHistory(JSON.parse(body), live, requestId);
  } catch (error) {
    if (error instanceof InputError) throw error;
    throw new InputError('Data grafik dashboard belum dapat diambil. Periksa deployment dashboard lalu coba cetak ulang.');
  }
}

type Datum = { date: string; value: number; count: number };
export function visualSeries(history: VisualHistory, live: LiveUnspecReport) {
  const branchCodes = (branch?: string) => codes.filter(code => !branch || MASTER[code]!.branch === branch);
  const sum = (values: Record<string, number>, group: string[]) => group.reduce((total, code) => total + (values[code] ?? 0), 0);
  const daily = (branch?: string): Datum[] => Object.entries(history.daily).filter(([date]) => date.startsWith(live.date.slice(0, 7)) && date <= live.date)
    .sort(([a], [b]) => a.localeCompare(b)).map(([date, values]) => {
      const group = branchCodes(branch), count = sum(values, group), lis = sum(history.customers, group);
      return { date, count, value: lis ? count / lis * 100 : 0 };
    });
  const monthly = (branch?: string): Datum[] => Object.entries(history.monthly).filter(([month]) => month <= live.date.slice(0, 7))
    .sort(([a], [b]) => a.localeCompare(b)).map(([date, data]) => {
      const group = branchCodes(branch), count = sum(data.saldo, group), lis = sum(data.customers, group);
      return { date, count, value: lis ? count / lis * 100 : 0 };
    });
  return { daily, monthly, sum, branchCodes };
}

class Canvas {
  readonly width = 1500;
  readonly parts: string[] = [];
  constructor(readonly title: string, readonly subtitle: string, readonly height = 850) {
    this.rect(0, 0, this.width, height, '#f2f6fa');
    this.rect(0, 0, this.width, 118, theme.ink);
    this.text(title, 36, 51, 28, '#fff', true);
    this.text(subtitle, 36, 86, 17, '#d0dfe9');
  }
  rect(x: number, y: number, w: number, h: number, fill: string, radius = 0) { this.parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${fill}"/>`); }
  text(value: string, x: number, y: number, size = 18, fill = theme.ink, bold = false, anchor = 'start') {
    this.parts.push(`<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" font-weight="${bold ? 700 : 400}" text-anchor="${anchor}">${xml(value)}</text>`);
  }
  line(x1: number, y1: number, x2: number, y2: number, color = theme.line, width = 2, dashed = false) {
    this.parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${width}" ${dashed ? 'stroke-dasharray="7 6"' : ''}/>`);
  }
  finish(): string { return `<svg xmlns="http://www.w3.org/2000/svg" width="${this.width}" height="${this.height}">${this.parts.join('')}</svg>`; }
}
function chart(c: Canvas, series: Datum[], x: number, y: number, width: number, height: number, color: string, title: string) {
  c.rect(x, y, width, height, '#fff', 12);c.text(title, x + 18, y + 32, 19, theme.ink, true);
  if (!series.length) { c.text('Belum ada snapshot untuk periode ini', x + 24, y + 110, 17, theme.muted);return; }
  const max = Math.max(.12, ...series.map(point => point.value)) * 1.25;
  const left = x + 90, right = x + width - 44, top = y + 72, bottom = y + height - 65;
  const px = (index: number) => left + (right - left) * (series.length === 1 ? .5 : index / (series.length - 1));
  const py = (value: number) => bottom - value / max * (bottom - top);
  for (let step = 0; step <= 3; step++) { const val = max * step / 3;c.line(left, py(val), right, py(val));c.text(percentage(val), left - 12, py(val) + 5, 12, theme.muted, false, 'end'); }
  c.line(left, py(.1), right, py(.1), theme.green, 2, true);
  c.text('Target 0,10%', left + 5, py(.1) - 9, 13, theme.green, true);
  for (let index = 0; index < series.length; index++) {
    const item = series[index]!, pointColor = item.value <= .1 ? theme.green : theme.red;
    if (index) c.line(px(index - 1), py(series[index - 1]!.value), px(index), py(item.value), color, 3);
    c.parts.push(`<circle cx="${px(index)}" cy="${py(item.value)}" r="5" fill="${pointColor}"/>`);
    c.text(percentage(item.value), px(index), py(item.value) - 14, 12, pointColor, true, 'middle');
    c.text(item.date.length === 10 ? item.date.slice(8) : item.date.slice(5), px(index), bottom + 25, 13, theme.muted, false, 'middle');
  }
}
function card(c: Canvas, x: number, y: number, width: number, height: number, title: string, value: string, detail: string, color = theme.ink) {
  c.rect(x, y, width, height, '#fff', 12);c.text(title, x + 18, y + 32, 15, theme.muted, true);
  c.text(value, x + 18, y + 78, 27, color, true);c.text(detail, x + 18, y + height - 20, 14, theme.muted);
}
function imjasFor(month: Datum, value: number, weight: number) {
  const achieved = month.value === 0 ? 100 : Math.min(100, .1 / month.value * 100);
  return { real: value * (achieved * weight / 100) / 100, loss: value * (weight - achieved * weight / 100) / 100, max: value * weight / 100 };
}

export function visualSvg(key: VisualKey, history: VisualHistory, live: LiveUnspecReport): string {
  const series = visualSeries(history, live), subtitle = `${live.date} · Posisi API ${new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Makassar', hour: '2-digit', minute: '2-digit' }).format(new Date(live.fetchedAt))} WITA`;
  const c = new Canvas(VISUAL_LABELS[key], subtitle, key === 'performance' ? 1020 : 850);
  const day = series.daily(), month = series.monthly();
  if (key === 'daily') {
    const latest = day.at(-1);card(c, 32, 145, 700, 120, 'SALDO H SULBAGSEL', integer.format(latest?.count ?? live.snapshot.totalRows), 'Snapshot regional terbaru', theme.green);
    card(c, 752, 145, 716, 120, 'REALISASI REGIONAL', latest ? percentage(latest.value) : '—', 'Target maksimal 0,10%', latest && latest.value <= .1 ? theme.green : theme.red);
    chart(c, day, 32, 286, 1436, 530, '#18364b', 'Tren Harian Sulbagsel');
  } else if (key === 'daily_branch' || key === 'monthly_branch') {
    BRANCHES.forEach((branch, index) => chart(c, key === 'daily_branch' ? series.daily(branch) : series.monthly(branch), 32 + index % 2 * 728, 145 + Math.floor(index / 2) * 345, 708, 325, palettes[index]!, branch));
  } else if (key === 'monthly') {
    const last = month.at(-1);
    card(c, 32, 145, 700, 120, 'REALISASI BULAN BERJALAN', last ? percentage(last.value) : '—', `Saldo ${integer.format(last?.count ?? 0)} tiket`, last && last.value <= .1 ? theme.green : theme.red);
    card(c, 752, 145, 716, 120, 'TARGET', '0,10%', 'Basis pelanggan dashboard');
    chart(c, month, 32, 286, 1436, 530, '#18364b', 'Tren Bulanan Sulbagsel');
  } else if (key === 'performance') {
    const rows = BRANCHES.map(branch => ({ branch, current: live.snapshot.branches[branch], old: live.previous?.branches[branch] }));
    const headers = ['BRANCH', 'SALDO H', 'H-1', 'LIS PELANGGAN', 'TARGET', 'REAL H', 'ACHIEVED'];
    const x = [45, 345, 520, 680, 935, 1105, 1300];
    c.rect(32, 145, 1436, 60, theme.ink, 8);headers.forEach((header, index) => c.text(header, x[index]!, 181, 16, '#fff', true));
    rows.forEach(({ branch, current, old }, index) => {
      const y = 205 + index * 72, rate = current.saldo / current.lis * 100;
      c.rect(32, y, 1436, 72, index % 2 ? '#fff' : '#eaf0f6');
      [branch, integer.format(current.saldo), old ? integer.format(old.saldo) : '—', integer.format(current.lis), integer.format(Math.floor(current.lis / 1000)), percentage(rate), percentage(rate === 0 ? 100 : Math.min(100, .1 / rate * 100))]
        .forEach((value, column) => c.text(value, x[column]!, y + 47, 21, column === 5 ? rate <= .1 ? theme.green : theme.red : theme.ink, column === 0));
    });
    const regionalLis = rows.reduce((sum, item) => sum + item.current.lis, 0), regionalH = rows.reduce((sum, item) => sum + item.current.saldo, 0);
    const regionalRate = regionalH / regionalLis * 100, regionalOld = live.previous?.totalRows;
    const regional = ['SULBAGSEL', integer.format(regionalH), regionalOld === undefined ? '—' : integer.format(regionalOld), integer.format(regionalLis), integer.format(Math.floor(regionalLis / 1000)), percentage(regionalRate), percentage(regionalRate === 0 ? 100 : Math.min(100, .1 / regionalRate * 100))];
    c.rect(32, 493, 1436, 72, '#dce9f3');regional.forEach((value, column) => c.text(value, x[column]!, 540, 21, theme.ink, true));
    const areas = UNSPEC_SERVICE_AREAS.map(area => {
      const branch = live.snapshot.branches[area.branch];
      const h = area.stos.reduce((sum, code) => sum + (branch.stos[code] ?? 0), 0);
      const lis = area.stos.reduce((sum, code) => sum + (branch.stoLis?.[code] ?? history.customers[code] ?? 0), 0);
      return { label: area.label.replace(/^SA /, 'SA '), h, rate: lis ? h / lis * 100 : 0 };
    });
    const ranking = [areas.filter(area => area.rate < .1).sort((a, b) => a.rate - b.rate), areas.filter(area => area.rate > .1).sort((a, b) => b.rate - a.rate)];
    ranking.forEach((list, column) => {
      const left = 32 + column * 728;
      c.rect(left, 590, 708, 385, '#fff', 12);c.rect(left, 590, 708, 50, theme.ink, 8);
      c.text(column === 0 ? 'TOP 5 SERVICE AREA · ACHIEVED TERBAIK' : 'TOP 5 SERVICE AREA · PERLU ATENSI', left + 18, 622, 17, '#fff', true);
      list.slice(0, 5).forEach((area, index) => {
        const y = 680 + index * 56;
        c.text(`${index + 1}. ${area.label}`, left + 20, y, 17, theme.ink, true);
        c.text(`${percentage(area.rate)}  ·  ${integer.format(area.h)} tiket`, left + 682, y, 16, column === 0 ? theme.green : theme.red, true, 'end');
      });
    });
  } else if (key === 'imjas') {
    const last = month.at(-1);
    if (last) {
      const regional = imjasFor(last, history.imjas.regionalReported, history.imjas.weight);
      card(c, 32, 145, 700, 142, 'REALISASI IMJAS SULBAGSEL', rupiah(regional.real), `KPI UNSPEC · ${percentage(last.value)}`, theme.green);
      card(c, 752, 145, 716, 142, 'LOSS IMJAS SULBAGSEL', rupiah(-regional.loss), `Alokasi ${history.imjas.weight}%`, theme.red);
      BRANCHES.forEach((branch, index) => {
        const datum = series.monthly(branch).at(-1);
        if (!datum) return;
        const metric = imjasFor(datum, history.imjas.branch[branch]!, history.imjas.weight);
        card(c, 32 + index % 2 * 728, 315 + Math.floor(index / 2) * 230, 708, 210, branch + ' · REALISASI / LOSS', rupiah(metric.real), `LOSS ${rupiah(-metric.loss)} · UNSPEC ${percentage(datum.value)}`, theme.green);
      });
    }
  } else if (key === 'imjas_trend') {
    const points = month.map(item => ({ date: item.date, ...imjasFor(item, history.imjas.regionalReported, history.imjas.weight) }));
    c.rect(32, 145, 1436, 660, '#fff', 12);c.text('Alokasi UNSPEC (6%) · Realisasi IMJAS · Loss IMJAS', 52, 184, 18, theme.ink, true);
    if (points.length) {
      const max = Math.max(...points.map(item => item.max)) * 1.2, maxLoss = Math.max(1, ...points.map(item => item.loss)) * 1.2, left = 115, right = 1400, top = 245, bottom = 716, baseline = 510;
      const px = (i: number) => left + (right - left) * (points.length === 1 ? .5 : i / (points.length - 1));
      const py = (v: number) => v < 0 ? baseline + (-v) / maxLoss * (bottom - baseline) : baseline - v / max * (baseline - top);
      for (let i = 0; i <= 3; i++) c.line(left, py(max * i / 3), right, py(max * i / 3));
      c.line(left, baseline, right, baseline, '#93a4b3');
      const lines = [{ key: 'max' as const, color: theme.muted }, { key: 'real' as const, color: theme.green }, { key: 'loss' as const, color: theme.red }];
      for (const { key: metric, color } of lines) points.forEach((item, i) => {
        const value = metric === 'loss' ? -item.loss : item[metric], previousValue = i ? metric === 'loss' ? -points[i - 1]!.loss : points[i - 1]![metric] : 0;
        if (i) c.line(px(i - 1), py(previousValue), px(i), py(value), color, 3, metric === 'max');
        c.parts.push(`<circle cx="${px(i)}" cy="${py(value)}" r="5" fill="${color}"/>`);
        c.text(rupiah(value), px(i), py(value) - (metric === 'loss' ? -24 : 16), 13, color, true, 'middle');
      });
      points.forEach((item, i) => c.text(item.date, px(i), 770, 15, theme.muted, false, 'middle'));
    }
  }
  return c.finish();
}

export async function renderVisualPhotos(history: VisualHistory, live: LiveUnspecReport, keys: readonly VisualKey[]): Promise<PhotoMessage[]> {
  const result: PhotoMessage[] = [];
  for (const key of keys) {
    const svg = visualSvg(key, history, live), png = await sharp(Buffer.from(await outlineImageText(svg))).png().toBuffer();
    result.push({ type: 'photo', photo: 'attach://photo', caption: `${VISUAL_LABELS[key]}\n${live.date} · Snapshot API ${new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Makassar', timeStyle: 'short' }).format(new Date(live.fetchedAt))} WITA`,
      upload: { filename: `UNSPEC-${key}-${live.date}.png`, base64: png.toString('base64') } });
  }
  return result;
}

export function visualRequestId(token: string, updateId: number): string {
  const namespace = createHash('sha256').update(token.split(':')[0]!).digest('hex').slice(0, 12);
  return `tg-${namespace}-${updateId}`;
}
