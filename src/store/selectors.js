/**
 * Производные выборки из состояния приложения.
 *
 * Нужны, чтобы App, MonthGrid и будущие экраны считали «активные привычки»
 * одинаково: одна формула в одном месте вместо копий `filter(task => !task.archived)`.
 */
export function selectActiveHabits(state) {
  return state.tasks.filter((task) => !task.archived);
}
