import { BigNumber } from 'ethers'
import { ethers } from 'hardhat'
import { expect } from 'chai'
import { ZERO_ADDRESS } from '../../common/constants'
import { TestIOracle, MockV3Aggregator } from '../../typechain'

// TODO
// export const getPrice = async (oracle: TestIOracle, symbol: string) => {
//   const symbolBytes = ethers.utils.formatBytes32String(symbol)
//   const v3Aggregator = await oracle.chainlink(symbolBytes)
//   ...
// }

export const setPrice = async (oracle: TestIOracle, symbol: string, price: BigNumber) => {
  const symbolBytes = ethers.utils.formatBytes32String(symbol)
  const aggregatorAddr = await oracle.chainlink(symbolBytes)
  if (aggregatorAddr == ZERO_ADDRESS) {
    throw new Error('Missing chainlink aggregator deployment')
  }
  const v3Aggregator = await ethers.getContractAt('MockV3Aggregator', aggregatorAddr)
  await v3Aggregator.updateAnswer(price)
}
