import hre from 'hardhat'

import { getChainId } from '../../../common/blockchain-utils'
import { developmentChains, networkConfig } from '../../../common/configuration'
import {
  getDeploymentFile,
  getRTokenDeploymentFilename,
  IRTokenDeployments,
} from '../deployment_utils'

let rTokenDeployments: IRTokenDeployments

// Define the Token to use
const RTOKEN_NAME = 'RTKN'

async function main() {
  // ********** Read config **********
  const chainId = await getChainId(hre)
  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${hre.network.name}`)
  }

  if (developmentChains.includes(hre.network.name)) {
    throw new Error(`Cannot verify contracts for development chain ${hre.network.name}`)
  }

  rTokenDeployments = <IRTokenDeployments>(
    getDeploymentFile(getRTokenDeploymentFilename(chainId, RTOKEN_NAME))
  )

  await hre.tally.publishDao({
    name: 'My DAO',
    contracts: {
      governor: {
        address: rTokenDeployments.governance,
        type: 'OPENZEPPELINGOVERNOR',
      },
      token: {
        address: rTokenDeployments.components.stRSR,
        type: 'ERC20',
      },
    },
  })

  console.log(`Published DAO to ${hre.network.name} (${chainId}): ${rTokenDeployments.governance}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
