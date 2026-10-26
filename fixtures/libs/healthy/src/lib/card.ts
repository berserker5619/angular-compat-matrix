import { Component, input, output } from '@angular/core';

@Component({
  selector: 'ngm-card',
  template: `
    <h2>{{ title() }}</h2>
    @if (elevation() > 0) {
      <div class="shadow"><ng-content /></div>
    } @else {
      <ng-content />
    }
    <button type="button" (click)="closed.emit()">Close</button>
  `,
})
export class CardComponent {
  readonly title = input.required<string>();
  readonly elevation = input(1);
  readonly closed = output<void>();
}
