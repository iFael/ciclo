/**
 * Suggestion rules (product, 2026-11).
 *
 * A charge becomes a suggestion only when the same descriptor, inside one
 * amount group (every amount within 15% of the group minimum), shows up in
 * consecutive cycles and the last charge is still recent:
 * - monthly: at least 3 occurrences. Months must be consecutive, with at most
 *   one missed month inside the streak. The last charge must be within
 *   45 days (~1.5 cycles).
 * - annual: at least 2 occurrences about 12 months apart (330–400 days) and
 *   the last charge within ~13 months (395 days).
 *
 * One-off and two-time charges are not suggested. Generic app-store and
 * payment-processor descriptors are never suggested. Dates are not projected:
 * the card shows the last real charge.
 */

export const AMOUNT_TOLERANCE = 0.15;
export const MONTHLY_GRACE_DAYS = 45;
export const ANNUAL_GRACE_DAYS = 395;
export const ANNUAL_GAP_MIN = 330;
export const ANNUAL_GAP_MAX = 400;
export const DAY_WINDOW = 5;
export const MIN_MONTHLY_OCCURRENCES = 3;
export const MIN_ANNUAL_OCCURRENCES = 2;
export const HISTORY_MONTHS = 14;
