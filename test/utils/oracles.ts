import { BigNumber } from 'ethers'
import { ethers } from 'hardhat'
import { expect } from 'chai'
import { fp } from '../../common/numbers'

// Expects a symmetric price around `avgPrice` assuming a consistent percentage oracle error
export const expectPrice = async (
  assetAddr: string,
  avgPrice: BigNumber,
  oracleError: BigNumber
) => {
  const asset = await ethers.getContractAt('Asset', assetAddr)
  const [lowPrice, highPrice] = await asset.price()
  const delta = avgPrice.mul(oracleError).div(fp('1'))
  expect(lowPrice).to.equal(avgPrice.sub(delta))
  expect(highPrice).to.equal(avgPrice.add(delta))
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
