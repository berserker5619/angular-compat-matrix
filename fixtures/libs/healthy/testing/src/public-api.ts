import { Injectable } from '@angular/core';

/** A secondary entry point, so the smoke app has to find more than one. */
@Injectable({ providedIn: 'root' })
export class FakeGreetingService {
  greet(name: string): string {
    return `fake hello ${name}`;
  }
}
