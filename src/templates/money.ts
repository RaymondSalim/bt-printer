export function currencyDigits(currency: string): number {
  return currency === 'IDR' ? 0 : 2
}

export function roundMoney(amount: number, currency: string): number {
  const factor = 10 ** currencyDigits(currency)
  return Math.round((amount + Number.EPSILON) * factor) / factor
}

export function formatMoney(amount: number, currency = 'IDR', locale?: string): string {
  const digits = currencyDigits(currency)
  return new Intl.NumberFormat(locale ?? (currency === 'IDR' ? 'id-ID' : 'en-US'), {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amount)
}
