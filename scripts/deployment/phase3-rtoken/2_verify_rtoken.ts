import hre from 'hardhat'

import { sh } from '../../deployment/deployment_utils'
import { getChainId } from '../../../common/blockchain-utils'
import { developmentChains, networkConfig } from '../../../common/configuration'
import {
  getDeploymentFile,
  getRTokenDeploymentFilename,
  IRTokenDeployments,
} from '../deployment_utils'

// Define the Token to deploy
const RTOKEN_NAME = 'RTKN'

let deployments: IRTokenDeployments

async function main() {
  // ********** Read config **********
  const chainId = await getChainId(hre)
  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${hre.network.name}`)
  }

  if (developmentChains.includes(hre.network.name)) {
    throw new Error(`Cannot verify contracts for development chain ${hre.network.name}`)
  }

  // Phase3
  deployments = <IRTokenDeployments>(
    getDeploymentFile(getRTokenDeploymentFilename(chainId, RTOKEN_NAME))
  )

  const prefix = chainId == 1 ? 'api.' : `api-${hre.network.name}.`
  const apiURL = `https://${prefix}etherscan.io/api?module=contract&action=verifyproxycontract&apikey=${process.env.ETHERSCAN_API_KEY}`

  // Define interface required for each component
  interface ComponentInfo {
    name: keyof typeof deployments.components
    desc: string
    contract: string
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
    },
    {
      name: 'basketHandler',
      desc: 'BasketHandler',
      contract: 'contracts/p1/BasketHandler.sol:BasketHandlerP1',
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
    const cmd = `curl -d "address=${deployments.components[cinf.name]}" "${apiURL}"`
    console.log(`Verifying ${cinf.desc}`, cmd, '\n')
    await sh(cmd)
    console.log('')

    // Sleep 10s
    await new Promise((r) => setTimeout(r, 10000))
  }

  /** ******************** Verify Proxied Main  ****************************************/
  console.log('Verifying Main')
  await sh(`curl -d "address=${deployments.main}" "${apiURL}"`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
