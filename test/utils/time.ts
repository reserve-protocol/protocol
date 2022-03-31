import hre, { ethers } from 'hardhat'
import { BigNumber } from 'ethers'

export const advanceTime = async (seconds: number | string) => {
  await ethers.provider.send('evm_increaseTime', [parseInt(seconds.toString())])
  await ethers.provider.send('evm_mine', [])
}

export const advanceToTimestamp = async (timestamp: number | string) => {
  await ethers.provider.send('evm_setNextBlockTimestamp', [parseInt(timestamp.toString())])
  await ethers.provider.send('evm_mine', [])
}

export const setNextBlockTimestamp = async (timestamp: number | string) => {
  await hre.network.provider.send('evm_setNextBlockTimestamp', [timestamp])
}

export const getLatestBlockTimestamp = async (): Promise<number> => {
  const latestBlock = await ethers.provider.getBlock('latest')
  return latestBlock.timestamp
}

export const getLatestBlockNumber = async (): Promise<number> => {
  const latestBlock = await ethers.provider.getBlock('latest')
  return latestBlock.number
}

export const advanceBlocks = async (blocks: number | BigNumber) => {
  const blockString: string = BigNumber.isBigNumber(blocks)
    ? blocks.toHexString()
    : '0x' + blocks.toString(16)
  await ethers.provider.send('hardhat_mine', [blockString])
  await hre.network.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x0']) // Temporary fix - Hardhat issue
}
