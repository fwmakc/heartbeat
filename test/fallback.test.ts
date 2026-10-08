/** Фолбэк-оркестратор: идём по цепочке до первой успешной доставки. */

import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { SendMessage } from '../src/application/useCases.js';
import { ChannelError } from '../src/adapters/channels/base.js';
import { Channel, MessageStatus, AttemptStatus } from '../src/domain/models.js';
import {
  FakeAttemptRepository,
  FakeChannel,
  FakeMessageRepository,
} from './fakes.js';

describe('SendMessage fallback', () => {
  it('первый канал успешен — цепочка останавливается', async () => {
    const telegram = new FakeChannel('telegram');
    const useCase = new SendMessage(
      new Map([[Channel.Telegram, telegram]]),
      new FakeMessageRepository(),
      new FakeAttemptRepository(),
    );
    const report = await useCase.execute(randomUUID(), '@chat', 'привет', [
      Channel.Telegram,
      Channel.Sms,
    ]);
    expect(report.status).toBe(MessageStatus.Delivered);
    expect(report.deliveredVia).toBe(Channel.Telegram);
  });

  it('фолбэк на второй канал после retryable-ошибки', async () => {
    const telegram = new FakeChannel('telegram', new ChannelError('queue lost'));
    const max = new FakeChannel('max');
    const useCase = new SendMessage(
      new Map([
        [Channel.Telegram, telegram],
        [Channel.Max, max],
      ]),
      new FakeMessageRepository(),
      new FakeAttemptRepository(),
    );
    const report = await useCase.execute(randomUUID(), '+79990001122', 'заказ', [
      Channel.Telegram,
      Channel.Max,
    ]);
    expect(report.deliveredVia).toBe(Channel.Max);
    expect(telegram.calls).toHaveLength(1);
  });

  it('все каналы упали — сообщение failed, попытки записаны', async () => {
    const telegram = new FakeChannel('telegram', new ChannelError('down'));
    const max = new FakeChannel('max', new ChannelError('bad recipient', false));
    const attemptsRepo = new FakeAttemptRepository();
    const useCase = new SendMessage(
      new Map([
        [Channel.Telegram, telegram],
        [Channel.Max, max],
      ]),
      new FakeMessageRepository(),
      attemptsRepo,
    );
    const report = await useCase.execute(randomUUID(), 'x', 'текст', [
      Channel.Telegram,
      Channel.Max,
    ]);
    expect(report.status).toBe(MessageStatus.Failed);
    expect(report.deliveredVia).toBeNull();
    expect(attemptsRepo.items.map((a) => a.channel)).toEqual([Channel.Telegram, Channel.Max]);
    expect(attemptsRepo.items.map((a) => a.status)).toEqual([
      AttemptStatus.RetryableError,
      AttemptStatus.PermanentError,
    ]);
  });

  it('незарегистрированный канал пропускается', async () => {
    const useCase = new SendMessage(
      new Map(),
      new FakeMessageRepository(),
      new FakeAttemptRepository(),
    );
    const report = await useCase.execute(randomUUID(), 'x', 'текст', [Channel.Telegram]);
    expect(report.status).toBe(MessageStatus.Failed);
  });
});
