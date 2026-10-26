import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class GreetingService {
  greet(name: string): string {
    return `hello ${name}`;
  }
}
