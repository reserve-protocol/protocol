import { BigNumber } from 'ethers'
import { ethers } from 'hardhat'
import { expect } from 'chai'
import { TestITrading, GnosisTrade } from '../../typechain'

export const expectTrade = async (
  trader: TestITrading,
  index: number,
  auctionInfo: Partial<ITradeInfo>
) => {
  const trade = await getTrade(trader, index)
  expect(await trade.sell()).to.equal(auctionInfo.sell)
  expect(await trade.buy()).to.equal(auctionInfo.buy)
  expect(await trade.endTime()).to.equal(auctionInfo.endTime)
  expect(await trade.auctionId()).to.equal(auctionInfo.externalId)
}

// TODO use this in more places
export const getTrade = async (trader: TestITrading, index: number): Promise<GnosisTrade> => {
  const tradeAddr = await trader.trades(index)
  return await ethers.getContractAt('GnosisTrade', tradeAddr)
}

export interface ITradeInfo {
  sell: string
  buy: string
  endTime: number
  externalId: BigNumber
}

export interface ITradeRequest {
  sell: string
  buy: string
  sellAmount: BigNumber
  minBuyAmount: BigNumber
}
