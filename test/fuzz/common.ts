import { BigNumber, BigNumberish } from 'ethers'
import { fp } from '../../common/numbers'

export enum PriceModelKind {
  CONSTANT,
  MANUAL,
  BAND,
  WALK,
}

export interface PriceModel {
  kind: PriceModelKind
  curr: BigNumberish
  low: BigNumberish
  high: BigNumberish
}

const onePM: PriceModel = {
  kind: PriceModelKind.CONSTANT,
  curr: fp(1),
  low: fp(1),
  high: fp(1),
}

// TODO: test me a little
function aroundPM(value: BigNumberish, spread: BigNumberish): PriceModel {
  // e.g, aroundPM(fp(100), fp(0.05)) should give a BAND PriceModel [fp(95), fp(105)].

  const v = BigNumber.from(value)
  // low = value * (1 - spread)
  const low: BigNumber = v.mul(fp(1).sub(spread)).div(fp(1))

  // high = value * (1 + spread)
  const high: BigNumber = v.mul(fp(1).add(spread)).div(fp(1))

  return {
    kind: PriceModelKind.BAND,
    curr: BigNumber.from(value),
    low: low,
    high: high,
  }
}
