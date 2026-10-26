import { describe, expect, it } from 'vitest';
import {
  adminPasswordSchema,
  firstError,
  habitFormSchema,
  loginSchema,
  oneOffFormSchema,
  passwordChangeSchema,
  registrationSchema,
  USERNAME_RE,
} from './schemas';

describe('loginSchema', () => {
  it('обрезает пробелы вокруг логина', () => {
    const result = loginSchema.safeParse({ username: '  waka_admin  ', password: 'secret1' });

    expect(result.success).toBe(true);
    expect(result.data.username).toBe('waka_admin');
  });

  it('требует логин и пароль', () => {
    expect(firstError(loginSchema.safeParse({ username: '   ', password: 'secret1' }))).toBe('Введите логин');
    expect(firstError(loginSchema.safeParse({ username: 'waka_admin', password: '' }))).toBe('Введите пароль');
  });

  it('не пропускает слишком длинный пароль', () => {
    const result = loginSchema.safeParse({ username: 'waka_admin', password: 'x'.repeat(201) });

    expect(firstError(result)).toBe('Пароль слишком длинный');
  });
});

describe('registrationSchema', () => {
  it('принимает юникод, цифры, точку, дефис и подчёркивание', () => {
    for (const username of ['Иван_01', 'waka.admin', 'waka-admin', 'абв']) {
      expect(registrationSchema.safeParse({ username, password: 'secret1', confirm: 'secret1' }).success).toBe(true);
    }
  });

  it('требует логин от 3 до 24 символов', () => {
    const message = 'Логин: 3–24 символа, буквы, цифры, точка, дефис или подчёркивание';

    expect(firstError(registrationSchema.safeParse({ username: 'ab', password: 'secret1', confirm: 'secret1' }))).toBe(message);
    expect(firstError(registrationSchema.safeParse({ username: 'a'.repeat(25), password: 'secret1', confirm: 'secret1' }))).toBe(message);
  });

  it('запрещает пробелы и посторонние символы в логине', () => {
    for (const username of ['waka admin', 'waka@admin', 'waka/admin', 'вака!']) {
      expect(registrationSchema.safeParse({ username, password: 'secret1', confirm: 'secret1' }).success).toBe(false);
    }
  });

  it('требует пароль от 6 символов', () => {
    const result = registrationSchema.safeParse({ username: 'waka_admin', password: '12345', confirm: '12345' });

    expect(firstError(result)).toBe('Пароль должен быть не короче 6 символов');
  });

  it('ловит несовпадение паролей и указывает на поле повтора', () => {
    const result = registrationSchema.safeParse({ username: 'waka_admin', password: 'secret1', confirm: 'secret2' });

    expect(result.success).toBe(false);
    expect(result.error.issues[0].path).toEqual(['confirm']);
    expect(firstError(result)).toBe('Пароли не совпадают');
  });

  it('совпадает с серверным правилом логина', () => {
    // REGEX копирует server/src/auth/auth.service.ts — проверяем границы.
    expect(USERNAME_RE.test('абв')).toBe(true);
    expect(USERNAME_RE.test('ab')).toBe(false);
    expect(USERNAME_RE.test('a'.repeat(24))).toBe(true);
    expect(USERNAME_RE.test('a'.repeat(25))).toBe(false);
    expect(USERNAME_RE.test('waka admin')).toBe(false);
  });
});

describe('passwordChangeSchema', () => {
  it('требует текущий пароль', () => {
    expect(firstError(passwordChangeSchema.safeParse({ currentPassword: '', newPassword: 'secret1', confirmPassword: 'secret1' }))).toBe('Введите текущий пароль.');
  });

  it('требует новый пароль от 6 символов', () => {
    expect(firstError(passwordChangeSchema.safeParse({ currentPassword: 'old1', newPassword: '12345', confirmPassword: '12345' }))).toBe('Новый пароль должен быть не короче 6 символов.');
  });

  it('ловит несовпадение и пропускает корректный ввод', () => {
    expect(firstError(passwordChangeSchema.safeParse({ currentPassword: 'old1', newPassword: 'secret1', confirmPassword: 'secret2' }))).toBe('Пароли не совпадают.');

    const ok = passwordChangeSchema.safeParse({ currentPassword: 'old1', newPassword: 'secret1', confirmPassword: 'secret1' });
    expect(ok.success).toBe(true);
    expect(ok.data.newPassword).toBe('secret1');
  });
});

