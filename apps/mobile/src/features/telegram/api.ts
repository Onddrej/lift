/**
 * The app's half of the Telegram bot: asking the server to link, and changing
 * what the bot sends.
 *
 * The bot lives on the server because it has to be awake when the phone is
 * not, and it reads the synced log, so all of this needs a signed-in account.
 * Mirrors `apps/api/src/telegram/telegram.controller.ts`.
 */

import { apiRequest } from '@/features/sync/auth-client';

export interface TelegramSettings {
  timeZone: string;
  unit: 'kg' | 'lb';
  /** "HH:MM", local. */
  dailyTime: string;
  dailyEnabled: boolean;
  weeklyEnabled: boolean;
}

export interface TelegramStatus {
  /** False when the server has no bot token, which hides the feature. */
  available: boolean;
  botUsername: string | null;
  linked: boolean;
  username: string | null;
  settings: TelegramSettings | null;
}

export function getTelegramStatus(): Promise<TelegramStatus> {
  return apiRequest('GET', '/api/telegram');
}

/** Stores the settings and returns the `t.me` link that finishes connecting inside Telegram. */
export function connectTelegram(settings: TelegramSettings): Promise<{ url: string }> {
  return apiRequest('POST', '/api/telegram/connect', settings);
}

export function updateTelegram(settings: Partial<TelegramSettings>): Promise<TelegramStatus> {
  return apiRequest('PATCH', '/api/telegram', settings);
}

export function sendTelegramTest(kind: 'daily' | 'report'): Promise<void> {
  return apiRequest('POST', '/api/telegram/test', { kind });
}

export function disconnectTelegram(): Promise<void> {
  return apiRequest('DELETE', '/api/telegram');
}

/** The phone's zone, which is the one the bot should count "today" and "Monday" in. */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
