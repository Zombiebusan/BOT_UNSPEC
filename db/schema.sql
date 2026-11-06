-- Snapshot terisolasi per chat. Tidak menyimpan nama/nomor pelanggan atau CSV mentah.
CREATE TABLE IF NOT EXISTS daily_snapshots (
  chat_id TEXT NOT NULL,
  report_date DATE NOT NULL,
  source_time BIGINT NOT NULL,
  source_order BIGINT NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  snapshot JSONB NOT NULL,
  reports JSONB NOT NULL,
  PRIMARY KEY (chat_id, report_date)
);

-- Pesan disiapkan sekali per Telegram update, lalu dilanjutkan saat webhook diulang.
CREATE TABLE IF NOT EXISTS telegram_jobs (
  update_id BIGINT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  messages JSONB NOT NULL,
  delivered INTEGER NOT NULL DEFAULT 0,
  lease_owner TEXT,
  lease_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Terpisah dari UNSPEC; H-1 VALINS berasal dari kolom M/Y dalam Sheet1 Excel.
CREATE TABLE IF NOT EXISTS valins_snapshots (
  chat_id TEXT NOT NULL,
  report_date DATE NOT NULL,
  source_time BIGINT NOT NULL,
  source_order BIGINT NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  snapshot JSONB NOT NULL,
  PRIMARY KEY (chat_id, report_date)
);

-- Pilihan menu milik setiap pengguna; anggota grup tidak saling mengganti pilihan.
CREATE TABLE IF NOT EXISTS report_preferences (
  chat_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  thread_id BIGINT NOT NULL DEFAULT 0,
  report_type TEXT NOT NULL CHECK (report_type IN ('unspec', 'valins_visit', 'valins_dc', 'valins_all')),
  scope TEXT CHECK (scope IN ('PARE-PARE', 'BONE', 'KENDARI', 'MAKASSAR', 'SEMUA')),
  upload_date DATE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (chat_id, user_id, thread_id)
);

ALTER TABLE report_preferences ADD COLUMN IF NOT EXISTS upload_date DATE;

-- Kegagalan permanen tetap tercatat, tetapi tidak menahan antrean update Telegram.
ALTER TABLE telegram_jobs ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ;
ALTER TABLE telegram_jobs ADD COLUMN IF NOT EXISTS last_error_code INTEGER;
ALTER TABLE telegram_jobs ADD COLUMN IF NOT EXISTS failure_reason TEXT;

-- Acuan awal UNSPEC global dari API; hari operasional 08.00–07.59 WITA.
CREATE TABLE IF NOT EXISTS unspec_opening_balances (
  report_date DATE PRIMARY KEY,
  captured_at TIMESTAMPTZ NOT NULL,
  baseline JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((captured_at AT TIME ZONE 'UTC')::date = report_date)
);
