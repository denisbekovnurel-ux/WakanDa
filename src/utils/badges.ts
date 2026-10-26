import type { AppState, Badge } from '../types';
import { getBestStreak, getStreak } from './calc';
import { translate } from '../i18n';

const FULL_SCHEDULE = [0, 1, 2, 3, 4, 5, 6];

/**
 * Награды: вычисляются из данных, не хранятся отдельно.
 * unlocked === true, когда условие выполнено на текущий момент.
 */
export function getBadges({ tasks, oneOffTasks }: Pick<AppState, 'tasks' | 'oneOffTasks'>): Badge[] {
  const activeHabits = tasks.filter((task) => !task.archived);
  const allDoneCounts = tasks.flatMap((task) => Object.values(task.history || {}).filter((value) => value === 'done').length);
  const totalDone = allDoneCounts.reduce((sum, count) => sum + count, 0);
  const bestEver = Math.max(
    0,
    ...tasks.map((task) =>
      getBestStreak(task.history || {}, task.schedule || FULL_SCHEDULE, task.pauseRanges || []),
    ),
  );
  const currentBest = Math.max(
    0,
    ...activeHabits.map((task) =>
      getStreak(task.history || {}, task.schedule || FULL_SCHEDULE, new Date(), task.pauseRanges || []),
    ),
  );
  const doneOneOffs = oneOffTasks.filter((task) => task.done).length;

  return [
    { id: 'first', icon: '✦', title: 'Первый шаг', description: 'Отметь первую привычку выполненной', unlocked: totalDone >= 1, progress: `${Math.min(1, totalDone)}/1` },
    { id: 'week', icon: '⚔', title: '7 дней подряд', description: 'Серия выполнения за 7 дней без сбоев', unlocked: bestEver >= 7, progress: `${Math.min(7, bestEver)}/7 ${translate('дн.')}` },
    { id: 'streak30', icon: '◎', title: '30 дней дисциплины', description: 'Серия в 30 дней на одной привычке', unlocked: bestEver >= 30, progress: `${Math.min(30, bestEver)}/30 ${translate('дн.')}` },
    { id: 'current7', icon: '🔥', title: 'Неделя в ударе', description: 'Держи серию от 7 дней прямо сейчас', unlocked: currentBest >= 7, progress: `${Math.min(7, currentBest)}/7 ${translate('дн.')}` },
    { id: 'ten-tasks', icon: '✓', title: 'Закрывающий', description: 'Закрой 10 разовых задач', unlocked: doneOneOffs >= 10, progress: `${Math.min(10, doneOneOffs)}/10` },
  ];
}
