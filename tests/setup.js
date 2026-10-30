// The extension loads Readability as a classic script, which defines a global.
// Tests mirror that so lib code can use globalThis.Readability in both places.
import { Readability } from '@mozilla/readability';

globalThis.Readability = Readability;
