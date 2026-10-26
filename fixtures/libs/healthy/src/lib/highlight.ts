import { booleanAttribute, Directive, input } from '@angular/core';

/** Used as a bare attribute (`<p ngmHighlight>`), so its input accepts that. */
@Directive({
  selector: '[ngmHighlight]',
  host: { '[class.ngm-highlight]': 'ngmHighlight()' },
})
export class HighlightDirective {
  readonly ngmHighlight = input(true, { transform: booleanAttribute });
}
