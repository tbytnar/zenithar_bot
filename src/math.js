// Pure calculation helpers with no DB/Discord dependency, so the actual
// money and inventory math can be unit tested directly instead of only
// ever being exercised end-to-end through a live bot + database.

const ROUND_SCALE = 1e6; // 6 decimal places

function round6(n) {
  return Math.round(n * ROUND_SCALE) / ROUND_SCALE;
}

// Splits `total` across `entries` (each `{ key, weight }`) proportionally
// to weight. Returns `{ key, weight, sharePct, amount }` for every entry —
// entries with zero total weight get nothing back. Used by contract payout
// splitting (contract.js's computeAndRecordPayout).
export function splitProportionally(entries, total) {
  const grandTotal = entries.reduce((sum, e) => sum + Number(e.weight), 0);
  if (grandTotal <= 0) return [];

  return entries.map((e) => {
    const weight = Number(e.weight);
    const sharePct = weight / grandTotal;
    return { key: e.key, weight, sharePct, amount: sharePct * total };
  });
}

// Plans how to draw `requestedQty` units proportionally across `lots`
// (each `{ id, memberId, quantity }`) — fungible stock doesn't have a
// single owner once pooled, so a draw takes the same share from everyone
// currently holding it. Returns `{ takes, deficit }`: `takes` is one entry
// per lot with anything to give up, and `deficit` is how much of the
// request stock couldn't cover (0 if it was fully covered).
//
// Quantities are rounded to 6 decimal places so repeated proportional
// draws (e.g. splitting 1 unit three ways) can't leave unbounded
// floating-point dust behind — see consumeInventory in inventory.js.
export function planConsumption(lots, requestedQty) {
  const totalAvailable = lots.reduce((sum, l) => sum + Number(l.quantity), 0);
  const takes = [];

  if (totalAvailable > 0) {
    const shareRatio = Math.min(requestedQty, totalAvailable) / totalAvailable;
    for (const lot of lots) {
      const quantity = round6(Number(lot.quantity) * shareRatio);
      if (quantity <= 0) continue;
      takes.push({ id: lot.id, memberId: lot.memberId, quantity });
    }
  }

  const deficit = round6(Math.max(0, requestedQty - totalAvailable));
  return { takes, deficit };
}
