import Big from 'big.js'
import { BigNumber } from 'ethers'
import { fp } from '../../../common/numbers'

export const makeDecayFn = (ratio: BigNumber) => {
  // Calculate the amount of amtRToken left numPeriods rounds of decay has occurred,
  // rounding up to simulate the protocol keeping more for itself
  return (amtRToken: BigNumber, numPeriods: number) => {
    // Use Big.js library for exponential
    const expBase = new Big(fp('1').sub(ratio).toString()).div(new Big('1e18'))
    const result = new Big(amtRToken.toString()).mul(expBase.pow(numPeriods))
    return BigNumber.from(result.round(0, Big.roundHalfEven).toString())
  }
}
