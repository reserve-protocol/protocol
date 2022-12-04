import { BigNumber } from 'ethers'
import { ethers } from 'hardhat'
import { abi } from '../../artifacts/@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol/AggregatorV3Interface.json'
import { bn } from '../../common/numbers'

// Use to set reference unit chainlink oracle for an asset, by address
export const setOraclePrice = async (assetAddr: string, price: BigNumber) => {
  const asset = await ethers.getContractAt('Asset', assetAddr)
  const chainlinkFeedAddr = await asset.chainlinkFeed()
  const v3Aggregator = await ethers.getContractAt('MockV3Aggregator', chainlinkFeedAddr)
  await v3Aggregator.updateAnswer(price)
}

// For Euler plugin test
export const setOraclePrice1 = async (oracleAddr: string, price: BigNumber) => {
  const v3Aggregator = await ethers.getContractAt('MockV3Aggregator', oracleAddr)
  await v3Aggregator.updateAnswer(price)
}

export const getOraclePrice = async (oracleAddr: string, signer:Signer) => {
  //const provider = ethers.getDefaultProvider()
  const v3Aggregator = new ethers.Contract(oracleAddr, abi, signer)

  const decimal:BigNumber = await v3Aggregator.decimals()
  const _answer = await v3Aggregator.latestRoundData()
  let answer: BigNumber = _answer[1];
  if(decimal == bn('8')) { answer = await answer.mul(bn('1e10')) }

  return bn(answer)
}


// Use to set invalidate a Chainlink oracle for an asset
export const setInvalidOracleTimestamp = async (assetAddr: string) => {
  const asset = await ethers.getContractAt('Asset', assetAddr)
  const chainlinkFeedAddr = await asset.chainlinkFeed()
  const v3Aggregator = await ethers.getContractAt('MockV3Aggregator', chainlinkFeedAddr)
  await v3Aggregator.setInvalidTimestamp()
}
