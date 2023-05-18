import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { IComponents } from '../../common/configuration'
import { IDeployments } from '../../scripts/deployment/common'
import { isValidContract } from '../../common/blockchain-utils'

export const validateDeployments = async (
  hre: HardhatRuntimeEnvironment,
  deployments: IDeployments,
  version: string
) => {
  // Check trading lib defined
  if (!deployments.tradingLib) {
    throw new Error(
      `Missing deployed TradingLib for version ${version} in network ${hre.network.name}`
    )
  } else if (!(await isValidContract(hre, deployments.tradingLib))) {
    throw new Error(`TradingLib contract not found in network ${hre.network.name}`)
  }

  // Check basket lib defined
  // Only enable after 3.0.0 for future releases
  //   if (!deployments.basketLib) {
  //     throw new Error(
  //       `Missing deployed BasketLib for version ${version} in network ${hre.network.name}`
  //     )
  //   } else if (!(await isValidContract(hre, deployments.basketLib))) {
  //     throw new Error(`BasketLib contract not found in network ${hre.network.name}`)
  //   }

  // Check Main implementation is defined
  if (!deployments.implementations.main) {
    throw new Error(
      `Missing deployed Main implementation for version ${version} in network ${hre.network.name}`
    )
  } else if (!(await isValidContract(hre, deployments.implementations.main))) {
    throw new Error(`Main contract not found in network ${hre.network.name}`)
  }

  // Check all componet implementations are defined
  const componentsKeys: string[] = [
    'backingManager',
    'basketHandler',
    'broker',
    'distributor',
    'furnace',
    'rTokenTrader',
    'rsrTrader',
    'rToken',
    'stRSR',
  ]

  componentsKeys.forEach(async (keystr) => {
    if (!deployments.implementations.components[keystr as keyof IComponents]) {
      throw new Error(
        `Missing deployed ${keystr} implementation for version ${version} in network ${hre.network.name}`
      )
    } else if (
      !(await isValidContract(
        hre,
        deployments.implementations.components[keystr as keyof IComponents]
      ))
    ) {
      throw new Error(
        `Implementation ${keystr} contract not found for version ${version} in network ${hre.network.name}`
      )
    }
  })
}
