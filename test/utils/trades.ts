import { BigNumber } from 'ethers'
import { ethers } from 'hardhat'
import { expect } from 'chai'
import { TestITrading, GnosisTrade } from '../../typechain'

export const expectTrade = async (trader: TestITrading, auctionInfo: Partial<ITradeInfo>) => {
  if (!auctionInfo.sell) throw new Error('Must provide sell token to find trade')
  const trade = await getTrade(trader, auctionInfo.sell as string)
  expect(await trade.sell()).to.equal(auctionInfo.sell)
  if (auctionInfo.buy) expect(await trade.buy()).to.equal(auctionInfo.buy)
  if (auctionInfo.endTime) expect(await trade.endTime()).to.equal(auctionInfo.endTime)
  if (auctionInfo.externalId) expect(await trade.auctionId()).to.equal(auctionInfo.externalId)
}

export const getTrade = async (trader: TestITrading, sellAddr: string): Promise<GnosisTrade> => {
  const tradeAddr = await trader.trades(sellAddr)
  return await ethers.getContractAt('GnosisTrade', tradeAddr)
}

export const getAuctionId = async (trader: TestITrading, erc20Addr: string): Promise<BigNumber> => {
  const trade = await getTrade(trader, erc20Addr)
  return await trade.auctionId()
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
