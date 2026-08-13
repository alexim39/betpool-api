import { evaluateAccumulatorInsurance, getAccumulatorInsuranceMinLegs } from './parlay-insurance';

describe('getAccumulatorInsuranceMinLegs', () => {
  afterEach(() => {
    delete process.env.ACCUMULATOR_INSURANCE_MIN_LEGS;
  });

  it('defaults to 4', () => {
    expect(getAccumulatorInsuranceMinLegs()).toBe(4);
  });

  it('reads the env value', () => {
    process.env.ACCUMULATOR_INSURANCE_MIN_LEGS = '3';
    expect(getAccumulatorInsuranceMinLegs()).toBe(3);
  });

  it('falls back to 4 for invalid values', () => {
    process.env.ACCUMULATOR_INSURANCE_MIN_LEGS = 'abc';
    expect(getAccumulatorInsuranceMinLegs()).toBe(4);
  });
});

describe('evaluateAccumulatorInsurance', () => {
  const leg = (status: string) => ({ status });

  it('does not apply when nothing lost', () => {
    const eval_ = evaluateAccumulatorInsurance([leg('won'), leg('won')]);
    expect(eval_.applies).toBe(false);
    expect(eval_.reason).toBe('no_loss');
  });

  it('applies for exactly one lost leg with 4+ effective legs', () => {
    const eval_ = evaluateAccumulatorInsurance([leg('won'), leg('won'), leg('won'), leg('lost')]);
    expect(eval_.applies).toBe(true);
    expect(eval_.lostCount).toBe(1);
    expect(eval_.wonCount).toBe(3);
    expect(eval_.effectiveLegs).toBe(4);
  });

  it('does not apply below the minimum leg count', () => {
    const eval_ = evaluateAccumulatorInsurance([leg('won'), leg('won'), leg('lost')]);
    expect(eval_.applies).toBe(false);
    expect(eval_.reason).toBe('below_min_legs');
  });

  it('does not apply with two or more lost legs', () => {
    const eval_ = evaluateAccumulatorInsurance([leg('won'), leg('lost'), leg('won'), leg('lost')]);
    expect(eval_.applies).toBe(false);
    expect(eval_.reason).toBe('multiple_losses');
  });

  it('does not apply when no legs won', () => {
    const eval_ = evaluateAccumulatorInsurance([leg('lost'), leg('void'), leg('void'), leg('void')]);
    expect(eval_.applies).toBe(false);
    expect(eval_.reason).toBe('no_winners');
    expect(eval_.lostCount).toBe(1);
    expect(eval_.wonCount).toBe(0);
  });

  it('counts void legs as dropped, not as the failing leg', () => {
    const eval_ = evaluateAccumulatorInsurance([leg('won'), leg('won'), leg('won'), leg('lost'), leg('void')]);
    expect(eval_.applies).toBe(true);
    expect(eval_.voidCount).toBe(1);
    expect(eval_.effectiveLegs).toBe(4);
  });
});