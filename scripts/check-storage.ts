import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID, randomInt } from 'node:crypto';
import postgres from 'postgres';
import { InputError, parseSnapshot } from '../src/report.js';
import { Store } from '../src/store.js';
import { readFile } from 'node:fs/promises';
import { parseValinsWorkbook, renderValinsReports } from '../src/valins.js';

// Opt-in integration check against the configured database. Every write is rolled back.
if (!process.env.DATABASE_URL) throw new Error('Isi DATABASE_URL terlebih dahulu.');
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false, connect_timeout: 10 });
const rollback = new Error('INTEGRATION_CHECK_ROLLBACK');
let verified = false;
try {
  const workbook = process.argv[2] ? await parseValinsWorkbook(await readFile(process.argv[2])) : null;
  console.log('Memulai uji database dalam transaksi sementara...');
  await sql.begin(async tx => {
    await tx`SET LOCAL statement_timeout = '15s'`;
    // Store transactions become SAVEPOINTs inside this disposable outer transaction.
    const connection = new Proxy(tx, {
      get(target, property, receiver) {
        return property === 'begin' ? target.savepoint.bind(target) : Reflect.get(target, property, receiver);
      }
    }) as unknown as ReturnType<typeof postgres>;
    const store = new Store(connection);
    const chat = `integration-check:${randomUUID()}`;
    const otherChat = `integration-check:${randomUUID()}`;
    const base = -randomInt(1_000_000, 1_000_000_000);
    const stamp = (day: number, hour: number): number => Date.parse(`2026-10-${day}T${String(hour).padStart(2, '0')}:00:00+08:00`) / 1000;
    const snapshot = (count: number) => parseSnapshot([
      'INCIDENT,WORKZONE,SUMMARY,STATUS',
      ...Array.from({ length: count }, (_, index) => `INC${index},WON,[UNSPEC],BACKEND`)
    ].join('\n'), '2026-10-26');

    await store.prepareUpload(base, chat, 1, stamp(26, 8), snapshot(1));
    await store.prepareUpload(base - 1, chat, 3, stamp(26, 17), snapshot(2));
    // An older message arriving late must not replace the latest daily snapshot.
    await store.prepareUpload(base - 2, chat, 2, stamp(26, 12), snapshot(1));
    assert.match((await store.report(chat, '2026-10-26'))[3]!, /SALDO \(H\): 2\n/);

    await store.prepareUpload(base - 3, chat, 4, stamp(27, 8), snapshot(3));
    let reports = await store.report(chat, '2026-10-27');
    assert.equal(reports.length, 4);
    assert.match(reports[3]!, /SALDO \(H\): 3\n/);
    assert.match(reports[3]!, /SALDO \(H-1\): 2\n/);
    assert.match(reports[3]!, /\(Memburuk\)/);

    // A retry of an already prepared update cannot replace its snapshot or messages.
    await store.prepareUpload(base - 3, chat, 4, stamp(27, 8), snapshot(4));
    reports = await store.report(chat, '2026-10-27');
    assert.match(reports[3]!, /SALDO \(H\): 3\n/);

    await store.prepareUpload(base - 4, otherChat, 1, stamp(27, 8), snapshot(1));
    assert.match((await store.report(otherChat))[3]!, /SALDO \(H-1\): Belum tersedia/);

    const first = await store.claim(base - 3, 'worker-one');
    assert.equal(first?.delivered, 0);
    assert.equal(await store.claim(base - 3, 'worker-two'), null);
    await store.advance(base - 3, 'worker-one', 1, false);
    await store.release(base - 3, 'worker-one');
    const resumed = await store.claim(base - 3, 'worker-two');
    assert.equal(resumed?.delivered, 1);
    await store.advance(base - 3, 'worker-two', 4, true);
    await store.release(base - 3, 'worker-two');
    assert.equal(await store.claim(base - 3, 'worker-three'), null);
    assert.equal((await store.getJob(base - 3))?.delivered, 4);

    // Command jobs are also idempotent.
    await store.prepareMessages(base - 5, chat, ['original']);
    await store.prepareMessages(base - 5, chat, ['replacement']);
    assert.deepEqual((await store.getJob(base - 5))?.messages, ['original']);

    // Both exports are sent on the 27th, but their captions identify the 25th/26th.
    const datedChat = `integration-check:${randomUUID()}`;
    await store.prepareUpload(base - 6, datedChat, 1, stamp(27, 8), snapshot(2), '2026-10-25');
    await store.prepareUpload(base - 7, datedChat, 2, stamp(27, 8), snapshot(3), '2026-10-26');
    const datedReports = await store.report(datedChat, '2026-10-26');
    assert.doesNotMatch(datedReports[3]!, /📅|🕒 Diupload:/);
    assert.match(datedReports[3]!, /SALDO \(H-1\): 2\n/);
    // Correct the 25th after the 26th was already reported; /report must refresh H-1.
    await store.prepareUpload(base - 8, datedChat, 3, stamp(27, 9), snapshot(4), '2026-10-25');
    assert.match((await store.report(datedChat, '2026-10-26'))[3]!, /SALDO \(H-1\): 4\n/);

    const reversedChat = `integration-check:${randomUUID()}`;
    await store.prepareUpload(base - 9, reversedChat, 1, stamp(27, 8), snapshot(3), '2026-10-26');
    await store.prepareUpload(base - 10, reversedChat, 2, stamp(27, 9), snapshot(2), '2026-10-25');
    assert.match((await store.report(reversedChat, '2026-10-26'))[3]!, /SALDO \(H-1\): 2\n/);
    console.log('Snapshot, retry pengiriman, dan tanggal historis lulus. Menguji alur upload sebelum cetak...');

    await store.prepareMenu(base - 20, chat, 'user-a', 0, { type: 'kind', kind: 'unspec' });
    assert.deepEqual(await store.getPreference(chat, 'user-a'), { kind: 'unspec', scope: null, date: null });
    const prompt = (await store.getJob(base - 20))!.messages[0];
    assert.ok(prompt && typeof prompt !== 'string' && prompt.type !== 'photo' && prompt.text.includes('tanpa upload CSV'));
    assert.equal(await store.getUploadRequest(chat, 'user-a'), null);
    await store.prepareMenu(base - 90, chat, 'user-a', 0, { type: 'upload', kind: 'unspec' });
    assert.equal(await store.getUploadRequest(chat, 'user-a'), 'unspec');
    assert.equal(await store.getUploadRequest(otherChat, 'user-a'), null);
    assert.equal(await store.getUploadRequest(chat, 'other-user'), null);
    assert.equal(await store.getUploadRequest(chat, 'user-a', 42), null);
    await tx`UPDATE report_preferences SET upload_requested_at = now() - interval '16 minutes'
      WHERE chat_id = ${chat} AND user_id = 'user-a' AND thread_id = 0`;
    assert.equal(await store.getUploadRequest(chat, 'user-a'), null);
    // Retrying the original menu update must not renew an expired upload request.
    await store.prepareMenu(base - 90, chat, 'user-a', 0, { type: 'upload', kind: 'unspec' });
    assert.equal(await store.getUploadRequest(chat, 'user-a'), null);
    await store.prepareMenu(base - 91, chat, 'user-a', 0, { type: 'upload', kind: 'unspec' });
    assert.equal(await store.getUploadRequest(chat, 'user-a'), 'unspec');
    await assert.rejects(store.prepareMenu(base - 28, chat, 'user-a', 0, { type: 'branch', kind: 'unspec', scope: 'BONE' }), InputError);
    console.log('Pilihan cetak sebelum upload berhasil dicegah.');
    await store.prepareUpload(base - 29, chat, 5, stamp(27, 9), snapshot(3), '2026-10-27', 'SEMUA', { kind: 'unspec', userId: 'user-a', threadId: 0 });
    assert.equal(await store.getUploadRequest(chat, 'user-a'), null);
    const uploaded = (await store.getJob(base - 29))!.messages;
    assert.equal(uploaded.length, 1);
    const uploadMenu = uploaded[0];
    assert.ok(uploadMenu && typeof uploadMenu !== 'string' && uploadMenu.type !== 'photo' && uploadMenu.text.includes('berhasil diproses'));
    await store.prepareMenu(base - 21, chat, 'user-a', 0, { type: 'branch', kind: 'unspec', scope: 'BONE', date: '2026-10-27' });
    assert.deepEqual(await store.getPreference(chat, 'user-a'), { kind: 'unspec', scope: 'BONE', date: '2026-10-27' });
    const menuJob = await store.getJob(base - 21);
    assert.match(String(menuJob?.messages[0]), /BRANCH BONE/);
    const confirmation = menuJob?.messages.at(-1);
    assert.ok(confirmation && typeof confirmation !== 'string' && confirmation.type !== 'photo' && confirmation.reply_markup?.inline_keyboard.length);
    await store.prepareMenu(base - 22, chat, 'user-b', 0, { type: 'kind', kind: 'valins_dc' });
    await store.prepareMenu(base - 23, chat, 'user-a', 42, { type: 'kind', kind: 'valins_visit' });
    assert.deepEqual(await store.getPreference(chat, 'user-a'), { kind: 'unspec', scope: 'BONE', date: '2026-10-27' });
    assert.deepEqual(await store.getPreference(chat, 'user-b'), { kind: 'valins_dc', scope: null, date: null });
    assert.deepEqual(await store.getPreference(chat, 'user-a', 42), { kind: 'valins_visit', scope: null, date: null });
    assert.equal(await store.getUploadRequest(chat, 'user-b'), 'valins_dc');
    assert.equal(await store.getUploadRequest(chat, 'user-a', 42), 'valins_visit');
    await store.prepareMenu(base - 24, chat, 'user-a', 0, { type: 'main' });
    await store.prepareMenu(base - 24, chat, 'user-a', 0, { type: 'kind', kind: 'unspec' });
    assert.equal(await store.getPreference(chat, 'user-a'), null); // Retry cannot reapply a different action.
    assert.equal(await store.getUploadRequest(chat, 'user-a'), null);
    assert.equal((await store.getPreference(chat, 'user-b'))?.kind, 'valins_dc');
    await store.prepareUpload(base - 25, chat, 5, stamp(27, 10), snapshot(3), '2026-10-27', 'BONE');
    assert.equal((await store.getJob(base - 25))?.messages.length, 1);
    assert.match(String((await store.getJob(base - 25))?.messages[0]), /BRANCH BONE/);
    assert.equal((await store.report(chat, '2026-10-27')).length, 4); // All branches remain in the snapshot.

    const flowChat = `integration-check:${randomUUID()}`;
    const context = { kind: 'unspec' as const, userId: 'upload-user', threadId: 0 };
    await store.prepareUpload(base - 30, flowChat, 1, stamp(26, 17), snapshot(2));
    await store.prepareMenu(base - 31, flowChat, context.userId, 0, { type: 'kind', kind: 'unspec' });
    await store.prepareUpload(base - 32, flowChat, 2, stamp(27, 8), snapshot(3), '2026-10-27', 'SEMUA', context);
    await store.prepareMenu(base - 33, flowChat, context.userId, 0, { type: 'branch', kind: 'unspec', scope: 'PARE-PARE', date: '2026-10-27' });
    assert.match(String((await store.getJob(base - 33))!.messages[0]), /SALDO \(H\): 3\nSALDO \(H-1\): 2\n/);
    await store.prepareUpload(base - 34, flowChat, 3, stamp(27, 10), snapshot(4), '2026-10-27', 'SEMUA', context);
    await store.prepareMenu(base - 35, flowChat, context.userId, 0, { type: 'branch', kind: 'unspec', scope: 'PARE-PARE', date: '2026-10-27' });
    assert.match(String((await store.getJob(base - 35))!.messages[0]), /SALDO \(H\): 4\nSALDO \(H-1\): 2\n/);
    await store.prepareUpload(base - 36, flowChat, 4, stamp(28, 8), snapshot(5), '2026-10-28', 'SEMUA', context);
    await assert.rejects(store.prepareMenu(base - 37, flowChat, context.userId, 0, { type: 'branch', kind: 'unspec', scope: 'PARE-PARE', date: '2026-10-27' }), InputError);
    assert.match((await store.report(flowChat, '2026-10-28'))[3]!, /SALDO \(H\): 5\nSALDO \(H-1\): 4\n/);
    assert.match((await store.report(flowChat, '2026-10-26'))[3]!, /SALDO \(H\): 2\n/);
    console.log('Uji menu lulus: izin upload sekali pakai, kedaluwarsa 15 menit, isolasi chat/pengguna/topic, tanggal, H-1, dan retry.');

    const liveChat = `integration-check:${randomUUID()}`;
    const live = { date: '2026-10-27', fetchedAt: new Date(stamp(27, 9) * 1000).toISOString(), timestamp: stamp(27, 9), snapshot: snapshot(3), previous: snapshot(8) };
    await store.prepareLiveUnspec(base - 80, liveChat, 'api-user', 42, 'SEMUA', live);
    const liveJob = (await store.getJob(base - 80))!;
    assert.equal(liveJob.messages.length, 9);
    assert.equal(liveJob.messages.filter(message => typeof message !== 'string' && message.type === 'photo').length, 4);
    assert.match(String(liveJob.messages[6]), /SALDO \(H\): 3\nSALDO \(H-1\): 8\n/);
    assert.deepEqual(await store.getPreference(liveChat, 'api-user', 42), { kind: 'unspec', scope: 'SEMUA', date: '2026-10-27' });
    await store.prepareLiveUnspec(base - 80, liveChat, 'api-user', 42, 'SEMUA', { ...live, snapshot: snapshot(9) });
    assert.deepEqual((await store.getJob(base - 80))!.messages, liveJob.messages);
    await store.prepareLiveUnspec(base - 79, liveChat, 'api-user', 42, 'PARE-PARE', { ...live, snapshot: snapshot(5) });
    assert.equal((await store.getJob(base - 79))!.messages.length, 3);
    assert.match((await store.report(liveChat, '2026-10-27'))[3]!, /SALDO \(H\): 5\nSALDO \(H-1\): 8\n/);
    assert.match(String((await store.getJob(base - 80))!.messages[6]), /SALDO \(H\): 3\n/);
    const missingChat = `integration-check:${randomUUID()}`;
    await store.prepareUpload(base - 78, missingChat, 1, stamp(25, 8), snapshot(2), '2026-10-25');
    await store.prepareLiveUnspec(base - 77, missingChat, 'api-user', 0, 'BONE', { ...live, previous: null });
    assert.match(String((await store.getJob(base - 77))!.messages[0]), /SALDO \(H-1\): Belum tersedia/);
    console.log('Uji cetak API lulus: tanpa CSV, H-1 dashboard, semua/selected branch, retry, dan source ordering.');
    const morningLive = { ...live, timestamp: stamp(27, 10), fetchedAt: new Date(stamp(27, 10) * 1000).toISOString(), morning: { snapshot: snapshot(7), capturedAt: '2026-10-27T00:01:00Z' } };
    await store.prepareLiveUnspec(base - 76, liveChat, 'api-user', 42, 'SEMUA', morningLive, 'table');
    const tableJob = (await store.getJob(base - 76))!;
    assert.equal(tableJob.messages.length, 1);
    const table = tableJob.messages[0];
    assert.ok(table && typeof table !== 'string' && table.type === 'text');
    assert.equal(table.parse_mode, 'HTML');assert.ok(table.text.includes('<pre>'));
    assert.equal(table.reply_markup!.inline_keyboard[0]![0]!.callback_data, 'table:unspec:live');
    const morningRow = table.text.split('\n').find(line => line.split('│')[1]?.trim() === 'SA MAJENE')!;
    assert.equal(morningRow.split('│')[6]!.trim(), '4', 'CLOSE HI must be 08:00 saldo 7 minus current saldo 3, not H-1 saldo 8');
    await store.prepareLiveUnspec(base - 76, liveChat, 'api-user', 42, 'SEMUA', { ...live, snapshot: snapshot(9) }, 'table');
    assert.deepEqual((await store.getJob(base - 76))!.messages, tableJob.messages);
    await store.prepareMenu(base - 73, liveChat, 'api-user', 42, { type: 'table', kind: 'unspec', date: '2026-10-27' });
    const storedMorningTable = (await store.getJob(base - 73))!.messages[0];
    assert.ok(storedMorningTable && typeof storedMorningTable !== 'string' && storedMorningTable.type === 'text');
    assert.equal(storedMorningTable.text.split('\n').find(line => line.split('│')[1]?.trim() === 'SA MAJENE')!.split('│')[6]!.trim(), '4');
    await store.prepareMenu(base - 75, flowChat, context.userId, 0, { type: 'table', kind: 'unspec', date: '2026-10-28' });
    const archivedTable = (await store.getJob(base - 75))!.messages[0];
    assert.ok(archivedTable && typeof archivedTable !== 'string' && archivedTable.type === 'text');
    assert.match(archivedTable.text, /2026-10-28/);
    await assert.rejects(store.prepareMenu(base - 74, flowChat, context.userId, 0, { type: 'table', kind: 'unspec', date: '2026-10-27' }), InputError);
    console.log('Uji tabel teks lulus: tersimpan dalam job, retry identik, dan arsip terikat tanggal CSV.');
    await store.prepareLiveUnspec(base - 72, liveChat, 'api-user', 42, 'SEMUA', {
      date: '2026-10-27', sourceDate: '2026-10-28', timestamp: stamp(28, 2), fetchedAt: new Date(stamp(28, 2) * 1000).toISOString(), snapshot: snapshot(4), previous: null
    }, 'table');
    assert.deepEqual(await store.getPreference(liveChat, 'api-user', 42), { kind: 'unspec', scope: 'SEMUA', date: '2026-10-27' });
    assert.match((await store.report(liveChat, '2026-10-27'))[3]!, /SALDO \(H-1\): 8\n/);
    const overnight = (await store.getJob(base - 72))!.messages[0];
    assert.ok(overnight && typeof overnight !== 'string' && overnight.type === 'text');
    assert.equal(overnight.text.split('\n').find(line => line.split('│')[1]?.trim() === 'SA MAJENE')!.split('│')[6]!.trim(), '3');
    await store.prepareLiveUnspec(base - 71, liveChat, 'api-user', 42, 'SEMUA', {
      date: '2026-10-28', timestamp: stamp(28, 8), fetchedAt: new Date(stamp(28, 8) * 1000).toISOString(), snapshot: snapshot(6), previous: snapshot(3)
    }, 'table');
    assert.match((await store.report(liveChat, '2026-10-28'))[3]!, /SALDO \(H-1\): 4\n/);
    const newDay = (await store.getJob(base - 71))!.messages[0];
    assert.ok(newDay && typeof newDay !== 'string' && newDay.type === 'text');
    assert.equal(newDay.text.split('\n').find(line => line.split('│')[1]?.trim() === 'SA MAJENE')!.split('│')[6]!.trim(), '0');
    console.log('Hari operasional lulus: acuan berlanjut sesudah tengah malam dan reset pukul 08.00 WITA.');

    if (workbook) {
      const valinsChat = `integration-check:${randomUUID()}`;
      const expected = renderValinsReports(workbook);
      await store.prepareValinsUpload(base - 11, valinsChat, 2, stamp(27, 9), workbook, '2026-10-26');
      assert.deepEqual(await store.valinsReport(valinsChat, 'all', 'PARE-PARE', '2026-10-26'), expected);
      assert.deepEqual((await store.getJob(base - 11))?.messages, expected);
      // The first VALINS upload already has growth from the workbook, not daily_snapshots.
      assert.ok(expected.every(report => !report.includes('GROWTH (H VS H-1): Belum tersedia')));
      assert.equal((await store.valinsReport(valinsChat, 'dc', 'SEMUA')).length, 4);
      assert.equal((await store.report(valinsChat)).length, 1); // No UNSPEC data was created.
      await store.prepareValinsUpload(base - 11, valinsChat, 2, stamp(27, 9), workbook, '2026-10-25');
      assert.equal((await tx`SELECT report_date FROM valins_snapshots WHERE chat_id = ${valinsChat}`).length, 1);
      await store.prepareValinsUpload(base - 12, valinsChat, 1, stamp(27, 8), workbook, '2026-10-26');
      const last = await tx<{ source_order: string }[]>`SELECT source_order::text FROM valins_snapshots WHERE chat_id = ${valinsChat}`;
      assert.equal(last[0]?.source_order, '2');
      assert.match((await store.valinsReport(`${valinsChat}-other`))[0]!, /Belum ada data VALINS/);
      await store.prepareValinsUpload(base - 26, valinsChat, 3, stamp(27, 10), workbook, '2026-10-26', 'visit', 'SEMUA');
      const selected = (await store.getJob(base - 26))!.messages;
      assert.equal(selected.length, 4);
      assert.ok(selected.every(message => typeof message === 'string' && message.includes('VALINS VISIT ODP')));
      await store.prepareValinsUpload(base - 38, valinsChat, 4, stamp(27, 11), workbook, '2026-10-26', 'dc', 'PARE-PARE', { kind: 'valins_dc', userId: 'user-a', threadId: 0 });
      const valinsMenu = (await store.getJob(base - 38))!.messages;
      assert.equal(valinsMenu.length, 1);
      const valinsUploadMenu = valinsMenu[0];
      assert.ok(valinsUploadMenu && typeof valinsUploadMenu !== 'string' && valinsUploadMenu.type !== 'photo' && valinsUploadMenu.text.includes('berhasil diproses'));
      await store.prepareMenu(base - 27, valinsChat, 'user-a', 0, { type: 'branch', kind: 'valins_dc', scope: 'BONE', date: '2026-10-26' });
      assert.match(String((await store.getJob(base - 27))?.messages[0]), /VALINS DC QR CODE & SERVICE – BONE/);
      console.log('Uji VALINS lulus: file Excel, H-1 bawaan, pemilihan laporan/branch, isolasi UNSPEC/chat, dan retry.');
    }
    verified = true;
    throw rollback;
  });
} catch (error) {
  if (error !== rollback) {
    console.error(error instanceof assert.AssertionError ? `Uji penyimpanan gagal: ${error.message}` : 'Uji penyimpanan gagal. Periksa koneksi dan skema database.');
    if (error instanceof Error && 'code' in error) console.error(`Kode kesalahan: ${String(error.code)}`);
    if (error instanceof InputError) console.error(error.message);
    process.exitCode = 1;
  }
} finally { await sql.end({ timeout: 5 }); }
if (verified && !process.exitCode) console.log('Database lulus: snapshot terbaru, H-1, isolasi chat, retry, dan kelanjutan pengiriman. Semua data uji di-rollback.');
