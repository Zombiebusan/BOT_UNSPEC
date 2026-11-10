import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { BRANCHES } from '../src/master.js';
import { parseSnapshot, previousDate, resolveCsvReportDate } from '../src/report.js';
import { branchImage } from '../src/unspec-branch-image.js';

const [currentFile, previousFile, requestedDate, output] = process.argv.slice(2);
if (!currentFile || !output) throw new Error('Gunakan: npm run unspec:images:preview -- CSV_H CSV_H1_atau_- YYYY-MM-DD FOLDER_OUTPUT');
const date = requestedDate || resolveCsvReportDate(undefined, Date.now() / 1000);
const current = parseSnapshot(await readFile(currentFile, 'utf8'), date);
const previous = previousFile && previousFile !== '-' ? parseSnapshot(await readFile(previousFile, 'utf8'), previousDate(date)) : null;
const directory = resolve(output);
await mkdir(directory, { recursive: true });
for (const branch of BRANCHES) {
  const photo = await branchImage(current, previous, branch, date, Date.now() / 1000);
  const path = resolve(directory, photo.upload!.filename);
  await writeFile(path, Buffer.from(photo.upload!.base64, 'base64'));
  console.log(path);
}
console.log('Empat gambar selesai. Tidak ada pesan Telegram yang dikirim.');
