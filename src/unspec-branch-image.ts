import sharp from 'sharp';
import { BRANCHES, MASTER, masterForStoredBranch, type Branch } from './master.js';
import type { OutgoingMessage, PhotoMessage } from './messages.js';
import { InputError, percent, previousDate, renderReports, stripReportTimestamps, updateLabel, type Snapshot } from './report.js';
import { UNSPEC_SERVICE_AREAS } from './unspec-service-areas.js';

export interface BranchImageRow {
  label: string;
  level: 'branch' | 'sa' | 'sto';
  h: number;
  previous: number | null;
  lis: number;
  target: number;
  real: number;
  previousReal: number | null;
  delta: number | null;
  achieved: number;
}

// The dashboard groups areas/STOs by the original mapping insertion order.
const dashboardOrder = Object.keys(MASTER);
const integer = new Intl.NumberFormat('id-ID');
const xml = (value: string): string => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!);

export function buildBranchImageRows(snapshot: Snapshot, previous: Snapshot | null, branch: Branch, date: string): BranchImageRow[] {
  const current = snapshot.branches[branch], old = previous?.branches[branch];
  const master = masterForStoredBranch(branch, current.lis, date);
  const previousMaster = old ? masterForStoredBranch(branch, old.lis, previousDate(date)) : null;
  const row = (label: string, codes: readonly string[], level: BranchImageRow['level']): BranchImageRow => {
    const h = codes.reduce((sum, code) => sum + (current.stos[code] ?? 0), 0);
    const oldSaldo = old ? codes.reduce((sum, code) => sum + (old.stos[code] ?? 0), 0) : null;
    const lis = codes.reduce((sum, code) => sum + (current.stoLis?.[code] ?? master[code]!.lis), 0);
    const oldLis = old ? codes.reduce((sum, code) => sum + (old.stoLis?.[code] ?? previousMaster![code]!.lis), 0) : null;
    if (!Number.isSafeInteger(h) || h < 0 || !Number.isFinite(lis) || lis <= 0 || (oldLis !== null && oldLis <= 0)) throw new InputError('Saldo atau LIS gambar UNSPEC tidak valid.');
    const real = h / lis * 100;
    return { label, level, h, previous: oldSaldo, lis, target: Math.floor(lis / 1000), real,
      previousReal: oldSaldo === null ? null : oldSaldo / oldLis! * 100,
      delta: oldSaldo === null ? null : h - oldSaldo, achieved: h === 0 ? 100 : Math.min(100, .1 / real * 100) };
  };
  const codes = dashboardOrder.filter(code => MASTER[code]!.branch === branch);
  const rows = [row(branch, codes, 'branch')];
  if (rows[0]!.h !== current.saldo || rows[0]!.lis !== current.lis || (old && rows[0]!.previous !== old.saldo)) throw new InputError('Rincian gambar UNSPEC tidak cocok dengan total Branch.');
  const areas = UNSPEC_SERVICE_AREAS.filter(area => area.branch === branch)
    .map(area => ({ ...area, stos: [...area.stos].sort((a, b) => dashboardOrder.indexOf(a) - dashboardOrder.indexOf(b)) }))
    .sort((a, b) => dashboardOrder.indexOf(a.stos[0]!) - dashboardOrder.indexOf(b.stos[0]!));
  for (const area of areas) {
    const label = area.label === 'SA LUTRA' ? 'SERVICE AREA LUWU UTARA' : area.label === 'SA PARE PARE' ? 'SERVICE AREA PAREPARE' : area.label.replace(/^SA /, 'SERVICE AREA ');
    rows.push(row(label, area.stos, 'sa'), ...area.stos.map(code => row(code, [code], 'sto')));
  }
  return rows;
}

