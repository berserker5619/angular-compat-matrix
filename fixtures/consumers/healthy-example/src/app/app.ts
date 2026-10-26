import { Component, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CardComponent, GreetingService, HighlightDirective, InitialsPipe, LegacyBadgeModule } from 'ngm-fixture-healthy';

/** An author's own example app, used with --consumer instead of the generated smoke app. */
@Component({
  imports: [RouterOutlet, CardComponent, HighlightDirective, InitialsPipe, LegacyBadgeModule],
  selector: 'app-root',
  template: `
    <ngm-card [title]="title()" [elevation]="2" (closed)="closed.set(true)">
      <p ngmHighlight>{{ greeting }}</p>
      <ngm-legacy-badge [label]="'Ada Lovelace' | initials" />
    </ngm-card>
    <router-outlet />
  `,
})
export class App {
  protected readonly title = signal('healthy-example');
  protected readonly closed = signal(false);
  protected readonly greeting = inject(GreetingService).greet('example');
}
