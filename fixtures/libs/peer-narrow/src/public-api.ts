import { Component, input } from '@angular/core';

@Component({ selector: 'ngm-tag', template: `<span>{{ text() }}</span>` })
export class TagComponent {
  readonly text = input('tag');
}
