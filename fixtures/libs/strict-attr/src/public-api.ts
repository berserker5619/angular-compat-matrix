import { Directive, input } from '@angular/core';

/**
 * Users write `<div ngmToggle>`, which binds the empty string to a boolean input.
 * Without a `booleanAttribute` transform, only strict template checking catches it.
 */
@Directive({ selector: '[ngmToggle]', host: { '[class.on]': 'ngmToggle()' } })
export class ToggleDirective {
  readonly ngmToggle = input<boolean>(false);
}
