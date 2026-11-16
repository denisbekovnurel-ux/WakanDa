// Канвас-карточка прогресса за месяц: картинкой удобно делиться в соцсетях.
// Рисуем без внешних зависимостей — только Canvas 2D.

import { translate } from '../i18n';

const WEEKDAY = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

export interface ProgressCardDay {
  date: Date;
  percent: number | null;
}

export interface ProgressCardOptions {
  monthLabel: string;
  percent: number;
  done: number;
  expected: number;
  days?: ProgressCardDay[];
  streakHabit?: { title: string; current: number } | null;
}

/** Цвет ячейки по доле выполнения (совпадает с тепловой картой в приложении). */
function cellColor(percent: number | null | undefined): string {
  if (percent === null || percent === undefined) return '#241d29';
  if (percent >= 1) return '#e34d68';
  if (percent > 0.5) return '#a62f4b';
  if (percent > 0) return '#5a2233';
  return '#1a161e';
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

/**
 * Рисует карточку месяца и возвращает PNG-изображение.
 * days: Array<{ date: Date, percent: number|null }>
 */
export function createProgressCard({ monthLabel, percent, done, expected, days = [], streakHabit }: ProgressCardOptions): Promise<Blob> {
  const size = 1080;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error(translate('Canvas недоступен')));

  // Фон
  const bg = ctx.createLinearGradient(0, 0, size, size);
  bg.addColorStop(0, '#120d16');
  bg.addColorStop(0.55, '#0d0a11');
  bg.addColorStop(1, '#1c1019');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);

  const glow = ctx.createRadialGradient(size * 0.82, size * 0.1, 40, size * 0.82, size * 0.1, 520);
  glow.addColorStop(0, 'rgba(227,77,104,0.28)');
  glow.addColorStop(1, 'rgba(227,77,104,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);

  // Бренд
  ctx.fillStyle = '#ee7285';
  roundRect(ctx, 76, 78, 14, 44, 7);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 46px Manrope, "DM Sans", sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText('WakanDa', 108, 76);
  ctx.fillStyle = '#a393bd';
  ctx.font = '600 26px "DM Sans", sans-serif';
  ctx.fillText(translate('WakanDa · дисциплина в цифрах'), 110, 130);

  // Месяц
  ctx.textAlign = 'right';
  ctx.fillStyle = '#d4cad8';
  ctx.font = '700 40px "DM Sans", sans-serif';
  ctx.fillText(monthLabel, size - 76, 84);
  ctx.textAlign = 'left';

  // Большой процент
  ctx.fillStyle = '#ff8a99';
  ctx.font = '800 200px Manrope, "DM Sans", sans-serif';
  ctx.fillText(`${percent}%`, 72, 196);
  ctx.fillStyle = '#b8aec0';
  ctx.font = '600 32px "DM Sans", sans-serif';
  ctx.fillText(translate('выполнено {done} из {expected}', { done, expected }), 82, 420);

  // Календарь месяца. Размер ячейки считаем от числа реальных недель (4–6),
  // иначе сетка уезжала за нижний край карточки: в октябре 2026 подвал
  // перекрывался, а последние дни обрезались.
  const cols = 7;
  const gap = 12;
  const gridTop = 500;
  const footerY = size - 60;
  const availableHeight = footerY - 24 - gridTop;
  const firstDay = days[0];
  const offset = firstDay ? firstDay.date.getDay() : 0;
  const rows = Math.max(1, Math.ceil((offset + days.length) / cols));
  const cell = Math.floor((availableHeight - gap * (rows - 1)) / rows);
  const gridWidth = cols * cell + gap * (cols - 1);
  const gridLeft = Math.round((size - gridWidth) / 2);

  // Заголовки дней недели
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '700 24px "DM Sans", sans-serif';
  for (let col = 0; col < cols; col++) {
    ctx.fillStyle = '#7d7488';
    ctx.fillText(translate(WEEKDAY[col]).toUpperCase(), gridLeft + col * (cell + gap) + cell / 2, gridTop - 26);
  }

  // Первый день месяца определяет смещение в сетке (неделя от воскресенья).
  let index = offset;
  for (const day of days) {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const x = gridLeft + col * (cell + gap);
    const y = gridTop + row * (cell + gap);
    ctx.fillStyle = day.percent === null ? '#241d29' : cellColor(day.percent);
    roundRect(ctx, x, y, cell, cell, 12);
    ctx.fill();
    ctx.fillStyle = day.percent !== null && day.percent >= 1 ? '#ffffff' : '#8d8494';
    ctx.font = '700 22px "DM Sans", sans-serif';
    ctx.fillText(String(day.date.getDate()), x + cell / 2, y + cell / 2);
    index += 1;
  }

  // Подвал
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  if (streakHabit) {
    ctx.fillStyle = '#c9bccf';
    ctx.font = '600 26px "DM Sans", sans-serif';
    ctx.fillText(`${streakHabit.title} · ${translate('серия {count} дн.', { count: streakHabit.current })}`, 80, footerY);
  }
  ctx.textAlign = 'right';
  ctx.fillStyle = '#7d7488';
  ctx.font = '600 24px "DM Sans", sans-serif';
  ctx.fillText(translate('WakanDa · привычки'), size - 80, footerY);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error(translate('Не удалось собрать картинку')))), 'image/png');
  });
}

interface ShareNavigator {
  canShare?: (data: { files: File[] }) => boolean;
  share?: (data: { files: File[]; title: string; text: string }) => Promise<void>;
}

/**
 * Отдаёт картинку наружу: если браузер умеет делиться файлами (мобильные PWA) —
 * открывает системное меню «Поделиться», иначе скачивает файл.
 */
export async function shareOrDownload(blob: Blob, filename: string, text: string): Promise<'shared' | 'cancelled' | 'downloaded'> {
  const file = new File([blob], filename, { type: 'image/png' });
  const shareNavigator = navigator as unknown as ShareNavigator;
  const canShareFiles = (() => {
    try {
      return typeof shareNavigator.canShare === 'function'
        && typeof shareNavigator.share === 'function'
        && shareNavigator.canShare({ files: [file] });
    } catch {
      return false;
    }
  })();

  if (canShareFiles && shareNavigator.share) {
    try {
      await shareNavigator.share({ files: [file], title: translate('Мой прогресс WakanDa'), text });
      return 'shared';
    } catch (error) {
      // Пользователь просто закрыл меню — не считаем это ошибкой.
      if (error instanceof Error && error.name === 'AbortError') return 'cancelled';
    }
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  return 'downloaded';
}