describe('adminPasswordSchema', () => {
  it('держит границы 6..200', () => {
    expect(adminPasswordSchema.safeParse('12345').success).toBe(false);
    expect(adminPasswordSchema.safeParse('123456').success).toBe(true);
    expect(adminPasswordSchema.safeParse('x'.repeat(201)).success).toBe(false);
  });
});

describe('habitFormSchema', () => {
  it('обрезает название и принимает выбранные дни', () => {
    const result = habitFormSchema.safeParse({ title: '  Утренняя зарядка  ', schedule: [1, 3, 5] });

    expect(result.success).toBe(true);
    expect(result.data.title).toBe('Утренняя зарядка');
  });

  it('не принимает пустое название', () => {
    expect(firstError(habitFormSchema.safeParse({ title: '   ', schedule: [1] }))).toBe('Укажи название привычки.');
  });

  it('держит границу в 80 символов', () => {
    expect(habitFormSchema.safeParse({ title: 'я'.repeat(80), schedule: [1] }).success).toBe(true);
    expect(firstError(habitFormSchema.safeParse({ title: 'я'.repeat(81), schedule: [1] }))).toBe('Название привычки — не больше 80 символов.');
  });

  it('требует хотя бы один день недели', () => {
    expect(firstError(habitFormSchema.safeParse({ title: 'Привычка', schedule: [] }))).toBe('Выбери хотя бы один день выполнения.');
  });

  it('не принимает дни вне 0..6 и нецелые значения', () => {
    for (const schedule of [[7], [-1], [1.5], ['1']]) {
      expect(habitFormSchema.safeParse({ title: 'Привычка', schedule }).success).toBe(false);
    }
  });
});

describe('oneOffFormSchema', () => {
  it('обрезает название и принимает пустой срок', () => {
    const result = oneOffFormSchema.safeParse({ title: '  Позвонить в банк  ', deadline: '', priority: 'normal' });

    expect(result.success).toBe(true);
    expect(result.data.title).toBe('Позвонить в банк');
    expect(result.data.deadline).toBe('');
  });

  it('не принимает пустое название и больше 100 символов', () => {
    expect(firstError(oneOffFormSchema.safeParse({ title: '  ', deadline: '', priority: 'normal' }))).toBe('Укажи название задачи.');
    expect(firstError(oneOffFormSchema.safeParse({ title: 'я'.repeat(101), deadline: '', priority: 'normal' }))).toBe('Название задачи — не больше 100 символов.');
    expect(oneOffFormSchema.safeParse({ title: 'я'.repeat(100), deadline: '', priority: 'normal' }).success).toBe(true);
  });

  it('проверяет срок как реальную дату', () => {
    expect(oneOffFormSchema.safeParse({ title: 'Дело', deadline: '2026-02-28', priority: 'low' }).success).toBe(true);
    expect(firstError(oneOffFormSchema.safeParse({ title: 'Дело', deadline: '2026-02-30', priority: 'low' }))).toBe('Срок должен быть реальной датой.');
    expect(firstError(oneOffFormSchema.safeParse({ title: 'Дело', deadline: '28.02.2026', priority: 'low' }))).toBe('Срок должен быть реальной датой.');
  });

  it('знает только три приоритета', () => {
    for (const priority of ['high', 'normal', 'low']) {
      expect(oneOffFormSchema.safeParse({ title: 'Дело', deadline: '', priority }).success).toBe(true);
    }
    expect(oneOffFormSchema.safeParse({ title: 'Дело', deadline: '', priority: 'urgent' }).success).toBe(false);
  });
});

describe('firstError', () => {
  it('возвращает пустую строку для успешной схемы', () => {
    expect(firstError(loginSchema.safeParse({ username: 'waka', password: 'secret1' }))).toBe('');
  });

  it('возвращает только первое сообщение', () => {
    const result = registrationSchema.safeParse({ username: 'a', password: '1', confirm: '2' });

    expect(result.error.issues.length).toBeGreaterThan(1);
    expect(firstError(result)).toBe('Логин: 3–24 символа, буквы, цифры, точка, дефис или подчёркивание');
  });
});
