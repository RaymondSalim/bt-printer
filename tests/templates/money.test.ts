import { describe, expect, it } from 'vitest'
import { currencyDigits, formatMoney, roundMoney } from '../../src/templates/money'

const norm = (s: string) => s.replace(/\u00a0/g, ' ')

describe('money', () => {
  it('uses zero fraction digits for IDR and two otherwise', () => {
    expect(currencyDigits('IDR')).toBe(0)
    expect(currencyDigits('USD')).toBe(2)
  })

  it('rounds to the currency digits and removes float noise', () => {
    expect(roundMoney(0.30000000000000004, 'USD')).toBe(0.3)
    expect(roundMoney(333.3, 'IDR')).toBe(333)
    expect(roundMoney(333.5, 'IDR')).toBe(334)
  })

  it('formats rupiah with dot grouping and no decimals', () => {
    expect(norm(formatMoney(15000))).toBe('Rp 15.000')
    expect(norm(formatMoney(1234567))).toBe('Rp 1.234.567')
    expect(norm(formatMoney(-500))).toBe('-Rp 500')
  })

  it('formats other currencies with two decimals', () => {
    expect(norm(formatMoney(12.5, 'USD'))).toBe('$12.50')
  })
})
