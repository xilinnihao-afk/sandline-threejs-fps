export const MAX_TEAM_SIZE = 10;
export const BOT_PRESETS = [3, 5, 8, 10] as const;
export const BOT_STORAGE_KEY = 'sandline-bots-v1';
export interface BotCounts { teammates: number; enemies: number }
export const DEFAULT_BOT_COUNTS: Readonly<BotCounts> = { teammates: 2, enemies: 3 };

// The player takes one blue slot; all red slots are bots.
export function validBotCounts(teammates: number, enemies: number): boolean {
  return Number.isInteger(teammates) && teammates >= 0 && teammates < MAX_TEAM_SIZE
    && Number.isInteger(enemies) && enemies >= 1 && enemies <= MAX_TEAM_SIZE;
}

export function parseBotCounts(saved: string | null): BotCounts {
  try {
    const value: unknown = JSON.parse(saved ?? 'null');
    if (value && typeof value === 'object' && 'teammates' in value && 'enemies' in value
      && typeof value.teammates === 'number' && typeof value.enemies === 'number'
      && validBotCounts(value.teammates, value.enemies)) {
      return { teammates: value.teammates, enemies: value.enemies };
    }
  } catch { /* A damaged saved setting must not prevent startup. */ }
  return { ...DEFAULT_BOT_COUNTS };
}
