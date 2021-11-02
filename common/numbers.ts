import { BigNumberish, BigNumber } from 'ethers'
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

// Convert to Fix (or scaled-int) from a string or BigNumber representation.
//   If the arg is a string, it can have a decimal point and/or scientific-notation exponent.
export const fp = (x: string | BigNumberish): BigNumber => {
  if (typeof x === 'string') return _parseScientific(x, SCALE_DECIMALS)
  return BigNumber.from(x).mul(pow10(SCALE_DECIMALS))
}

export const divCeil = (x: BigNumber, y: BigNumber): BigNumber =>
  // ceil(x/y) == (x + y - 1) / y
  x.add(y).sub(1).div(y)

// _parseScientific(s, scale) returns a BigNumber with value (s * 10**scale),
// where s is a string in decimal or scientific notation,
// and scale is a BigNumberish indicating a number of additional zeroes to add to the right,
// Fractional digits in the result are truncated.
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
  const match = s.match(/^(?<integer>[+-]?\d+)(\.(?<mantissa>\d+))?(e(?<exponent>[+-]?\d+))?$/)
  if (!match || !match.groups) throw new Error(`fromSciNotation: Illegal floating-point value ${s}`)

  let int_part = BigNumber.from(match.groups.integer)
  // The mantissa is the "fractional part" of a decimal-notation value
  const mantissa = match.groups.mantissa ? BigNumber.from(match.groups.mantissa) : ZERO
  let exponent = match.groups.exponent ? BigNumber.from(match.groups.exponent) : ZERO
  exponent = exponent.add(scale)

  // "zero" the mantissa by shifting it into int_part, keeping the overall value equal
  if (mantissa) {
    const shift_digits = match.groups.mantissa.length
    int_part = int_part.mul(pow10(shift_digits)).add(mantissa)
    exponent = exponent.sub(shift_digits)
  }

  if (exponent.gte(ZERO)) {
    // If remaining exponent is positive, shift int_part left
    return int_part.mul(pow10(exponent))
  } else {
    // If remaining exponent is negative, shift int_part right
    return int_part.div(pow10(exponent.abs()))
  }
}
