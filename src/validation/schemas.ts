import { z } from 'zod';
import { isRealDateKey } from '../utils/schema';

/**
 * Схемы форм на zod — одно место, где описаны требования к вводу.
 *
 * Раньше каждая форма проверяла поля вручную, и правила расходились с сервером:
 * логин на клиенте не проверялся вообще, пароль — только в двух местах из трёх.
 * Теперь сообщения и границы заданы здесь, а компоненты только показывают
 * первую ошибку. Сервер остаётся последней линией защиты.
 */

// Копия серверного USERNAME_RE (server/src/auth/auth.service.ts): клиент не
// импортирует серверный TypeScript, поэтому правило продублировано и покрыто тестом.
export const USERNAME_RE = /^[\p{L}\p{N}_.-]{3,24}$/u;
const USERNAME_HINT = 'Логин: 3–24 символа, буквы, цифры, точка, дефис или подчёркивание';
const MAX_PASSWORD_LENGTH = 200;

const trimmed = z.string().trim();

export const loginSchema = z.object({
  username: trimmed.min(1, { message: 'Введите логин' }).max(24, { message: 'Логин слишком длинный' }),
  password: z.string().min(1, { message: 'Введите пароль' }).max(MAX_PASSWORD_LENGTH, { message: 'Пароль слишком длинный' }),
});

export const registrationSchema = z
  .object({
    username: trimmed
      .min(3, { message: USERNAME_HINT })
      .max(24, { message: USERNAME_HINT })
      .regex(USERNAME_RE, { message: USERNAME_HINT }),
    password: z
      .string()
      .min(6, { message: 'Пароль должен быть не короче 6 символов' })
      .max(MAX_PASSWORD_LENGTH, { message: 'Пароль слишком длинный' }),
    confirm: z.string(),
  })
  .refine((data) => data.password === data.confirm, { message: 'Пароли не совпадают', path: ['confirm'] });

export const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1, { message: 'Введите текущий пароль.' }),
    newPassword: z
      .string()
      .min(6, { message: 'Новый пароль должен быть не короче 6 символов.' })
      .max(MAX_PASSWORD_LENGTH, { message: 'Пароль слишком длинный.' }),
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, { message: 'Пароли не совпадают.', path: ['confirmPassword'] });

export const adminPasswordSchema = z
  .string()
  .min(6, { message: 'Пароль должен быть не короче 6 символов.' })
  .max(MAX_PASSWORD_LENGTH, { message: 'Пароль слишком длинный.' });

export const habitFormSchema = z.object({
  title: trimmed
    .min(1, { message: 'Укажи название привычки.' })
    .max(80, { message: 'Название привычки — не больше 80 символов.' }),
  schedule: z
    .array(z.number().int().min(0).max(6))
    .min(1, { message: 'Выбери хотя бы один день выполнения.' }),
});

export const oneOffFormSchema = z.object({
  title: trimmed
    .min(1, { message: 'Укажи название задачи.' })
    .max(100, { message: 'Название задачи — не больше 100 символов.' }),
  deadline: z.string().refine((value) => value === '' || isRealDateKey(value), {
    message: 'Срок должен быть реальной датой.',
  }),
  priority: z.enum(['high', 'normal', 'low']),
});

interface ValidationResultLike {
  success: boolean;
  error?: { issues: Array<{ message?: string }> };
}

/** Первое сообщение об ошибке — в интерфейсе показываем одну строку, а не список. */
export function firstError(result: ValidationResultLike): string {
  if (result.success) return '';
  return result.error?.issues[0]?.message || 'Проверьте введённые данные.';
}
