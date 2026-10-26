export class Progress {
  private active = new Map<number | string, { step: string; started: number }>();
  private timer?: NodeJS.Timeout;
  private readonly isTTY: boolean;
  private rendered = false;

  constructor(enabled: boolean) {
    this.isTTY = enabled && Boolean(process.stderr.isTTY);
    if (this.isTTY) {
      this.timer = setInterval(() => this.render(), 1000);
      this.timer.unref();
    }
  }

  step(major: number | string, step: string): void {
    this.active.set(major, { step, started: Date.now() });
    if (this.isTTY) this.render();
  }

  done(major: number | string): void {
    this.active.delete(major);
    if (this.isTTY) this.render();
  }

  log(line: string): void {
    if (this.isTTY) {
      this.clear();
      process.stderr.write(`${line}\n`);
      this.render();
    } else {
      process.stderr.write(`${line}\n`);
    }
  }

  private render(): void {
    if (!this.isTTY) return;
    if (this.active.size === 0) {
      this.clear();
      return;
    }
    const parts: string[] = [];
    const now = Date.now();
    for (const [major, item] of this.active) {
      const elapsed = Math.floor((now - item.started) / 1000);
      parts.push(`Angular ${major}: ${item.step} (${elapsed}s)`);
    }
    const text = `[ng-matrix] ${parts.join(' | ')}`;
    process.stderr.write(`\r\x1b[K${text}`);
    this.rendered = true;
  }

  private clear(): void {
    if (this.rendered) {
      process.stderr.write('\r\x1b[K');
      this.rendered = false;
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    if (this.isTTY) {
      this.clear();
    }
  }
}
