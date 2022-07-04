import { BigNumber } from 'ethers'

export enum PriceModelKind {
  CONSTANT,
  MANUAL,
  BAND,
  WALK,
}

export interface PriceModel {
  kind: PriceModelKind
  curr: BigNumber
  low: BigNumber
  high: BigNumber
}
