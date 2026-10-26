import { Component, Input, NgModule } from '@angular/core';

/** The NgModule style older libraries still ship. */
@Component({
  selector: 'ngm-legacy-badge',
  template: `<span class="badge">{{ label }}</span>`,
  standalone: false,
})
export class LegacyBadgeComponent {
  @Input({ required: true }) label!: string;
}

@NgModule({
  declarations: [LegacyBadgeComponent],
  exports: [LegacyBadgeComponent],
})
export class LegacyBadgeModule {}
