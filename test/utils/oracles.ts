import { BigNumber } from 'ethers'
import { ethers } from 'hardhat'

// Use to set reference unit chainlink oracle for an asset, by address
export const setOraclePrice = async (assetAddr: string, price: BigNumber) => {
  const asset = await ethers.getContractAt('Asset', assetAddr)
  const chainlinkFeedAddr = await asset.chainlinkFeed()
  const v3Aggregator = await ethers.getContractAt('MockV3Aggregator', chainlinkFeedAddr)
  await v3Aggregator.updateAnswer(price)
}

// Use to set reference unit chainlink oracle for an asset, by address

export interface OracleUniV2Params {
  univ2Addr: string
  priceA?: BigNumber
  priceB?: BigNumber
}
export const setOraclePriceUniV2 = async ({
  univ2Addr,
  priceA,
  priceB,
}: OracleUniV2Params): Promise<void> => {
  const asset = await ethers.getContractAt('UniV2Asset', univ2Addr)
  const chainlinkFeedAddrA = await asset.chainlinkFeedA()
  const chainlinkFeedAddrB = await asset.chainlinkFeedB()
  if (priceA) {
    const v3AggregatorA = await ethers.getContractAt('MockV3Aggregator', chainlinkFeedAddrA)
    await v3AggregatorA.updateAnswer(priceA)
  }
  if (priceB) {
    const v3AggregatorB = await ethers.getContractAt('MockV3Aggregator', chainlinkFeedAddrB)
    await v3AggregatorB.updateAnswer(priceB)
  }
}

// Use to set invalidate a Chainlink oracle for an asset
export const setInvalidOracleTimestamp = async (assetAddr: string) => {
  const asset = await ethers.getContractAt('Asset', assetAddr)
  const chainlinkFeedAddr = await asset.chainlinkFeed()
  const v3Aggregator = await ethers.getContractAt('MockV3Aggregator', chainlinkFeedAddr)
  await v3Aggregator.setInvalidTimestamp()
}
