// Pure date helpers — no DB/Discord dependency, so parsing/formatting can
// be unit tested directly.

const DUE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Accepts a strict "YYYY-MM-DD" string and returns a Date set to the end of
// that day (UTC), so a contract stays "not yet due" for the whole day it's
// due on. Returns null for anything that isn't that exact format or isn't a
// real calendar date (e.g. 2026-02-30).
export function parseDueDate(input) {
  if (!DUE_DATE_PATTERN.test(input)) return null;
  const date = new Date(`${input}T23:59:59Z`);
  if (Number.isNaN(date.getTime())) return null;
  // Date() normalizes overflow (e.g. 2026-02-30 -> Mar 2) instead of
  // rejecting it — catch that by checking the parsed date didn't roll over.
  const [year, month, day] = input.split('-').map(Number);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) {
    return null;
  }
  return date;
}

export function formatDate(date) {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function isOverdue(date) {
  return date < new Date();
}
