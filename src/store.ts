import postgres from 'postgres';
import { InputError, previousDate, reconciliation, renderReports, stripReportTimestamps, validDate, witaDate, type Snapshot } from './report.js';
import { renderValinsReports, type ValinsKind, type ValinsScope, type ValinsSnapshot } from './valins.js';
import { BRANCHES } from './master.js';
import type { OutgoingMessage } from './messages.js';
import { branchMenu, liveUnspecMenu, mainMenu, selectedLiveUnspecMenu, selectedUnspecTableMenu, selectedMenu, uploadPrompt, valinsKind, type MenuAction, type ReportPreference, type UploadMenuContext } from './menu.js';
import type { LiveUnspecReport } from './unspec-api.js';
import { unspecTableMessages } from './unspec-table.js';
import { branchReportMessages } from './unspec-branch-image.js';
import { baselineFromReportJob, baselineFromSnapshot, chooseOpeningBaseline, operationalWindow, type ReportMorningBaseline } from './morning-baseline.js';

interface StoredUnspecSnapshot extends Snapshot { reportMorning?: ReportMorningBaseline; reportSource?: 'api'; reportPrevious?: { date: string; snapshot: Snapshot } }

let client: ReturnType<typeof postgres> | undefined;
export function database(url: string): ReturnType<typeof postgres> {
  client ??= postgres(url, { max: 1, prepare: false, idle_timeout: 5, connect_timeout: 8 });
  return client;
}
export interface Job {
  update_id: string;
  chat_id: string;
  messages: OutgoingMessage[];
  delivered: number;
}
export class Store {
  constructor(private readonly sql: ReturnType<typeof postgres>) {}

