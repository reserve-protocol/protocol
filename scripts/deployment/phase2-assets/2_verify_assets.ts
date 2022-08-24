import hre from 'hardhat'

import { getChainId } from '../../../common/blockchain-utils'
import { developmentChains, networkConfig } from '../../../common/configuration'
import { ZERO_ADDRESS } from '../../../common/constants'
import { fp } from '../../../common/numbers'
import {
  getDeploymentFile,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
  IDeployments,
  getDeploymentFilename,
  getOracleTimeout,
  fileExists,
} from '../deployment_utils'

let deployments: IAssetCollDeployments

async function main() {
  // ********** Read config **********
  const chainId = await getChainId(hre)
  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${hre.network.name}`)
  }

  if (developmentChains.includes(hre.network.name)) {
    throw new Error(`Cannot verify contracts for development chain ${hre.network.name}`)
  }

  // Get phase1 deployment
  const phase1File = getDeploymentFilename(chainId)
  if (!fileExists(phase1File)) {
    throw new Error(`${phase1File} doesn't exist yet. Run phase 1`)
  }
  const phase1Deployment = <IDeployments>getDeploymentFile(phase1File)

  const assetCollDeploymentFilename = getAssetCollDeploymentFilename(chainId)
  deployments = <IAssetCollDeployments>getDeploymentFile(assetCollDeploymentFilename)

  /** ******************** Verify stkAAVE asset  ****************************************/
  console.time('Verifying Asset')
  await hre.run('verify:verify', {
    address: deployments.assets.stkAAVE,
    constructorArguments: [
      networkConfig[chainId].chainlinkFeeds.AAVE,
      networkConfig[chainId].tokens.stkAAVE,
      ZERO_ADDRESS,
      fp(chainId == 1 ? '1e4' : '0').toString(), // $10k,
      fp(chainId == 1 ? '1e6' : '0').toString(), // $1m,
      fp(chainId == 1 ? '10' : '1').toString(), // 10 StkAAVE
      fp(chainId == 1 ? '1e4' : '1e9').toString(), // 10,000 StkAAVE
      getOracleTimeout(chainId).toString(),
      phase1Deployment.oracleLib,
    ],
    contract: 'contracts/plugins/assets/Asset.sol:Asset',
  })
  console.timeEnd('Verifying Asset')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
