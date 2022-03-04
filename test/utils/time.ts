import { ethers } from 'hardhat'

export const advanceTime = async (seconds: number | string) => {
  await ethers.provider.send('evm_increaseTime', [parseInt(seconds.toString())])
  await ethers.provider.send('evm_mine', [])
}

export const advanceToTimestamp = async (timestamp: number | string) => {
  await ethers.provider.send('evm_setNextBlockTimestamp', [parseInt(timestamp.toString())])
  await ethers.provider.send('evm_mine', [])
}

export const getLatestBlockTimestamp = async (): Promise<number> => {
  const latestBlock = await ethers.provider.getBlock('latest')
  return latestBlock.timestamp
}

export const getLatestBlockNumber = async (): Promise<number> => {
  const latestBlock = await ethers.provider.getBlock('latest')
  return latestBlock.number
}

export const advanceBlocks = async (blocks: number) => {
  await ethers.provider.send('hardhat_mine', ['0x' + blocks.toString(16)])
}
