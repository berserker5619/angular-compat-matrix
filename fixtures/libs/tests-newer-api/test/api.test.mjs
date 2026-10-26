import * as core from '@angular/core';

if (typeof core.isWritableSignal !== 'function') {
  console.error(`isWritableSignal is missing from @angular/core ${core.VERSION.full}`);
  process.exit(1);
}
console.log(`ok on @angular/core ${core.VERSION.full}`);
