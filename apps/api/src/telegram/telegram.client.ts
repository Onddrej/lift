/**
 * The handful of Bot API calls the bot makes, over plain `fetch`.
 *
 * No SDK: the bot needs six methods, and every Telegram library brings its own
 * update loop, middleware system and opinions about how a process should be
 * structured, all of which would sit beside Nest's.
 */

export interface TelegramUser {
  id: number;
  username?: string;
  first_name?: string;
}

export interface TelegramMessage {
  message_id: number;
  chat: { id: number; type: string };
  from?: TelegramUser;
  text?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

/** A failed call, with the status Telegram gave it. 403 means the user blocked the bot. */
export class TelegramError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** The bottom-of-chat buttons, so the common asks are one tap. */
export const MENU_KEYBOARD = {
  keyboard: [[{ text: 'This week' }, { text: 'Report' }], [{ text: 'Motivate me' }, { text: 'Streak' }]],
  resize_keyboard: true,
  is_persistent: true,
};

export class TelegramClient {
  private readonly base: string;

  constructor(token: string) {
    // Overridable only so a test can stand a fake Bot API up locally.
    const root = process.env.TELEGRAM_API_URL?.trim() || 'https://api.telegram.org';
    this.base = `${root}/bot${token}`;
  }

  async getMe(): Promise<TelegramUser> {
    return this.call('getMe', {});
  }

  async deleteWebhook(): Promise<void> {
    await this.call('deleteWebhook', { drop_pending_updates: false });
  }

  /** Long-polls for up to `timeout` seconds. Aborting the signal ends the wait. */
  async getUpdates(offset: number, timeout: number, signal: AbortSignal): Promise<TelegramUpdate[]> {
    return this.call('getUpdates', { offset, timeout, allowed_updates: ['message'] }, signal);
  }

  async sendMessage(chatId: string | number, html: string, withMenu = true): Promise<void> {
    await this.call('sendMessage', {
      chat_id: chatId,
      text: html,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...(withMenu ? { reply_markup: MENU_KEYBOARD } : {}),
    });
  }

  async sendChatAction(chatId: string | number, action: 'typing' | 'upload_document'): Promise<void> {
    await this.call('sendChatAction', { chat_id: chatId, action }).catch(() => {});
  }

  async sendDocument(chatId: string | number, bytes: Uint8Array, fileName: string, captionHtml: string): Promise<void> {
    const form = new FormData();
    form.set('chat_id', String(chatId));
    form.set('caption', captionHtml);
    form.set('parse_mode', 'HTML');
    form.set('reply_markup', JSON.stringify(MENU_KEYBOARD));
    form.set('document', new Blob([bytes], { type: 'application/pdf' }), fileName);

    const response = await fetch(`${this.base}/sendDocument`, { method: 'POST', body: form });
    await this.read(response);
  }

  private async call<T>(method: string, body: object, signal?: AbortSignal): Promise<T> {
    const response = await fetch(`${this.base}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
    return this.read<T>(response);
  }

  private async read<T>(response: Response): Promise<T> {
    const payload = (await response.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string } | null;
    if (!response.ok || !payload?.ok) {
      throw new TelegramError(response.status, payload?.description ?? `Telegram answered ${response.status}`);
    }
    return payload.result as T;
  }
}

/** Telegram's HTML mode needs these three escaped, and only these. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
