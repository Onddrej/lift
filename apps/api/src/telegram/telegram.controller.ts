import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';

import { AuthGuard, type AuthedRequest } from '../auth/auth.guard.js';

import { TelegramService, type TelegramStatus } from './telegram.service.js';

/** A zone `Intl` actually knows, so a typo cannot stall every tick for one user. */
const timeZone = z.string().refine((value) => {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}, 'Unknown time zone.');

const settingsSchema = z.object({
  timeZone,
  unit: z.enum(['kg', 'lb']),
  dailyTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM.'),
  dailyEnabled: z.boolean(),
  weeklyEnabled: z.boolean(),
});

const testSchema = z.object({ kind: z.enum(['daily', 'report']) });

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new BadRequestException(parsed.error.issues.map((issue) => issue.message).join('; '));
  return parsed.data;
}

/** The app's side of the Telegram bot. Every route is the signed-in user's own link. */
@Controller('telegram')
@UseGuards(AuthGuard)
export class TelegramController {
  constructor(private readonly telegram: TelegramService) {}

  @Get()
  status(@Req() request: AuthedRequest): Promise<TelegramStatus> {
    return this.telegram.status(request.userId);
  }

  @Post('connect')
  connect(@Req() request: AuthedRequest, @Body() body: unknown): Promise<{ url: string }> {
    return this.telegram.connect(request.userId, parse(settingsSchema, body));
  }

  @Patch()
  update(@Req() request: AuthedRequest, @Body() body: unknown): Promise<TelegramStatus> {
    return this.telegram.update(request.userId, parse(settingsSchema.partial(), body));
  }

  @Post('test')
  @HttpCode(204)
  async test(@Req() request: AuthedRequest, @Body() body: unknown): Promise<void> {
    await this.telegram.test(request.userId, parse(testSchema, body).kind);
  }

  @Delete()
  @HttpCode(204)
  async disconnect(@Req() request: AuthedRequest): Promise<void> {
    await this.telegram.disconnect(request.userId);
  }
}
