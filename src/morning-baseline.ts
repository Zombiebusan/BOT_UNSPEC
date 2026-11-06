import { InputError, previousDate, witaDate, type Snapshot } from './report.js';
import { BRANCHES } from './master.js';
import { UNSPEC_SERVICE_AREAS } from './unspec-service-areas.js';
import type { OutgoingMessage } from './messages.js';

export interface ReportMorningBaseline {
  snapshot?: Snapshot;
  serviceAreas?: Record<string, number>;
  capturedAt: string;
  source?: 'api_08' | 'scheduled08' | 'first_available' | 'report_history';
}
export type MorningBalances = Snapshot | { serviceAreas: Record<string, number> };

export function unspecOperationalDate(timestampSeconds: number): string {
  const shifted = new Date(timestampSeconds * 1000 + 8 * 3600_000);
  const calendar = witaDate(timestampSeconds);
  return shifted.getUTCHours() < 8 ? previousDate(calendar) : calendar;
}
export function operationalWindow(date: string) {
  const start = Date.parse(`${date}T08:00:00+08:00`);
  return { start: new Date(start).toISOString(), end: new Date(start + 24 * 3600_000).toISOString() };
}
export function isMorningBaselineTime(value: string, date: string): boolean {
  const time = Date.parse(value);
  return Number.isFinite(time) && unspecOperationalDate(time / 1000) === date;
}
export function isExactMorningTime(value: string): boolean {
  const captured = new Date(value);
  return Number.isFinite(captured.valueOf()) && captured.getUTCHours() === 0 && captured.getUTCMinutes() < 5;
}
function checkedAreas(value: Record<string, number>): Record<string, number> {
  if (Object.keys(value).length !== UNSPEC_SERVICE_AREAS.length || UNSPEC_SERVICE_AREAS.some(area => !Number.isSafeInteger(value[area.label]) || value[area.label]! < 0)) throw new InputError('Acuan awal Service Area tidak lengkap.');
  if (Object.values(value).reduce((sum, count) => sum + count, 0) > 100_000) throw new InputError('Acuan awal melebihi batas tiket.');
  return { ...value };
}
export function areaBalances(value: MorningBalances): Record<string, number> {
  if ('serviceAreas' in value) return checkedAreas(value.serviceAreas);
  const counts = Object.fromEntries(UNSPEC_SERVICE_AREAS.map(area => [area.label, area.stos.reduce((sum, code) => {
    const count = value.branches?.[area.branch]?.stos?.[code] ?? 0;
    if (!Number.isSafeInteger(count) || count < 0) throw new InputError('Saldo acuan STO tidak valid.');
    return sum + count;
  }, 0)]));
  for (const branch of BRANCHES) {
    const total = UNSPEC_SERVICE_AREAS.filter(area => area.branch === branch).reduce((sum, area) => sum + counts[area.label]!, 0);
    if (total !== value.branches?.[branch]?.saldo) throw new InputError('Acuan STO tidak cocok dengan total Branch.');
  }
  return checkedAreas(counts);
}
export function morningBalances(value: ReportMorningBaseline): MorningBalances {
  if (value.serviceAreas) return { serviceAreas: checkedAreas(value.serviceAreas) };
  if (value.snapshot) return value.snapshot;
  throw new InputError('Saldo acuan awal tidak tersedia.');
}
export function baselineFromSnapshot(snapshot: Snapshot, capturedAt: string, source: ReportMorningBaseline['source'] = 'first_available'): ReportMorningBaseline {
  return { serviceAreas: areaBalances(snapshot), capturedAt, source: isExactMorningTime(capturedAt) && source === 'first_available' ? 'api_08' : source };
}
export function chooseOpeningBaseline(date: string, candidates: ReportMorningBaseline[], notAfter: string): ReportMorningBaseline | null {
  const valid = candidates.filter(candidate => {
    try { areaBalances(morningBalances(candidate));return isMorningBaselineTime(candidate.capturedAt, date) && Date.parse(candidate.capturedAt) <= Date.parse(notAfter); }
    catch { return false; }
  }).sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
  const selected = valid[0];
  return selected ? { serviceAreas: areaBalances(morningBalances(selected)), capturedAt: selected.capturedAt, source: selected.source || (isExactMorningTime(selected.capturedAt) ? 'api_08' : 'first_available') } : null;
}

export function baselineFromReportJob(messages: OutgoingMessage[], capturedAt: string, date: string): ReportMorningBaseline | null {
  if (!isMorningBaselineTime(capturedAt, date)) return null;
  const live = messages.some(message => typeof message !== 'string' && message.type !== 'photo' && message.reply_markup?.inline_keyboard.flat().some(button => button.callback_data.startsWith('live:unspec:') || button.callback_data === 'table:unspec:live'));
  if (!live) return null; // CSV uploads must never poison the shared API opening balance.
  const labels = new Set(UNSPEC_SERVICE_AREAS.map(area => area.label)), counts: Record<string, number> = {};
  let regional: number | undefined;
  for (const message of messages) {
    const text = typeof message === 'string' ? message : message.type === 'photo' ? '' : message.text;
    if (!text.includes('<pre>')) continue;
    const headerDate = /Tanggal data:\s*(\d{4}-\d{2}-\d{2})/.exec(text)?.[1];
    if (headerDate !== date && headerDate !== witaDate(Date.parse(capturedAt) / 1000)) return null;
    const table = /<pre>([\s\S]*?)<\/pre>/.exec(text)?.[1]?.normalize('NFKC');
    for (const line of table?.split('\n') || []) {
      const cells = line.split('│').slice(1, -1).map(cell => cell.trim());
      const index = cells.findIndex(cell => labels.has(cell));
      if (index >= 0 && /^\d[\d.]*$/.test(cells[index + 1] || '')) {
        const count = Number(cells[index + 1]!.replace(/\./g, ''));
        if (counts[cells[index]!] !== undefined && counts[cells[index]!] !== count) return null;
        counts[cells[index]!] = count;
      }
      if (cells[0] === 'SULBAGSEL') {
        const value = cells.slice(1).find(cell => /^\d[\d.]*$/.test(cell));
        if (value !== undefined) regional = Number(value.replace(/\./g, ''));
      }
    }
  }
  try {
    const checked = checkedAreas(counts);
    if (regional !== Object.values(checked).reduce((sum, value) => sum + value, 0)) return null;
    return { serviceAreas: checked, capturedAt, source: 'report_history' };
  } catch { return null; }
}
