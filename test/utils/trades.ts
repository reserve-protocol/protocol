import { BigNumber } from 'ethers'
import { ethers } from 'hardhat'
import { expect } from 'chai'
import { TestITrading, GnosisTrade } from '../../typechain'
import { bn, fp, divCeil } from '../../common/numbers'

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

export const getAuctionId = async (trader: TestITrading, sellAddr: string): Promise<BigNumber> => {
  const trade = await getTrade(trader, sellAddr)
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

// Computes the sellAmt for a minBuyAmt at two prices
export const toSellAmt = (
  minBuyAmt: BigNumber,
  sellPrice: BigNumber,
  buyPrice: BigNumber,
  oracleError: BigNumber,
  maxTradeSlippage: BigNumber
): BigNumber => {
  const lowSellPrice = sellPrice.sub(sellPrice.mul(oracleError).div(fp('1')))
  const highBuyPrice = buyPrice.add(buyPrice.mul(oracleError).div(fp('1')))
  const product = divCeil(minBuyAmt.mul(fp('1')).mul(highBuyPrice), fp('1').sub(maxTradeSlippage))

  return divCeil(product, lowSellPrice)
}
// Computes the minBuyAmt for a sellAmt at two prices
// sellPrice + buyPrice should not be the low and high estimates, but rather the oracle prices
export const toMinBuyAmt = (
  sellAmt: BigNumber,
  sellPrice: BigNumber,
  buyPrice: BigNumber,
  oracleError: BigNumber,
  maxTradeSlippage: BigNumber
): BigNumber => {
  // do all muls first so we don't round unnecessarily
  // a = loss due to max trade slippage
  // b = loss due to selling token at the low price
  // c = loss due to buying token at the high price
  // mirrors the math from TradeLib ~L:57
  const lowSellPrice = sellPrice.sub(sellPrice.mul(oracleError).div(fp('1')))
  const highBuyPrice = buyPrice.add(buyPrice.mul(oracleError).div(fp('1')))
  const product = sellAmt
    .mul(fp('1').sub(maxTradeSlippage)) // (a)
    .mul(lowSellPrice) // (b)

  return divCeil(divCeil(product, highBuyPrice), fp('1')) // (c)
}

// Returns the buy amount in the auction for the given progression
export const dutchBuyAmount = async (
  progression: BigNumber,
  assetInAddr: string,
  assetOutAddr: string,
  outAmount: BigNumber,
  minTradeVolume: BigNumber,
  maxTradeSlippage: BigNumber
): Promise<BigNumber> => {
  const assetIn = await ethers.getContractAt('IAsset', assetInAddr)
  const assetOut = await ethers.getContractAt('IAsset', assetOutAddr)
  const [sellLow, sellHigh] = await assetOut.price() // {UoA/sellTok}
  const [buyLow, buyHigh] = await assetIn.price() // {UoA/buyTok}

  const inMaxTradeVolume = await assetIn.maxTradeVolume()
  let maxTradeVolume = await assetOut.maxTradeVolume()
  if (inMaxTradeVolume.lt(maxTradeVolume)) maxTradeVolume = inMaxTradeVolume

  const auctionVolume = outAmount.mul(sellHigh).div(fp('1'))
  const slippage1e18 = maxTradeSlippage.mul(
    fp('1').sub(
      auctionVolume.sub(minTradeVolume).mul(fp('1')).div(maxTradeVolume.sub(minTradeVolume))
    )
  )

  // Adjust for rounding
  const leftover = slippage1e18.mod(fp('1'))
  const slippage = slippage1e18.div(fp('1')).add(leftover.gte(fp('0.5')) ? 1 : 0)

  const lowPrice = sellLow.mul(fp('1').sub(slippage)).div(buyHigh)
  const middlePrice = divCeil(sellHigh.mul(fp('1')), buyLow)
  const highPrice = middlePrice.add(divCeil(middlePrice, bn('2'))) // 50% above middlePrice

  const price = progression.lt(fp('0.15'))
    ? highPrice.sub(highPrice.sub(middlePrice).mul(progression).div(fp('0.15')))
    : middlePrice.sub(
        middlePrice
          .sub(lowPrice)
          .mul(progression.sub(fp('0.15')))
          .div(fp('0.85'))
      )

  return divCeil(outAmount.mul(price), fp('1'))
}
