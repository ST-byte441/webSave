export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createLimiter(max) {
  let active = 0;
  const waiting = [];

  const next = () => {
    if (active >= max || waiting.length === 0) return;
    active++;
    const { task, resolve, reject } = waiting.shift();
    task().then(resolve, reject).finally(() => {
      active--;
      next();
    });
  };

  return (task) => new Promise((resolve, reject) => {
    waiting.push({ task, resolve, reject });
    next();
  });
}
