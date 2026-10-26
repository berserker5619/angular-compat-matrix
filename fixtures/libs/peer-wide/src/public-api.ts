import { Component, input, isWritableSignal, signal } from '@angular/core';

/** `isWritableSignal` arrived in Angular 21, so an Angular 20 app can't resolve the import. */
@Component({ selector: 'ngm-signal-info', template: `<span>{{ writable }}</span>` })
export class SignalInfoComponent {
  readonly label = input('');
  readonly writable = isWritableSignal(signal(0));
}
