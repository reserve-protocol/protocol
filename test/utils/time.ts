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
  let blockString: string = BigNumber.isBigNumber(blocks)
    ? blocks.toHexString()
    : '0x' + blocks.toString(16)

  // Remove a single leading zero from a hexadecimal number, if present
  // (hardhat doesn't want it, but BigNumber.toHexString often makes it)
  if (blockString.length > 3 && blockString[2] == '0') {
    const newBlockString = blockString.slice(0, 2) + blockString.slice(3)
    blockString = newBlockString
  }
  await ethers.provider.send('hardhat_mine', [blockString])
  await hre.network.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x0']) // Temporary fix - Hardhat issue
}
