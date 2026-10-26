import type { DebounceTimer } from '@angular/core';
import { Component, input } from '@angular/core';

/** `DebounceTimer` is a type-only export new in Angular 22: nothing about it survives into the JavaScript. */
export interface SearchOptions {
  debounce?: DebounceTimer<string>;
}

export function defaultSearchOptions(): SearchOptions {
  return {};
}

@Component({ selector: 'ngm-search', template: `<input [placeholder]="placeholder()" />` })
export class SearchComponent {
  readonly placeholder = input('Search');
}
