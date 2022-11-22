import { fp } from '../../common/numbers'

export const getRatePerPeriod = (basisPoints: number, period = 60) => {
  basisPoints = Math.floor(basisPoints)
  // days * hours * minutes
  const n = (365.25 * 24 * 60 * 60) / period
  const p = 10000
  if (basisPoints > p || basisPoints < 0)
    throw new Error('basisPoints invalid: should be between 0 - 10000')

  if (n < 1) throw new Error('period invalid')

  const a = p - Math.floor(basisPoints)
  const rate = basisPoints === 0 ? 1 : basisPoints === p ? 0 : Math.pow(a / p, 1 / n)
  return fp(rate)
}
