import { Component, computed, input } from '@angular/core';
import { ICONS } from './icons.generated';

export { ICONS };

@Component({
  selector: 'ngm-icon',
  template: `<svg viewBox="0 0 24 24"><path [attr.d]="path()" /></svg>`,
})
export class IconComponent {
  readonly name = input.required<string>();
  readonly path = computed(() => ICONS[this.name()] ?? '');
}
