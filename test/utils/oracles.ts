import { BigNumber } from 'ethers'
import { ethers } from 'hardhat'
import { expect } from 'chai'
import { fp, bn, divCeil } from '../../common/numbers'
import { MAX_UINT192 } from '../../common/constants'

const toleranceDivisor = bn('1e15') // 1 part in 1000 trillions

// Expects a price around `avgPrice` assuming a consistent percentage oracle error
// If near is truthy, allows a small error of 1 part in 1000 trillions
export const expectPrice = async (
  assetAddr: string,
  avgPrice: BigNumber,
  oracleError: BigNumber,
  near: boolean
) => {
  const asset = await ethers.getContractAt('Asset', assetAddr)
  const [lowPrice, highPrice] = await asset.price()
  const expectedLow = avgPrice.mul(fp('1')).div(fp('1').add(oracleError))
  const expectedHigh = avgPrice.mul(fp('1')).div(fp('1').sub(oracleError))

  if (near) {
    const tolerance = avgPrice.div(toleranceDivisor)
    expect(lowPrice).to.be.closeTo(expectedLow, tolerance)
    expect(highPrice).to.be.closeTo(expectedHigh, tolerance)
  } else {
    expect(lowPrice).to.equal(expectedLow)
    expect(highPrice).to.equal(expectedHigh)
  }
}

// Expects a price around `avgPrice` assuming a consistent percentage oracle error
// If the RToken is fully capitalized, there's no need to provide maxTradeSlippage/dustLoss
// If maxTradeSlippage is truthy, applies a % reduction to the expected lower price
// If dustLoss is additionally truthy, applies a nominal reduction to the expected lower price
export const expectRTokenPrice = async (
  assetAddr: string,
  avgPrice: BigNumber,
  oracleError: BigNumber,
  maxTradeSlippage?: BigNumber,
  dustLoss?: BigNumber
) => {
  const asset = await ethers.getContractAt('Asset', assetAddr)
  const [lowPrice, highPrice] = await asset.price()
  const expectedLow = avgPrice.mul(fp('1')).div(fp('1').add(oracleError))
  const expectedHigh = avgPrice.mul(fp('1')).div(fp('1').sub(oracleError))
  const tolerance = avgPrice.div(toleranceDivisor)

  if (maxTradeSlippage) {
    // There can be any amount of shortfall, from zero to all the capital held by BackingManager
    // Here we assume it is ALL shortfall, since it's hard to know at any given time the portion
    const shortfallSlippage = divCeil(expectedHigh.mul(maxTradeSlippage), fp('1'))
    const expectedLower = expectedLow.sub(shortfallSlippage)

    let expectedLowest = expectedLower
    if (dustLoss) {
      const rToken = await ethers.getContractAt('IRToken', await asset.erc20())
      const supply = await rToken.totalSupply()
      const dustLostFraction = supply.gt(0) ? dustLoss.mul(fp('1')).div(supply) : dustLoss
      expectedLowest = expectedLower.sub(dustLostFraction)
    }

    expect(lowPrice).to.be.gte(expectedLowest)
    expect(lowPrice).to.be.lte(expectedLow)
    expect(highPrice).to.be.closeTo(expectedHigh, tolerance)
  } else {
    expect(lowPrice).to.be.closeTo(expectedLow, tolerance)
    expect(highPrice).to.be.closeTo(expectedHigh, tolerance)
  }
}

// Expects an unpriced asset with low = 0 and high = FIX_MAX
export const expectUnpriced = async (assetAddr: string) => {
  const asset = await ethers.getContractAt('Asset', assetAddr)
  const [lowPrice, highPrice] = await asset.price()
  expect(lowPrice).to.equal(0)
  expect(highPrice).to.equal(MAX_UINT192)
}

// Use to set reference unit chainlink oracle for an asset, by address
export const setOraclePrice = async (assetAddr: string, price: BigNumber) => {
  const asset = await ethers.getContractAt('Asset', assetAddr)
  const chainlinkFeedAddr = await asset.chainlinkFeed()
  const v3Aggregator = await ethers.getContractAt('MockV3Aggregator', chainlinkFeedAddr)
  await v3Aggregator.updateAnswer(price)
}

// Use to set invalidate a Chainlink oracle for an asset
export const setInvalidOracleTimestamp = async (assetAddr: string) => {
  const asset = await ethers.getContractAt('Asset', assetAddr)
  const chainlinkFeedAddr = await asset.chainlinkFeed()
  const v3Aggregator = await ethers.getContractAt('MockV3Aggregator', chainlinkFeedAddr)
  await v3Aggregator.setInvalidTimestamp()
}
