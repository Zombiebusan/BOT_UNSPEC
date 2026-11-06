export interface Config {
  token: string;
  webhookSecret: string;
  databaseUrl: string;
  unspecApiUrl?: string;
  unspecApiToken?: string;
}

export function getConfig(): Config {
  const required = (key: string): string => {
    const value = process.env[key]?.trim();
    if (!value) throw new Error(`Environment variable ${key} belum diatur.`);
    return value;
  };
  const webhookSecret = required('TELEGRAM_WEBHOOK_SECRET');
  if (!/^[A-Za-z0-9_-]{16,256}$/.test(webhookSecret)) {
    throw new Error('TELEGRAM_WEBHOOK_SECRET harus 16–256 karakter huruf, angka, underscore, atau strip.');
  }
  return {
    token: required('TELEGRAM_BOT_TOKEN'), webhookSecret,
    databaseUrl: required('DATABASE_URL'),
    unspecApiUrl: process.env.UNSPEC_API_URL?.trim(),
    unspecApiToken: process.env.UNSPEC_API_TOKEN?.trim()
  };
}