export function branchImageSvg(snapshot: Snapshot, previous: Snapshot | null, branch: Branch, date: string, timestamp: number): { svg: string; width: number; height: number } {
  const rows = buildBranchImageRows(snapshot, previous, branch, date);
  const widths = [350, 110, 110, 145, 145, 115, 130, 130, 110, 135];
  const width = widths.reduce((sum, size) => sum + size, 0) + 32;
  const rowHeight = 42, titleHeight = 94, headerHeight = 56, footerHeight = 36;
  const height = titleHeight + headerHeight + rows.length * rowHeight + footerHeight;
  const ink = '#18364b', muted = '#71808b', green = '#148060', red = '#c72e43';
  const text = (label: string, x: number, y: number, color = ink, bold = false, anchor = 'end', size = 16): string =>
    `<text x="${x}" y="${y}" fill="${color}" font-size="${size}" font-weight="${bold ? 700 : 400}" text-anchor="${anchor}">${xml(label)}</text>`;
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#fff"/><g font-family="DejaVu Sans,Arial,sans-serif">`,
    `<rect width="${width}" height="${titleHeight}" fill="${ink}"/>`, text('REKAP UNSPEC · '+branch, 24, 36, '#fff', true, 'start', 25),
    text('Tanggal laporan '+date+' · '+updateLabel(timestamp, date).replace(/\n/g, ' · '), 24, 68, '#d0dfe9', false, 'start', 15),
    `<rect x="16" y="${titleHeight}" width="${width - 32}" height="${headerHeight}" fill="${ink}"/>`];
  const headers = [['BRANCH / SERVICE AREA / STO'], ['SALDO H'], ['SALDO H-1'], ['LIS', 'PELANGGAN'], ['TARGET SALDO', '0,10%'], ['TARGET'], ['REAL H'], ['REAL H-1'], ['Δ SALDO'], ['ACHIEVED']];
  let x = 16;
  headers.forEach((labels, index) => {
    labels.forEach((label, line) => parts.push(text(label, index === 0 ? x + 12 : x + widths[index]! - 12, titleHeight + (labels.length === 1 ? 33 : 24 + line * 18), '#fff', true, index === 0 ? 'start' : 'end', 13)));
    x += widths[index]!;
  });
  rows.forEach((item, index) => {
    const y = titleHeight + headerHeight + index * rowHeight;
    parts.push(`<rect x="16" y="${y}" width="${width - 32}" height="${rowHeight}" fill="${item.level === 'branch' ? '#eaf0f6' : item.level === 'sa' ? '#f5f8fc' : index % 2 ? '#fff' : '#f9fbfd'}"/><path d="M16 ${y + rowHeight}H${width - 16}" stroke="#dce5ef"/>`);
    const values = [item.label, integer.format(item.h), item.previous === null ? '—' : integer.format(item.previous), integer.format(item.lis), integer.format(item.target), '0,10%', percent(item.real), item.previousReal === null ? '—' : percent(item.previousReal), item.delta === null ? '—' : integer.format(item.delta), percent(item.achieved)];
    let left = 16;
    values.forEach((value, column) => {
      const color = column === 1 || column === 2 ? '#1261a0' : column === 6 ? (item.real <= .1 ? green : red) : column === 8 && item.delta !== null ? (item.delta <= 0 ? green : red) : ink;
      parts.push(text(value, column === 0 ? left + (item.level === 'sto' ? 26 : 12) : left + widths[column]! - 12, y + 27, color, item.level !== 'sto', column === 0 ? 'start' : 'end', column === 0 && item.level === 'sa' ? 14 : 16));
      left += widths[column]!;
    });
  });
  parts.push(text('Sumber: snapshot dashboard UNSPEC · Seluruh Service Area dan STO ditampilkan · — = H-1 belum tersedia', 24, height - 12, muted, false, 'start', 13), '</g></svg>');
  return { svg: parts.join(''), width, height };
}

export async function branchImage(snapshot: Snapshot, previous: Snapshot | null, branch: Branch, date: string, timestamp: number): Promise<PhotoMessage> {
  const { svg } = branchImageSvg(snapshot, previous, branch, date, timestamp);
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return { type: 'photo', photo: 'attach://photo', caption: `📊 REKAP UNSPEC ${branch}\n${date} · Branch → Service Area → STO`,
    upload: { filename: `UNSPEC-${branch}-${date}.png`, base64: png.toString('base64') } };
}

export async function branchReportMessages(snapshot: Snapshot, previous: Snapshot | null, timestamp: number, date: string, scope: Branch | 'SEMUA', reports = renderReports(snapshot, previous, timestamp, date)): Promise<OutgoingMessage[]> {
  const messages: OutgoingMessage[] = [];
  for (const branch of scope === 'SEMUA' ? BRANCHES : [scope]) {
    messages.push(stripReportTimestamps(reports[BRANCHES.indexOf(branch)]!), await branchImage(snapshot, previous, branch, date, timestamp));
  }
  return messages;
}
