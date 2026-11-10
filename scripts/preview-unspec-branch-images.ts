import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { BRANCHES } from '../src/master.js';
import { parseSnapshot, previousDate, resolveCsvReportDate } from '../src/report.js';
import { branchImage } from '../src/unspec-branch-image.js';
import { branchReportMessages } from '../src/unspec-branch-image.js';
import { getConfig } from '../src/config.js';
import { UnspecApi } from '../src/unspec-api.js';

const [currentFile, previousFile, requestedDate, output] = process.argv.slice(2);
const liveMode = currentFile === '--live';
if (!currentFile || !(liveMode ? previousFile : output)) throw new Error('Gunakan: npm run unspec:images:preview -- CSV_H CSV_H1_atau_- YYYY-MM-DD FOLDER_OUTPUT, atau --live FOLDER_OUTPUT');
const live = liveMode ? await new UnspecApi(getConfig()).latest(180000, 'preview-'+randomUUID()) : null;
const date = live?.date || requestedDate || resolveCsvReportDate(undefined, Date.now() / 1000);
const current = live?.snapshot ?? parseSnapshot(await readFile(currentFile, 'utf8'), date);
const previous = live ? live.previous : previousFile && previousFile !== '-' ? parseSnapshot(await readFile(previousFile, 'utf8'), previousDate(date)) : null;
const timestamp = live?.timestamp ?? Date.now() / 1000;
const directory = resolve(liveMode ? previousFile! : output!);
await mkdir(directory, { recursive: true });
for (const branch of BRANCHES) {
  const photo = await branchImage(current, previous, branch, date, timestamp);
  const path = resolve(directory, photo.upload!.filename);
  await writeFile(path, Buffer.from(photo.upload!.base64, 'base64'));
  console.log(path);
}
if (live) {
  console.log(`Data nyata API dashboard: ${live.fetchedAt}; total ${BRANCHES.reduce((sum, branch) => sum + current.branches[branch].saldo, 0)} tiket.`);
  const reports = await branchReportMessages(current, previous, timestamp, date, 'SEMUA');
  for (const [index, branch] of BRANCHES.entries()) {
    const message = reports[index]!;
    if (typeof message !== 'string' && message.type === 'photo') console.log(`${branch}: ${current.branches[branch].saldo} tiket; caption ${message.caption!.length}/1024 karakter.`);
  }
}
console.log('Empat gambar selesai. Tidak ada pesan Telegram yang dikirim.');
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
