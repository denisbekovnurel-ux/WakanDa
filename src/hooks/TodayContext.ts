import { createContext, useContext } from 'react';
import type { TodayContextValue } from '../types';

/**
 * Одна «сегодняшняя дата» на всё приложение: значение задаёт TodayProvider,
 * а компоненты читают его без пропсов.
 */
export const TodayContext = createContext<TodayContextValue | null>(null);

export function useToday(): TodayContextValue {
  const context = useContext(TodayContext);
  if (!context) throw new Error('useToday должен вызываться внутри TodayProvider');
  return context;
}
