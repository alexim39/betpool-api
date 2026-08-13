export interface InsuranceEval {
  applies: boolean;
  reason?: 'below_min_legs' | 'multiple_losses' | 'no_winners' | 'no_loss' | 'ok';
  effectiveLegs: number;
  lostCount: number;
  wonCount: number;
  voidCount: number;
}

export function getAccumulatorInsuranceMinLegs(): number {
  const value = parseInt(process.env.ACCUMULATOR_INSURANCE_MIN_LEGS || '4', 10);
  return Number.isFinite(value) && value >= 2 ? value : 4;
}

/**
 * Lucky-loser insurance: an accumulator where exactly ONE leg failed
 * (and at least one leg won) is paid as a reduced accumulator using the
 * winning legs only, provided the non-void leg count meets the minimum.
 * Void legs are dropped entirely — they never count as "the failing leg".
 */
export function evaluateAccumulatorInsurance(items: Array<{ status: string }>): InsuranceEval {
  const lostCount = items.filter(i => i.status === 'lost').length;
  const wonCount = items.filter(i => i.status === 'won').length;
  const voidCount = items.filter(i => i.status === 'void').length;
  const effectiveLegs = items.length - voidCount;

  if (lostCount === 0) return { applies: false, reason: 'no_loss', effectiveLegs, lostCount, wonCount, voidCount };
  if (lostCount > 1) return { applies: false, reason: 'multiple_losses', effectiveLegs, lostCount, wonCount, voidCount };
  if (wonCount === 0) return { applies: false, reason: 'no_winners', effectiveLegs, lostCount, wonCount, voidCount };
  if (effectiveLegs < getAccumulatorInsuranceMinLegs()) {
    return { applies: false, reason: 'below_min_legs', effectiveLegs, lostCount, wonCount, voidCount };
  }

  return { applies: true, reason: 'ok', effectiveLegs, lostCount, wonCount, voidCount };
}