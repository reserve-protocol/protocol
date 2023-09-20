import hre from 'hardhat'

import { getChainId } from '../../common/blockchain-utils'
import { developmentChains, networkConfig } from '../../common/configuration'
import { getDeploymentFile, getDeploymentFilename, IDeployments } from '../deployment/common'
import { verifyContract } from '../deployment/utils'

let deployments: IDeployments

async function main() {
  // ********** Read config **********
  const chainId = await getChainId(hre)
  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${hre.network.name}`)
  }

  if (developmentChains.includes(hre.network.name)) {
    throw new Error(`Cannot verify contracts for development chain ${hre.network.name}`)
  }

  deployments = <IDeployments>getDeploymentFile(getDeploymentFilename(chainId))

  /** ******************** Verify Main implementation ****************************************/
  await verifyContract(
    chainId,
    deployments.implementations.main,
    [],
    'contracts/p1/Main.sol:MainP1'
  )

  // /** ******************** Verify GnosisTrade implementation ****************************************/
  await verifyContract(
    chainId,
    deployments.implementations.trading.gnosisTrade,
    [],
    'contracts/plugins/trading/GnosisTrade.sol:GnosisTrade'
  )

  // /** ******************** Verify DutchTrade implementation ****************************************/
  await verifyContract(
    chainId,
    deployments.implementations.trading.dutchTrade,
    [],
    'contracts/plugins/trading/DutchTrade.sol:DutchTrade'
  )

  /** ******************** Verify Components  ****************************************/
  // Define interface required for each component
  interface ComponentInfo {
    name: keyof typeof deployments.implementations.components
    desc: string
    contract: string
    libraries?: { [key: string]: string }
  }

  // Components to verify
  const compInfos: ComponentInfo[] = [
    {
      name: 'assetRegistry',
      desc: 'AssetRegistry',
      contract: 'contracts/p1/AssetRegistry.sol:AssetRegistryP1',
    },
    {
      name: 'backingManager',
      desc: 'BackingManager',
      contract: 'contracts/p1/BackingManager.sol:BackingManagerP1',
      libraries: {
        RecollateralizationLibP1: deployments.tradingLib,
      },
    },
    {
      name: 'basketHandler',
      desc: 'BasketHandler',
      contract: 'contracts/p1/BasketHandler.sol:BasketHandlerP1',
      libraries: {
        BasketLibP1: deployments.basketLib,
      },
    },
    {
      name: 'broker',
      desc: 'Broker',
      contract: 'contracts/p1/Broker.sol:BrokerP1',
    },
    {
      name: 'distributor',
      desc: 'Distributor',
      contract: 'contracts/p1/Distributor.sol:DistributorP1',
    },
    {
      name: 'furnace',
      desc: 'Furnace',
      contract: 'contracts/p1/Furnace.sol:FurnaceP1',
    },
    {
      name: 'rsrTrader',
      desc: 'RSR / RToken Traders',
      contract: 'contracts/p1/RevenueTrader.sol:RevenueTraderP1',
    },
    {
      name: 'rToken',
      desc: 'RToken',
      contract: 'contracts/p1/RToken.sol:RTokenP1',
    },
    {
      name: 'stRSR',
      desc: 'StRSR',
      contract: 'contracts/p1/StRSRVotes.sol:StRSRP1Votes',
    },
  ]

  for (const cinf of compInfos) {
    await verifyContract(
      chainId,
      deployments.implementations.components[cinf.name],
      [],
      cinf.contract,
      cinf.libraries
    )
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
