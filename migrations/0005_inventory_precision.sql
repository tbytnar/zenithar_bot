-- Widens inventory_lots' quantity columns to a fixed 6-decimal scale.
-- Proportional-consumption math (splitting a draw across multiple
-- contributors' lots) is floating-point division under the hood, which can
-- leave unbounded, un-roundable dust behind after repeated partial draws
-- (e.g. splitting 1 unit three ways never sums back to exactly 1 in binary
-- floating point). The application now rounds this itself (see
-- planConsumption in src/math.js), but pinning the column's scale rounds
-- on write regardless of the code path, as a second line of defense.

BEGIN;

ALTER TABLE inventory_lots ALTER COLUMN quantity TYPE NUMERIC(14,6);
ALTER TABLE inventory_lots ALTER COLUMN original_quantity TYPE NUMERIC(14,6);

COMMIT;
