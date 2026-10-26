import { Component, input } from '@angular/core';

@Component({ selector: 'ngm-label', template: `<label>{{ text() }}</label>` })
export class LabelComponent {
  readonly text = input('');
}
