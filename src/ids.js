// Discord's autocomplete suggestions are just that — suggestions. Nothing
// stops a user from typing their own text into an autocomplete-backed
// string option instead of picking one, which would otherwise reach a
// query expecting a numeric ID and fail as an opaque Postgres cast error.
// Check this first and reply with a clear message instead.
//
// Deliberately has no DB/Discord dependency (unlike autocomplete.js, which
// re-exports this) so it — and anything that only needs this check — stays
// unit-testable without a live database connection.
export function isValidId(value) {
  return /^\d+$/.test(value);
}
