/** Calls `fn` once `ms` have passed without another call, with the latest arguments. */
export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  ms: number,
): (...args: A) => void {
  let handle: ReturnType<typeof setTimeout> | undefined;
  return (...args: A) => {
    clearTimeout(handle);
    handle = setTimeout(() => fn(...args), ms);
  };
}
