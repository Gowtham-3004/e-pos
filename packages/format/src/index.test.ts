import { describe, expect, it } from 'vitest';
import { money, date, elapsed, moneyCompact, rupeesToPaise } from './index';

describe('format', () => {
  it('formats INR with Indian grouping', () => {
    expect(money(12545000)).toBe('₹1,25,450.00');
    expect(money(-10000)).toBe('−₹100.00');
  });
  it('compact money', () => {
    expect(moneyCompact(12545000)).toBe('₹1.25L');
  });
  it('dates', () => {
    expect(date('2026-10-07T10:00:00')).toBe('07/10/2026');
  });
  it('elapsed', () => {
    const now = new Date('2026-10-07T10:18:42').getTime();
    expect(elapsed('2026-10-07T10:00:00', now)).toBe('18:42');
  });
  it('parses rupees', () => {
    expect(rupeesToPaise('1,250.50')).toBe(125050);
  });
});
