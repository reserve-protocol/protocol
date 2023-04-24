import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { IDeployments } from '../../scripts/deployment/common'

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
  }

  // Check implementations are defined
  if (
    !deployments.implementations.main ||
    !deployments.implementations.components.assetRegistry ||
    !deployments.implementations.components.backingManager ||
    !deployments.implementations.components.basketHandler ||
    !deployments.implementations.components.broker ||
    !deployments.implementations.components.distributor ||
    !deployments.implementations.components.furnace ||
    !deployments.implementations.components.rTokenTrader ||
    !deployments.implementations.components.rsrTrader ||
    !deployments.implementations.components.rToken ||
    !deployments.implementations.components.stRSR
  ) {
    throw new Error(
      `Missing deployed implementations for version ${version} in network ${hre.network.name}`
    )
  }
}
