import { readFile } from 'node:fs/promises';
import { parseSnapshot, previousDate, resolveCsvReportDate } from '../src/report.js';
import { renderUnspecTableText } from '../src/unspec-table.js';

const [currentFile, previousFile, requestedDate] = process.argv.slice(2);
if (!currentFile) throw new Error('Gunakan: npm run unspec:table:preview -- CSV_H [CSV_H1] [YYYY-MM-DD]');
const date = requestedDate || resolveCsvReportDate(undefined, Date.now() / 1000);
const current = parseSnapshot(await readFile(currentFile, 'utf8'), date);
const previous = previousFile && previousFile !== '-' ? parseSnapshot(await readFile(previousFile, 'utf8'), previousDate(date)) : null;
console.log(`REKAP UNSPEC SULBAGSEL — ${date}\n${renderUnspecTableText(current, previous, date)}\nTidak ada pesan Telegram yang dikirim.`);
