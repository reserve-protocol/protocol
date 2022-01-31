import { BigNumber, BigNumberish } from 'ethers'
import { ethers } from 'hardhat'

import { BN_SCALE_FACTOR, SCALE_DECIMALS } from './constants'

export const ZERO = BigNumber.from(0)

// Convenience form for "BigNumber.from" that also accepts scientific notation
export const bn = (x: BigNumberish): BigNumber => {
  if (typeof x === 'string') return _parseScientific(x)
  return BigNumber.from(x)
}

export const pow10 = (exponent: BigNumberish): BigNumber => {
  return BigNumber.from(10).pow(exponent)
}

// Convert to the BigNumber representing a Fix from a BigNumberish.
// Try to handle fractional values intelligently. In particular:
//     If the arg is a fractional JS number, it will be rounded to 9 decimal places (!) and used that way
//     If the arg is a string, it can be in decimal or scientific notation, and will be handled appropriately

export const fp = (x: BigNumberish): BigNumber => {
  if (typeof x === 'string') return _parseScientific(x, SCALE_DECIMALS)
  if (typeof x === 'number' && !Number.isInteger(x))
    return _parseScientific(x.toFixed(9), SCALE_DECIMALS)
  return BigNumber.from(x).mul(pow10(SCALE_DECIMALS))
}

export const divCeil = (x: BigNumber, y: BigNumber): BigNumber =>
  // ceil(x/y) == (x + y - 1) / y
  x.add(y).sub(1).div(y)

// Wheter the absolute difference between x and y is less than z
export const near = (x: BigNumber, y: BigNumber, z: BigNumberish): boolean => {
  if (x.lt(y)) {
    return y.sub(x).lte(z)
  }
  return x.sub(y).lte(z)
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
