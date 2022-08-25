import { BigNumber } from 'ethers'
import { ethers } from 'hardhat'

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
