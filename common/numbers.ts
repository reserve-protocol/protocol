import { BigNumber, BigNumberish } from 'ethers'
import { SCALE_DECIMALS, BN_SCALE_FACTOR, RoundingMode } from './constants'

export const ZERO = BigNumber.from(0)

// Convenience form for "BigNumber.from" that also accepts scientific notation
export const bn = (x: BigNumberish): BigNumber => {
  if (typeof x === 'string') return _parseScientific(x)
  return BigNumber.from(x)
}

export const pow10 = (exponent: BigNumberish): BigNumber => {
  return BigNumber.from(10).pow(exponent)
}

// Convert `x` to a new BigNumber with decimals = `decimals`.
// Input should have SCALE_DECIMALS (18) decimal places.
export const toBNDecimals = (x: BigNumberish, decimals: number): BigNumber => {
  return decimals < SCALE_DECIMALS
    ? BigNumber.from(x).div(pow10(SCALE_DECIMALS - decimals))
    : BigNumber.from(x).mul(pow10(decimals - SCALE_DECIMALS))
}

// Convert to the BigNumber representing a Fix from a BigNumberish.
// Try to handle fractional values intelligently. In particular:
//     If the arg is a fractional JS number, it will be rounded to 9 decimal places (!) and used that way
//     If the arg is a string, it can be in decimal or scientific notation, and will be handled appropriately

export const fp = (x: BigNumberish): BigNumber => {
  if (typeof x === 'string') return _parseScientific(x, SCALE_DECIMALS)
  if (typeof x === 'number' && !Number.isInteger(x))
    return _parseScientific(x.toFixed(9), SCALE_DECIMALS)
  return BigNumber.from(x).mul(BN_SCALE_FACTOR)
}

export const divFloor = (x: BigNumber, y: BigNumber): BigNumber => div(x, y, RoundingMode.FLOOR)

export const divRound = (x: BigNumber, y: BigNumber): BigNumber => div(x, y, RoundingMode.ROUND)

export const divCeil = (x: BigNumber, y: BigNumber): BigNumber => div(x, y, RoundingMode.CEIL)

export function div(x: BigNumber, y: BigNumber, rnd: RoundingMode) {
  let extra: BigNumber = bn(0)

  if (rnd == RoundingMode.CEIL) {
    extra = y.abs().sub(1)
  } else if (rnd == RoundingMode.ROUND) {
    extra = y.abs().div(2)
  }

  if (x.isNegative()) extra = extra.mul(-1)
  return x.add(extra).div(y)
}

// Whether the absolute difference between x and y is less than z
export const near = (x: BigNumber, y: BigNumber, z: BigNumberish): boolean => {
  if (x.lt(y)) {
    return y.sub(x).lte(z)
  }
  return x.sub(y).lte(z)
}

const N = BN_SCALE_FACTOR

// treating x as a SCALE_FACTOR fixed-point number, take its FLOOR
export function fpFloor(x: BigNumber): BigNumber {
  if (x.mod(N).isZero()) return x
  if (x.isNegative()) return x.sub(x.mod(N)).add(N)
  return x.sub(x.mod(N))
}

// treating x as a SCALE_FACTOR fixed-point number, ROUND it
// round(0.5) = 1
export function fpRound(x: BigNumber): BigNumber {
  const m = x.mod(N)
  const threshold = x.isNegative() ? N.div(2) : N.div(2).sub(1)
  if (m.gt(threshold)) return x.sub(m).add(N)
  else return x.sub(m)
}

// treating x as a SCALE_FACTOR fixed-point number, take its CEIL
export function fpCeil(x: BigNumber): BigNumber {
  if (x.mod(N).isZero()) return x
  if (x.isNegative()) return x.sub(x.mod(N))
  return x.sub(x.mod(N)).add(N)
}

// _parseScientific(s, scale) returns a BigNumber with value (s * 10**scale),
// where s is a string in decimal or scientific notation,
// and scale is a BigNumberish indicating a number of additional zeroes to add to the right,
// Fractional digits in the result are truncated.
// TODO: Maybe we should error if we're truncating digits instead?
//
// A few examples:
//     _parseScientific('1.4e2') == BigNumber.from(140)
//     _parseScientific('-2') == BigNumber.from(-2)
//     _parseScientific('0.5', 18) == BigNumber.from(5).mul(pow10(17))
//     _parseScientific('0.127e2') == BigNumber.from(12)
function _parseScientific(s: string, scale: BigNumberish = 0): BigNumber {
  // Scientific Notation: <INT>(.<DIGITS>)?(e<INT>)?
  // INT: [+-]?DIGITS
  // DIGITS: \d+
  const match = s.match(
    /^(?<sign>[+-]?)(?<int_part>\d+)(\.(?<frac_part>\d+))?(e(?<exponent>[+-]?\d+))?$/
  )
  if (!match || !match.groups) throw new Error(`Illegal decimal string ${s}`)

  let sign = match.groups.sign === '-' ? -1 : 1
  let int_part = BigNumber.from(match.groups.int_part)
  const frac_part = match.groups.frac_part ? BigNumber.from(match.groups.frac_part) : ZERO
  let exponent = match.groups.exponent ? BigNumber.from(match.groups.exponent) : ZERO
  exponent = exponent.add(scale)

  // "zero" the fractional part by shifting it into int_part, keeping the overall value equal
  if (!frac_part.eq(ZERO)) {
    const shift_digits = match.groups.frac_part.length
    int_part = int_part.mul(pow10(shift_digits)).add(frac_part)
    exponent = exponent.sub(shift_digits)
  }

  // Shift int_part left or right as exponent requires
  const positive_output: BigNumber = exponent.gte(ZERO)
    ? int_part.mul(pow10(exponent))
    : int_part.div(pow10(exponent.abs()))

  return positive_output.mul(sign)
}

export function shortString(input: BigNumberish): string {
  const maxSimple = bn(1e4)
  const minSimple = bn(-1e4)
  const x = bn(input)
  if (x.gt(minSimple) && x.lt(maxSimple)) return x.toString()
  else
    return x
      .toBigInt()
      .toLocaleString('en-US', { notation: 'scientific', maximumSignificantDigits: 21 })
      .replace('E', 'e')
}
