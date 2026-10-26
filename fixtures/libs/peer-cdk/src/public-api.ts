import { coerceBooleanProperty } from '@angular/cdk/coercion';
import { Component, input } from '@angular/core';

@Component({ selector: 'ngm-switch', template: `<span>{{ on() ? 'on' : 'off' }}</span>` })
export class SwitchComponent {
  readonly on = input(false, { transform: (value: unknown) => coerceBooleanProperty(value) });
}
