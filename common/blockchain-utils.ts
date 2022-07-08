import { BigNumber } from 'ethers'
import { HardhatRuntimeEnvironment } from 'hardhat/types'

// getChainId: Returns current chain Id
export const getChainId = async (hre: HardhatRuntimeEnvironment) => {
  let _chainId
  try {
    _chainId = await hre.network.provider.send('eth_chainId')
  } catch (e) {
    console.log('failed to get chainId, falling back on net_version...')
    _chainId = await hre.network.provider.send('net_version')
  }

  if (!_chainId) {
    throw new Error(`could not get chainId from network`)
  }
  if (_chainId.startsWith('0x')) {
    _chainId = BigNumber.from(_chainId).toString()
  }
  return _chainId
}

export const isValidContract = async (
  hre: HardhatRuntimeEnvironment,
  contractAddr: string
): Promise<boolean> => {
  return (await hre.ethers.provider.getCode(contractAddr)) != '0x'
}
