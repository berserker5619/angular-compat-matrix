import { Service } from '@angular/core';

/** `@Service()` is new in Angular 22; its partial declaration needs a 22 linker. */
@Service()
export class ClockService {
  now(): number {
    return Date.now();
  }
}
