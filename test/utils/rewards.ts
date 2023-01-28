import { Decimal } from 'decimal.js'
import { BigNumber } from 'ethers'
import { fp } from '../../common/numbers'

export const makeDecayFn = (ratio: BigNumber) => {
  // Calculate the amount of amtRToken left numPeriods rounds of decay has occurred,
  // rounding up to simulate the protocol keeping more for itself
  return (amtRToken: BigNumber, numPeriods: number): BigNumber => {
    const expBase = new Decimal(fp('1').sub(ratio).toString()).div(new Decimal('1e18'))
    const result = new Decimal(amtRToken.toString()).mul(expBase.pow(numPeriods))
    return BigNumber.from(result.toFixed(0))
  }
}

// Calculate the maximum error that could result from doing FixedLib.powu() with exponent
// Takes the ceil of the log_2 of the number
export const calcErr = (exponent: number): BigNumber => {
  return BigNumber.from((0.5 + Math.log2(exponent)).toFixed())
}
