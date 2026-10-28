// One CPU-heavy preview task at a time; foreground images precede speculative work.
export class PreviewWorkQueue {
  constructor() { this.waiting = []; this.active = null; }

  run(callback, { signal, priority = 0 } = {}) {
    signal?.throwIfAborted();
    if (this.waiting.length >= 64) return Promise.reject(new Error('Preview queue is full'));
    return new Promise((resolve, reject) => {
      const controller = new AbortController();
      const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
      const task = { callback, signal: combined, controller, priority, resolve, reject };
      task.abort = () => {
        const index = this.waiting.indexOf(task);
        if (index !== -1) {
          this.waiting.splice(index, 1);
          combined.removeEventListener('abort', task.abort);
          reject(combined.reason);
        }
      };
      combined.addEventListener('abort', task.abort, { once: true });
      this.waiting.push(task);
      this.waiting.sort((a, b) => b.priority - a.priority);
      this.next();
    });
  }

  next() {
    if (this.active || !this.waiting.length) return;
    const task = this.waiting.shift();
    this.active = task;
    Promise.resolve().then(() => {
      task.signal.throwIfAborted();
      return task.callback(task.signal);
    }).then(task.resolve, task.reject).finally(() => {
      task.signal.removeEventListener('abort', task.abort);
      this.active = null;
      this.next();
    });
  }

  cancelAll() {
    for (const task of [...this.waiting, this.active].filter(Boolean)) task.controller.abort();
  }
}
