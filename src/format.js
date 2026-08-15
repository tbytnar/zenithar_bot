export function contractAutocompleteLabel(name, createdAt) {
  const date = createdAt.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  return `${name} (${date})`;
}
