import { toDateKey } from './calc';

export function createTask(title) {
  return {
    id: crypto.randomUUID(),
    title,
    history: {},
    createdAt: toDateKey(new Date()),
  };
}
