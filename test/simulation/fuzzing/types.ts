import { BigNumber } from 'ethers'

export type BasketTokenEntry = {
  name: string
  symbol: string
  quantityE18: BigNumber
  //decimals: number
}
