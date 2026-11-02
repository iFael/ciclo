/**
 * Suggestion rules (product, 2026-11, v2).
 *
 * The user picks what is a plan, so the detector casts a wide net and the
 * confidence score orders the list. A charge becomes a suggestion when the
 * same descriptor, inside one amount group (every amount within 15% of the
 * group minimum), repeats and the last charge is still recent:
 * - monthly: at least 2 occurrences in consecutive months, with at most one
 *   missed month inside the streak. The last charge must be within 45 days.
 * - annual: at least 2 occurrences about 12 months apart (330–400 days) and
 *   the last charge within ~13 months (395 days).
 * - a known catalog service charged once in the last 45 days is also suggested.
 *
 * Amounts under R$ 1 and investment or reserve movements are never suggested,
 * nor are generic app-store and payment-processor descriptors. Dates are not
 * projected: the card shows the last real charge.
 */

export const AMOUNT_TOLERANCE = 0.15;
export const MONTHLY_GRACE_DAYS = 45;
export const ANNUAL_GRACE_DAYS = 395;
export const ANNUAL_GAP_MIN = 330;
export const ANNUAL_GAP_MAX = 400;
export const DAY_WINDOW = 5;
export const MIN_MONTHLY_OCCURRENCES = 2;
export const MIN_ANNUAL_OCCURRENCES = 2;
export const HISTORY_MONTHS = 14;
export const MIN_AMOUNT = 1;
