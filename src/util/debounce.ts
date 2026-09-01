// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function debounce<F extends (...args: any[]) => void>(
  fn: F,
  ms: number,
): F & { cancel(): void } {
  let handle: ReturnType<typeof setTimeout> | undefined;
  const wrapped = ((...args: Parameters<F>) => {
    if (handle) clearTimeout(handle);
    handle = setTimeout(() => fn(...args), ms);
  }) as F & { cancel(): void };
  wrapped.cancel = () => {
    if (handle) clearTimeout(handle);
    handle = undefined;
  };
  return wrapped;
}
