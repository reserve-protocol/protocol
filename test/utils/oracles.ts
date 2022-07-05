import { BigNumber } from 'ethers'
import { ethers } from 'hardhat'

// TODO
// export const getPrice = async (oracle: TestIOracle, symbol: string) => {
//   const symbolBytes = ethers.utils.formatBytes32String(symbol)
//   const v3Aggregator = await oracle.chainlink(symbolBytes)
//   ...
// }

export const setOraclePrice = async (assetAddr: string, price: BigNumber) => {
  const asset = await ethers.getContractAt('TestIAsset', assetAddr)
  const chainlinkFeedAddr = await asset.chainlinkFeed()
  const v3Aggregator = await ethers.getContractAt('MockV3Aggregator', chainlinkFeedAddr)
  await v3Aggregator.updateAnswer(price)
}
