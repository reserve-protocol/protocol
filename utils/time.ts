import { BigNumber } from 'ethers'
import { HardhatRuntimeEnvironment } from 'hardhat/types'

export const advanceTime = async (hre: HardhatRuntimeEnvironment, seconds: number | string) => {
  await hre.ethers.provider.send('evm_increaseTime', [parseInt(seconds.toString())])
  await hre.ethers.provider.send('evm_mine', [])
}

export const advanceToTimestamp = async (
  hre: HardhatRuntimeEnvironment,
  timestamp: number | string
) => {
  await hre.ethers.provider.send('evm_setNextBlockTimestamp', [parseInt(timestamp.toString())])
  await hre.ethers.provider.send('evm_mine', [])
}

export const setNextBlockTimestamp = async (
  hre: HardhatRuntimeEnvironment,
  timestamp: number | string
) => {
  await hre.network.provider.send('evm_setNextBlockTimestamp', [timestamp])
}

export const getLatestBlockTimestamp = async (hre: HardhatRuntimeEnvironment): Promise<number> => {
  const latestBlock = await hre.ethers.provider.getBlock('latest')
  return latestBlock.timestamp
}

export const getLatestBlockNumber = async (hre: HardhatRuntimeEnvironment): Promise<number> => {
  const latestBlock = await hre.ethers.provider.getBlock('latest')
  return latestBlock.number
}

export const advanceBlocks = async (hre: HardhatRuntimeEnvironment, blocks: number | BigNumber) => {
  let blockString: string = BigNumber.isBigNumber(blocks)
    ? blocks.toHexString()
    : '0x' + blocks.toString(16)

  // Remove a single leading zero from a hexadecimal number, if present
  // (hardhat doesn't want it, but BigNumber.toHexString often makes it)
  if (blockString.length > 3 && blockString[2] == '0') {
    const newBlockString = blockString.slice(0, 2) + blockString.slice(3)
    blockString = newBlockString
  }

  await hre.ethers.provider.send('hardhat_mine', [blockString, '0xc'])
  // await hre.network.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x0']) // Temporary fix - Hardhat issue
}

export const advanceBlocksTenderly = async (
  hre: HardhatRuntimeEnvironment,
  blocks: number | BigNumber
) => {
  let blockString: string = BigNumber.isBigNumber(blocks)
    ? blocks.toHexString()
    : '0x' + blocks.toString(16)

  // Remove a single leading zero from a hexadecimal number, if present
  // (hardhat doesn't want it, but BigNumber.toHexString often makes it)
  if (blockString.length > 3 && blockString[2] == '0') {
    const newBlockString = blockString.slice(0, 2) + blockString.slice(3)
    blockString = newBlockString
  }
  await hre.ethers.provider.send('evm_increaseBlocks', [blockString])
}
