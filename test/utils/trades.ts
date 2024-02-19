import { getStorageAt, setStorageAt } from '@nomicfoundation/hardhat-network-helpers'
import { Decimal } from 'decimal.js'
import { BigNumber } from 'ethers'
import { ethers } from 'hardhat'
import { expect } from 'chai'
import { TestITrading, GnosisTrade, TestIBroker } from '../../typechain'
import { bn, fp, divCeil, divRound } from '../../common/numbers'
import { IMPLEMENTATION, Implementation } from '../fixtures'

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
  maxTradeSlippage: BigNumber
): Promise<BigNumber> => {
  const assetIn = await ethers.getContractAt('IAsset', assetInAddr)
  const assetOut = await ethers.getContractAt('IAsset', assetOutAddr)
  const [sellLow, sellHigh] = await assetOut.price() // {UoA/sellTok}
  const [buyLow, buyHigh] = await assetIn.price() // {UoA/buyTok}

  const inMaxTradeVolume = await assetIn.maxTradeVolume()
  let maxTradeVolume = await assetOut.maxTradeVolume()
  if (inMaxTradeVolume.lt(maxTradeVolume)) maxTradeVolume = inMaxTradeVolume

  const worstPrice = sellLow.mul(fp('1').sub(maxTradeSlippage)).div(buyHigh)
  const bestPrice = divCeil(sellHigh.mul(fp('1')), buyLow)
  const highPrice = divCeil(sellHigh.mul(fp('1.5')), buyLow)

  let price: BigNumber
  if (progression.lt(fp('0.2'))) {
    const exp = divRound(bn('6502287').mul(fp('0.2').sub(progression)), fp('0.2'))
    const divisor = new Decimal('999999').div('1000000').pow(exp.toString())
    price = divCeil(highPrice.mul(fp('1')), fp(divisor.toString()))
  } else if (progression.lt(fp('0.45'))) {
    price = highPrice.sub(
      highPrice
        .sub(bestPrice)
        .mul(progression.sub(fp('0.2')))
        .div(fp('0.25'))
    )
  } else if (progression.lt(fp('0.95'))) {
    price = bestPrice.sub(
      bestPrice
        .sub(worstPrice)
        .mul(progression.sub(fp('0.45')))
        .div(fp('0.5'))
    )
  } else price = worstPrice
  return divCeil(outAmount.mul(price), fp('1'))
}

export const disableBatchTrade = async (broker: TestIBroker) => {
  if (IMPLEMENTATION == Implementation.P1) {
    const slot = await getStorageAt(broker.address, 205)
    await setStorageAt(broker.address, 205, slot.replace(slot.slice(2, 14), '1'.padStart(12, '0')))
  } else {
    const slot = await getStorageAt(broker.address, 56)
    await setStorageAt(broker.address, 56, slot.replace(slot.slice(2, 42), '1'.padStart(40, '0')))
  }
  expect(await broker.batchTradeDisabled()).to.equal(true)
}

export const disableDutchTrade = async (broker: TestIBroker, erc20: string) => {
  const mappingSlot = IMPLEMENTATION == Implementation.P1 ? bn('208') : bn('57')
  const p = mappingSlot.toHexString().slice(2).padStart(64, '0')
  const key = erc20.slice(2).padStart(64, '0')
  const slot = ethers.utils.keccak256('0x' + key + p)
  await setStorageAt(broker.address, slot, '0x' + '1'.padStart(64, '0'))
  expect(await broker.dutchTradeDisabled(erc20)).to.equal(true)
}
