export const BOT_COMMANDS = ['start', 'menu', 'help', 'unspec', 'valins', 'valins_visit', 'valins_dc', 'report'] as const;
export type BotCommand = `/${(typeof BOT_COMMANDS)[number]}`;
export interface ParsedBotCommand { command: BotCommand; target?: string; args: string[] }

export function parseBotCommand(text: string | undefined): ParsedBotCommand | null {
  if (!text) return null;
  const match = /^\/([a-z_]+)(?:@([a-z0-9_]+))?(?=\s|$)/i.exec(text.trim());
  if (!match || !BOT_COMMANDS.includes(match[1]!.toLowerCase() as (typeof BOT_COMMANDS)[number])) return null;
  const rest = text.trim().slice(match[0].length).trim();
  return { command: `/${match[1]!.toLowerCase()}` as BotCommand, ...(match[2] ? { target: match[2].toLowerCase() } : {}), args: rest ? rest.split(/\s+/) : [] };
}

export function reportDocumentKind(filename: string | undefined): 'csv' | 'xlsx' | null {
  const name = filename?.toLowerCase() || '';
  return name.endsWith('.csv') ? 'csv' : name.endsWith('.xlsx') ? 'xlsx' : null;
}
