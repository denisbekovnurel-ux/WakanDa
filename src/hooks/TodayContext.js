import { createContext, useContext } from 'react';

/**
 * Одна «сегодняшняя дата» на всё приложение: значение задаёт TodayProvider,
 * а компоненты читают его без пропсов.
 */
export const TodayContext = createContext(null);

export function useToday() {
  const context = useContext(TodayContext);
  if (!context) throw new Error('useToday должен вызываться внутри TodayProvider');
  return context;
}