  private async openingIn(tx: postgres.TransactionSql, date: string, notAfter: string, candidates: ReportMorningBaseline[]): Promise<ReportMorningBaseline | null> {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${'unspec-opening:' + date}, 0))`;
    const existing = await tx<{ baseline: ReportMorningBaseline }[]>`SELECT baseline FROM unspec_opening_balances WHERE report_date = ${date}::date`;
    if (existing[0]) candidates.push(existing[0].baseline);
    else {
      const window = operationalWindow(date);
      const snapshots = await tx<{ snapshot: StoredUnspecSnapshot; source_time: string }[]>`SELECT s.snapshot, s.source_time::text FROM daily_snapshots s
        LEFT JOIN telegram_jobs j ON j.update_id = s.source_order AND j.chat_id = s.chat_id
        WHERE s.source_time >= extract(epoch FROM ${window.start}::timestamptz) AND s.source_time < extract(epoch FROM ${window.end}::timestamptz)
          AND (s.snapshot->>'reportSource' = 'api' OR ((j.messages::text LIKE '%live:unspec:%' OR j.messages::text LIKE '%table:unspec:live%')
            AND (j.messages::text LIKE '%SUMMARY PERFORMANSI UNSPEC%' OR j.messages::text LIKE '%<pre>%')))
        ORDER BY s.source_time ASC LIMIT 100`;
      for (const row of snapshots) {
        try {
          candidates.push(baselineFromSnapshot(row.snapshot, new Date(Number(row.source_time) * 1000).toISOString()));
          if (row.snapshot.reportMorning) candidates.push(row.snapshot.reportMorning);
        } catch { /* Ignore incomplete legacy records rather than invent STO counts. */ }
      }
      const jobs = await tx<{ messages: OutgoingMessage[]; created_at: Date }[]>`SELECT messages, created_at FROM telegram_jobs
        WHERE created_at >= ${window.start}::timestamptz AND created_at < ${window.end}::timestamptz
          AND messages::text LIKE '%<pre>%' AND messages::text LIKE '%SULBAGSEL REPORT%'
        ORDER BY created_at ASC LIMIT 200`;
      for (const job of jobs) {
        const candidate = baselineFromReportJob(job.messages, new Date(job.created_at).toISOString(), date);
        if (candidate) candidates.push(candidate);
      }
    }
    const selected = chooseOpeningBaseline(date, candidates, notAfter);
    if (selected) await tx`INSERT INTO unspec_opening_balances (report_date, captured_at, baseline)
      VALUES (${date}::date, ${selected.capturedAt}::timestamptz, ${tx.json(selected as unknown as postgres.JSONValue)})
      ON CONFLICT (report_date) DO UPDATE SET captured_at = EXCLUDED.captured_at, baseline = EXCLUDED.baseline, updated_at = now()
      WHERE EXCLUDED.captured_at < unspec_opening_balances.captured_at`;
    return selected;
  }

  async captureUnspecOpening(live: LiveUnspecReport, scheduled = false): Promise<ReportMorningBaseline | null> {
    return this.sql.begin(async tx => this.openingIn(tx, live.date, live.fetchedAt, [
      baselineFromSnapshot(live.snapshot, live.fetchedAt, scheduled ? 'scheduled08' : 'first_available'), ...(live.morning ? [live.morning] : [])
    ])) as Promise<ReportMorningBaseline | null>;
  }

  async backfillUnspecOpening(date: string, notAfter = new Date().toISOString()): Promise<ReportMorningBaseline | null> {
    if (!validDate(date)) throw new InputError('Tanggal acuan awal tidak valid.');
    return this.sql.begin(async tx => this.openingIn(tx, date, notAfter, [])) as Promise<ReportMorningBaseline | null>;
  }

  async getJob(updateId: number): Promise<Job | null> {
    const rows = await this.sql<Job[]>`SELECT update_id::text, chat_id, messages, delivered FROM telegram_jobs WHERE update_id = ${updateId}`;
    return rows[0] ?? null;
  }

  async prepareMessages(updateId: number, chatId: string, messages: OutgoingMessage[]): Promise<void> {
    await this.sql`
      INSERT INTO telegram_jobs (update_id, chat_id, messages)
      VALUES (${updateId}, ${chatId}, ${this.sql.json(messages as unknown as postgres.JSONValue)})
      ON CONFLICT (update_id) DO NOTHING
    `;
  }

  async prepareUpload(updateId: number, chatId: string, messageId: number, timestamp: number, snapshot: Snapshot, date = witaDate(timestamp), scope: ValinsScope = 'SEMUA', menuContext?: UploadMenuContext): Promise<void> {
    if (!validDate(date)) throw new InputError('Tanggal laporan tidak valid.');
    await this.sql.begin(async tx => {
      // Serialise snapshot preparation for this chat, including simultaneous uploads.
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${chatId}, 0))`;
      const existing = await tx`SELECT update_id FROM telegram_jobs WHERE update_id = ${updateId}`;
      if (existing.length) return;
      const old = await tx<{ snapshot: Snapshot }[]>`
        SELECT snapshot FROM daily_snapshots WHERE chat_id = ${chatId} AND report_date = ${previousDate(date)}::date
      `;
      const reports = renderReports(snapshot, old[0]?.snapshot ?? null, timestamp, date);
      const changed = await tx`
        INSERT INTO daily_snapshots (chat_id, report_date, source_time, source_order, snapshot, reports)
        VALUES (${chatId}, ${date}::date, ${timestamp}, ${messageId}, ${tx.json(snapshot as unknown as postgres.JSONValue)}, ${tx.json(reports)})
        ON CONFLICT (chat_id, report_date) DO UPDATE SET
          source_time = EXCLUDED.source_time, source_order = EXCLUDED.source_order,
          uploaded_at = NOW(), snapshot = EXCLUDED.snapshot, reports = EXCLUDED.reports
        WHERE (daily_snapshots.source_time, daily_snapshots.source_order) < (EXCLUDED.source_time, EXCLUDED.source_order)
        RETURNING report_date
      `;
      if (changed.length) {
        // Backfilled/corrected H-1 also updates an already stored next-day report.
        // Messages sent earlier are retained; /report retrieves the corrected version.
        const next = await tx<{ snapshot: Snapshot; source_time: string; date: string }[]>`
          SELECT snapshot, source_time::text, report_date::text AS date FROM daily_snapshots
          WHERE chat_id = ${chatId} AND report_date = ${date}::date + 1
        `;
        if (next[0]) {
          const updated = renderReports(next[0].snapshot, snapshot, Number(next[0].source_time), next[0].date);
          await tx`UPDATE daily_snapshots SET reports = ${tx.json(updated)}
            WHERE chat_id = ${chatId} AND report_date = ${next[0].date}::date`;
        }
      }
      const note = reconciliation(snapshot);
      const selected = selectUnspecReports(reports, scope);
      let messages: OutgoingMessage[] = note ? [...selected, note] : selected;
      if (menuContext) {
        await tx`
          INSERT INTO report_preferences (chat_id, user_id, thread_id, report_type, scope, upload_date, awaiting_upload, upload_requested_at)
          VALUES (${chatId}, ${menuContext.userId}, ${menuContext.threadId}, ${menuContext.kind}, NULL, ${date}::date, false, NULL)
          ON CONFLICT (chat_id, user_id, thread_id) DO UPDATE SET
            report_type = EXCLUDED.report_type, scope = NULL, upload_date = EXCLUDED.upload_date, awaiting_upload = false, upload_requested_at = NULL, updated_at = NOW()
        `;
        const menu = branchMenu('unspec', date, Boolean(old[0]));
        if (note) menu.text += `\n\n${note}`;
        messages = [menu];
      }
      await tx`
        INSERT INTO telegram_jobs (update_id, chat_id, messages)
        VALUES (${updateId}, ${chatId}, ${tx.json(messages as unknown as postgres.JSONValue)})
      `;
    });
  }

  async report(chatId: string, date?: string, scope: ValinsScope = 'SEMUA'): Promise<string[]> {
    const rows = date ? await this.sql<{ reports: string[] }[]>`
      SELECT reports FROM daily_snapshots WHERE chat_id = ${chatId} AND report_date = ${date}::date
    ` : await this.sql<{ reports: string[] }[]>`
      SELECT reports FROM daily_snapshots WHERE chat_id = ${chatId} ORDER BY report_date DESC LIMIT 1
    `;
    return rows[0] ? selectUnspecReports(rows[0].reports, scope) : ['Belum ada laporan untuk tanggal tersebut. Upload CSV terlebih dahulu.'];
  }

  async prepareLiveUnspec(updateId: number, chatId: string, userId: string, threadId: number, scope: ValinsScope, live: LiveUnspecReport, format: 'text' | 'table' = 'text'): Promise<void> {
    await this.sql.begin(async tx => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${chatId}, 0))`;
      if ((await tx`SELECT update_id FROM telegram_jobs WHERE update_id = ${updateId}`).length) return;
      const old = await tx<{ snapshot: Snapshot }[]>`SELECT snapshot FROM daily_snapshots WHERE chat_id = ${chatId} AND report_date = ${previousDate(live.date)}::date`;
      const saved = await tx<{ snapshot: StoredUnspecSnapshot }[]>`SELECT snapshot FROM daily_snapshots WHERE chat_id = ${chatId} AND report_date = ${live.date}::date`;
      const persistedPrevious = saved[0]?.snapshot.reportPrevious;
      const previous = old[0]?.snapshot ?? (persistedPrevious?.date === previousDate(live.date) ? persistedPrevious.snapshot : null) ?? live.previous ?? null;
      const morning = await this.openingIn(tx, live.date, live.fetchedAt, [baselineFromSnapshot(live.snapshot, live.fetchedAt), ...(live.morning ? [live.morning] : [])]);
      const reports = renderReports(live.snapshot, previous, live.timestamp, live.date);
      const stored: StoredUnspecSnapshot = { ...live.snapshot, reportSource: 'api', ...(morning ? { reportMorning: morning } : {}), ...(previous ? { reportPrevious: { date: previousDate(live.date), snapshot: previous } } : {}) };
      const changed = await tx`INSERT INTO daily_snapshots (chat_id, report_date, source_time, source_order, snapshot, reports)
        VALUES (${chatId}, ${live.date}::date, ${live.timestamp}, ${updateId}, ${tx.json(stored as unknown as postgres.JSONValue)}, ${tx.json(reports)})
        ON CONFLICT (chat_id, report_date) DO UPDATE SET source_time = EXCLUDED.source_time, source_order = EXCLUDED.source_order,
          uploaded_at = NOW(), snapshot = EXCLUDED.snapshot, reports = EXCLUDED.reports
        WHERE (daily_snapshots.source_time, daily_snapshots.source_order) < (EXCLUDED.source_time, EXCLUDED.source_order)
        RETURNING report_date`;
      if (changed.length) {
        const next = await tx<{ snapshot: Snapshot; source_time: string; date: string }[]>`SELECT snapshot, source_time::text, report_date::text AS date FROM daily_snapshots WHERE chat_id = ${chatId} AND report_date = ${live.date}::date + 1`;
        if (next[0]) await tx`UPDATE daily_snapshots SET reports = ${tx.json(renderReports(next[0].snapshot, live.snapshot, Number(next[0].source_time), next[0].date))} WHERE chat_id = ${chatId} AND report_date = ${next[0].date}::date`;
      }
      await tx`INSERT INTO report_preferences (chat_id, user_id, thread_id, report_type, scope, upload_date, awaiting_upload, upload_requested_at)
        VALUES (${chatId}, ${userId}, ${threadId}, 'unspec', ${scope}, ${live.date}::date, false, NULL)
        ON CONFLICT (chat_id, user_id, thread_id) DO UPDATE SET report_type = EXCLUDED.report_type, scope = EXCLUDED.scope, upload_date = EXCLUDED.upload_date, awaiting_upload = false, upload_requested_at = NULL, updated_at = NOW()`;
      const messages = format === 'table'
        ? unspecTableMessages(live.snapshot, previous, live.date, morning).map(message => ({ ...message, reply_markup: selectedUnspecTableMenu(live.date, true).reply_markup }))
        : [...await branchReportMessages(live.snapshot, previous, live.timestamp, live.date, scope, reports), selectedLiveUnspecMenu(scope, live.date, live.fetchedAt, previous !== null)];
      await tx`INSERT INTO telegram_jobs (update_id, chat_id, messages) VALUES (${updateId}, ${chatId}, ${tx.json(messages as unknown as postgres.JSONValue)})`;
    });
  }

  async prepareValinsUpload(updateId: number, chatId: string, messageId: number, timestamp: number, snapshot: ValinsSnapshot, date = witaDate(timestamp), kind: ValinsKind = 'all', scope: ValinsScope = 'PARE-PARE', menuContext?: UploadMenuContext): Promise<void> {
    if (!validDate(date)) throw new InputError('Tanggal laporan tidak valid.');
    await this.sql.begin(async tx => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${chatId}, 0))`;
      const existing = await tx`SELECT update_id FROM telegram_jobs WHERE update_id = ${updateId}`;
      if (existing.length) return;
      await tx`
        INSERT INTO valins_snapshots (chat_id, report_date, source_time, source_order, snapshot)
        VALUES (${chatId}, ${date}::date, ${timestamp}, ${messageId}, ${tx.json(snapshot as unknown as postgres.JSONValue)})
        ON CONFLICT (chat_id, report_date) DO UPDATE SET
          source_time = EXCLUDED.source_time, source_order = EXCLUDED.source_order,
          uploaded_at = NOW(), snapshot = EXCLUDED.snapshot
        WHERE (valins_snapshots.source_time, valins_snapshots.source_order) < (EXCLUDED.source_time, EXCLUDED.source_order)
      `;
      let messages: OutgoingMessage[] = renderValinsReports(snapshot, kind, scope);
      if (menuContext) {
        await tx`
          INSERT INTO report_preferences (chat_id, user_id, thread_id, report_type, scope, upload_date, awaiting_upload, upload_requested_at)
          VALUES (${chatId}, ${menuContext.userId}, ${menuContext.threadId}, ${menuContext.kind}, NULL, ${date}::date, false, NULL)
          ON CONFLICT (chat_id, user_id, thread_id) DO UPDATE SET
            report_type = EXCLUDED.report_type, scope = NULL, upload_date = EXCLUDED.upload_date, awaiting_upload = false, upload_requested_at = NULL, updated_at = NOW()
        `;
        messages = [branchMenu(menuContext.kind, date)];
      }
      await tx`INSERT INTO telegram_jobs (update_id, chat_id, messages)
        VALUES (${updateId}, ${chatId}, ${tx.json(messages as unknown as postgres.JSONValue)})`;
    });
  }

  async valinsReport(chatId: string, kind: ValinsKind = 'all', scope: ValinsScope = 'PARE-PARE', date?: string): Promise<string[]> {
    const rows = date ? await this.sql<{ snapshot: ValinsSnapshot }[]>`
      SELECT snapshot FROM valins_snapshots WHERE chat_id = ${chatId} AND report_date = ${date}::date
    ` : await this.sql<{ snapshot: ValinsSnapshot }[]>`
      SELECT snapshot FROM valins_snapshots WHERE chat_id = ${chatId} ORDER BY report_date DESC LIMIT 1
    `;
    return rows[0] ? renderValinsReports(rows[0].snapshot, kind, scope) : [
      'Belum ada data VALINS untuk pilihan ini. Kirim file .xlsx dengan Sheet1 sesuai template REPORT VALINS ODP & ODC. Setelah upload, bot mengirim 2 laporan PARE-PARE.\n\n/valins — kedua laporan\n/valins_visit — VISIT ODP\n/valins_dc — DC QR CODE & SERVICE\nTambahkan branch dan/atau tanggal, misalnya /valins bone 2026-10-27. H-1 dibaca langsung dari Excel.'
    ];
  }

  async getPreference(chatId: string, userId: string, threadId = 0): Promise<ReportPreference | null> {
    const rows = await this.sql<ReportPreference[]>`
      SELECT report_type AS kind, scope, upload_date::text AS date FROM report_preferences
      WHERE chat_id = ${chatId} AND user_id = ${userId} AND thread_id = ${threadId}
    `;
    return rows[0] ?? null;
  }

  async getUploadRequest(chatId: string, userId: string, threadId = 0): Promise<ReportPreference['kind'] | null> {
    const rows = await this.sql<{ kind: ReportPreference['kind'] }[]>`SELECT report_type AS kind FROM report_preferences
      WHERE chat_id = ${chatId} AND user_id = ${userId} AND thread_id = ${threadId}
        AND awaiting_upload = true AND upload_requested_at > now() - interval '15 minutes'`;
    return rows[0]?.kind ?? null;
  }

  async prepareMenu(updateId: number, chatId: string, userId: string, threadId: number, action: MenuAction): Promise<void> {
    if (action.type === 'live' || action.type === 'visual' || action.type === 'visual-menu' || (action.type === 'table' && !action.date)) throw new InputError('Gunakan pemrosesan API untuk cetak UNSPEC terbaru.');
    await this.sql.begin(async tx => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${chatId}, 0))`;
      const existing = await tx`SELECT update_id FROM telegram_jobs WHERE update_id = ${updateId}`;
      if (existing.length) return;
      let messages: OutgoingMessage[];
      if (action.type === 'main') {
        await tx`DELETE FROM report_preferences WHERE chat_id = ${chatId} AND user_id = ${userId} AND thread_id = ${threadId}`;
        messages = [mainMenu()];
      } else if (action.type === 'kind' || action.type === 'upload' || action.type === 'live-menu') {
        const waiting = action.type === 'upload' || (action.type === 'kind' && action.kind !== 'unspec');
        await tx`
          INSERT INTO report_preferences (chat_id, user_id, thread_id, report_type, scope, upload_date, awaiting_upload, upload_requested_at)
          VALUES (${chatId}, ${userId}, ${threadId}, ${action.kind}, NULL, NULL, ${waiting}, CASE WHEN ${waiting} THEN now() ELSE NULL END)
          ON CONFLICT (chat_id, user_id, thread_id) DO UPDATE SET
            report_type = EXCLUDED.report_type, scope = NULL, upload_date = NULL, awaiting_upload = EXCLUDED.awaiting_upload, upload_requested_at = EXCLUDED.upload_requested_at, updated_at = NOW()
        `;
        messages = [(action.kind === 'unspec' && action.type !== 'upload') ? liveUnspecMenu() : uploadPrompt(action.kind)];
      } else {
        const preferences = await tx<ReportPreference[]>`
          SELECT report_type AS kind, scope, upload_date::text AS date FROM report_preferences
          WHERE chat_id = ${chatId} AND user_id = ${userId} AND thread_id = ${threadId}
        `;
        const preference = preferences[0];
        const date = action.date ?? preference?.date;
        if (!date || !preference?.date || preference.kind !== action.kind) {
          throw new InputError('Silakan pilih jenis laporan dan upload file terlebih dahulu melalui /start.');
        }
        if (date !== preference.date) throw new InputError('Tombol ini berasal dari upload sebelumnya. Gunakan pilihan cetak dari file terbaru yang Anda upload.');
        if (action.type === 'branches') {
          const old = action.kind === 'unspec' ? await tx`SELECT 1 FROM daily_snapshots WHERE chat_id = ${chatId} AND report_date = ${previousDate(date)}::date` : [];
          messages = [branchMenu(action.kind, date, Boolean(old.length))];
        } else if (action.type === 'table') {
          const rows = await tx<{ snapshot: StoredUnspecSnapshot; source_time: string }[]>`SELECT snapshot, source_time::text FROM daily_snapshots WHERE chat_id = ${chatId} AND report_date = ${date}::date`;
          if (!rows[0]) throw new InputError('Data upload tidak ditemukan. Silakan upload ulang file Anda.');
          const old = await tx<{ snapshot: Snapshot }[]>`SELECT snapshot FROM daily_snapshots WHERE chat_id = ${chatId} AND report_date = ${previousDate(date)}::date`;
          const storedPrevious = rows[0].snapshot.reportPrevious;
          const previous = old[0]?.snapshot ?? (storedPrevious?.date === previousDate(date) ? storedPrevious.snapshot : null);
          const opening = await tx<{ baseline: ReportMorningBaseline }[]>`SELECT baseline FROM unspec_opening_balances WHERE report_date = ${date}::date`;
          const candidates = [...(rows[0].snapshot.reportMorning ? [rows[0].snapshot.reportMorning] : []), ...(rows[0].snapshot.reportSource === 'api' && opening[0] ? [opening[0].baseline] : [])];
          const morning = chooseOpeningBaseline(date, candidates, new Date(Number(rows[0].source_time) * 1000).toISOString());
          await tx`UPDATE report_preferences SET scope = 'SEMUA', updated_at = NOW() WHERE chat_id = ${chatId} AND user_id = ${userId} AND thread_id = ${threadId}`;
          messages = unspecTableMessages(rows[0].snapshot, previous, date, morning).map(message => ({ ...message, reply_markup: selectedUnspecTableMenu(date, false).reply_markup }));
        } else {
          let reports: string[] = [];
          let imageReports: OutgoingMessage[] | null = null;
          if (action.kind === 'unspec') {
            const rows = await tx<{ reports: string[]; snapshot: StoredUnspecSnapshot; source_time: string }[]>`SELECT reports, snapshot, source_time::text FROM daily_snapshots WHERE chat_id = ${chatId} AND report_date = ${date}::date`;
            if (rows[0]) {
              reports = selectUnspecReports(rows[0].reports, action.scope);
              const old = await tx<{ snapshot: Snapshot }[]>`SELECT snapshot FROM daily_snapshots WHERE chat_id = ${chatId} AND report_date = ${previousDate(date)}::date`;
              const savedPrevious = rows[0].snapshot.reportPrevious;
              const previous = old[0]?.snapshot ?? (savedPrevious?.date === previousDate(date) ? savedPrevious.snapshot : null);
              imageReports = await branchReportMessages(rows[0].snapshot, previous, Number(rows[0].source_time), date, action.scope, rows[0].reports);
            }
          } else {
            const rows = await tx<{ snapshot: ValinsSnapshot }[]>`SELECT snapshot FROM valins_snapshots WHERE chat_id = ${chatId} AND report_date = ${date}::date`;
            if (rows[0]) reports = renderValinsReports(rows[0].snapshot, valinsKind(action.kind), action.scope);
          }
          const hasData = reports[0]?.startsWith('📊 SUMMARY') ?? false;
          if (!hasData) throw new InputError('Data upload tidak ditemukan. Silakan upload ulang file Anda.');
          await tx`UPDATE report_preferences SET scope = ${action.scope}, updated_at = NOW()
            WHERE chat_id = ${chatId} AND user_id = ${userId} AND thread_id = ${threadId}`;
          messages = [...(imageReports ?? reports), selectedMenu(action.kind, action.scope, date)];
        }
      }
      await tx`INSERT INTO telegram_jobs (update_id, chat_id, messages)
        VALUES (${updateId}, ${chatId}, ${tx.json(messages as unknown as postgres.JSONValue)})`;
    });
  }

  async claim(updateId: number, owner: string): Promise<Job | null> {
    const rows = await this.sql<Job[]>`
      UPDATE telegram_jobs SET lease_owner = ${owner}, lease_until = NOW() + INTERVAL '70 seconds'
      WHERE update_id = ${updateId} AND completed_at IS NULL
        AND (lease_until IS NULL OR lease_until < NOW())
      RETURNING update_id::text, chat_id, messages, delivered
    `;
    return rows[0] ?? null;
  }

  async advance(updateId: number, owner: string, delivered: number, done: boolean): Promise<void> {
    await this.sql`
      UPDATE telegram_jobs SET delivered = ${delivered}, completed_at = CASE WHEN ${done} THEN NOW() ELSE NULL END
      WHERE update_id = ${updateId} AND lease_owner = ${owner}
    `;
  }

  async fail(updateId: number, owner: string, code: number, reason: string): Promise<void> {
    // Advance the processing cursor for compatibility with retries from older deployments.
    // failed_at records that this job was abandoned, not successfully delivered.
    await this.sql`
      UPDATE telegram_jobs SET delivered = jsonb_array_length(messages), completed_at = NOW(),
        failed_at = NOW(), last_error_code = ${code}, failure_reason = ${reason}
      WHERE update_id = ${updateId} AND lease_owner = ${owner} AND completed_at IS NULL
    `;
  }

  async release(updateId: number, owner: string): Promise<void> {
    await this.sql`
      UPDATE telegram_jobs SET lease_owner = NULL, lease_until = NULL
      WHERE update_id = ${updateId} AND lease_owner = ${owner}
    `;
  }
}

export function selectUnspecReports(reports: string[], scope: ValinsScope): string[] {
  const selected = scope === 'SEMUA' ? reports : [reports[BRANCHES.indexOf(scope)]!];
  return selected.map(stripReportTimestamps);
}
