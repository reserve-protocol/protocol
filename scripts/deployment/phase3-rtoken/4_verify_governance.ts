import hre from 'hardhat'

import { getChainId } from '../../../common/blockchain-utils'
import { developmentChains, networkConfig } from '../../../common/configuration'
import {
  getDeploymentFile,
  getRTokenDeploymentFilename,
  IRTokenDeployments,
} from '../deployment_utils'

let rTokendeployments: IRTokenDeployments

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

  rTokendeployments = <IRTokenDeployments>(
    getDeploymentFile(getRTokenDeploymentFilename(chainId, RTOKEN_NAME))
  )

  /********************** Verify Governance ****************************************/
  console.time('Verifying Governance')
  await hre.run('verify:verify', {
    address: rTokendeployments.governance,
    constructorArguments: [], // TODO complete params
    contract: 'contracts/plugins/Governance.sol:Governance',
  })
  console.timeEnd('Verifying Governance')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
