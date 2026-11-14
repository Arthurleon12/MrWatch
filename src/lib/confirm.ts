/**
 * Plain confirmations for the taps that erase history. Untracking a show
 * deletes its watched episodes and ratings — fine when there are none,
 * worth one question when there are.
 */
export function confirmUntrack(showName: string, watchedCount: number): boolean {
  if (watchedCount === 0) return true
  return window.confirm(
    `Stop tracking ${showName}? This erases ${watchedCount} watched episode${
      watchedCount === 1 ? '' : 's'
    } and your ratings for them.`,
  )
}
