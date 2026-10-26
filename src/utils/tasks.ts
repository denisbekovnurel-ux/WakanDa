import type { Habit } from '../types';
import { toDateKey } from './calc';

export function createTask(title: string): Habit {
  return {
    id: crypto.randomUUID(),
    title,
    history: {},
    createdAt: toDateKey(new Date()),
    archived: false,
    pauseRanges: [],
  };
}
