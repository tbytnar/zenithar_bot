import { formatDate } from './dates.js';

export function contractAutocompleteLabel(name, createdAt) {
  return `${name} (${formatDate(createdAt)})`;
}
