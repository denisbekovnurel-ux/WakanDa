import { Inject, Injectable } from '@nestjs/common';
import { StateService } from '../state/state.service';
import { logger } from '../observability/logger';
import {
  buildCoachPrompt,
  buildCoachSummary,
  localCoachAdvice,
  normalizeCoachDate,
  sanitizeCoachQuestion,
} from './ai.util';

export type AiCoachInput = {
  question?: unknown;
  today?: unknown;
};

export type AiCoachResult = {
  text: string;
  source: 'ai' | 'local';
  model: string | null;
};

type ChatResponse = {
  choices?: Array<{ message?: { content?: unknown } }>;
};

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_TIMEOUT_MS = 20_000;

@Injectable()
export class AiService {
  private readonly state: StateService;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly enabled: boolean;

  constructor(@Inject(StateService) state: StateService) {
    this.state = state;
    const customBase = (process.env.WAKANDA_AI_BASE_URL || '').trim();
    this.baseUrl = (customBase || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.apiKey = (process.env.WAKANDA_AI_API_KEY || process.env.OPENAI_API_KEY || '').trim();
    this.model = (process.env.WAKANDA_AI_MODEL || DEFAULT_MODEL).trim();
    const timeout = Number(process.env.WAKANDA_AI_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
    this.timeoutMs = Number.isFinite(timeout) && timeout >= 1_000 && timeout <= 120_000 ? timeout : DEFAULT_TIMEOUT_MS;
    // Без ключа работает только локальный разбор. Свой base URL (например,
    // Ollama) разрешаем и без ключа — тогда Authorization не отправляется.
    this.enabled = Boolean(this.model && (this.apiKey || customBase));
  }

  status() {
    return { configured: this.enabled, model: this.enabled ? this.model : null };
  }

  async coach(userId: string, input: AiCoachInput): Promise<AiCoachResult> {
    const state = this.state.loadForUser(userId);
    const today = normalizeCoachDate(input?.today);
    const question = sanitizeCoachQuestion(input?.question);
    const summary = buildCoachSummary(state, today);

    if (!this.enabled) {
      return { text: localCoachAdvice(summary), source: 'local', model: null };
    }

    try {
      const prompt = buildCoachPrompt(summary, question);
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user },
          ],
          temperature: 0.6,
          max_tokens: 450,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const data = (await response.json().catch(() => null)) as ChatResponse | null;
      const content = data?.choices?.[0]?.message?.content;
      if (!response.ok || typeof content !== 'string' || !content.trim()) {
        throw new Error(`AI provider returned ${response.status} or an empty answer`);
      }
      return { text: content.trim().slice(0, 5_000), source: 'ai', model: this.model };
    } catch (error) {
      // Ключ и содержимое состояния в лог не попадают. Пользователь всё равно
      // получает полезный локальный разбор вместо ошибки.
      logger.warn({ err: error, model: this.model }, 'ai coach request failed; using local fallback');
      return { text: localCoachAdvice(summary), source: 'local', model: null };
    }
  }
}
