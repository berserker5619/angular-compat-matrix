import { Component, input } from '@angular/core';

@Component({ selector: 'ngm-canary', template: `<span>{{ text() }}</span>` })
export class CanaryComponent {
  readonly text = input('canary');
}
