import { BigNumber } from 'ethers'
import { ethers } from 'hardhat'
import { expect } from 'chai'
import { fp } from '../../common/numbers'
import { MAX_UINT192 } from '../../common/constants'

// Expects a price around `avgPrice` assuming a consistent percentage oracle error
export const expectPrice = async (
  assetAddr: string,
  avgPrice: BigNumber,
  oracleError: BigNumber,
  near?: boolean
) => {
  const asset = await ethers.getContractAt('Asset', assetAddr)
  const [lowPrice, highPrice] = await asset.price()
  const expectedLow = avgPrice.mul(fp('1')).div(fp('1').add(oracleError))
  const expectedHigh = avgPrice.mul(fp('1')).div(fp('1').sub(oracleError))

  if (near) {
    const tolerance = avgPrice.mul(fp('0.000001')) // 1 part in 1M
    expect(lowPrice).to.be.closeTo(expectedLow, tolerance)
    expect(highPrice).to.be.closeTo(expectedHigh, tolerance)
  } else {
    expect(lowPrice).to.equal(expectedLow)
    expect(highPrice).to.equal(expectedHigh)
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
