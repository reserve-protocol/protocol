import Big from 'big.js'
import { BigNumber } from 'ethers'
import { fp } from '../../../common/numbers'

export const makeDecayFn = (ratio: BigNumber) => {
  return (amtRToken: BigNumber, numPeriods: number) => {
    // Use Big.js library for exponential
    const expBase = new Big(fp('1').sub(ratio).toString()).div(new Big('1e18'))
    const result = new Big(amtRToken.toString()).mul(expBase.pow(numPeriods).toString())
    return result.toString()
  }
}
