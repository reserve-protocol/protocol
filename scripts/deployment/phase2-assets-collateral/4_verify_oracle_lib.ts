import hre from 'hardhat'

import { getChainId } from '../../../common/blockchain-utils'
import { developmentChains, networkConfig } from '../../../common/configuration'
import { getDeploymentFile, getAssetCollDeploymentFilename, IAssetCollDeployments } from '../deployment_utils'

let assetCollDeployments: IAssetCollDeployments

async function main() {
  // ********** Read config **********
  const chainId = await getChainId(hre)
  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${hre.network.name}`)
  }

  if (developmentChains.includes(hre.network.name)) {
    throw new Error(`Cannot verify contracts for development chain ${hre.network.name}`)
  }

  assetCollDeployments = <IAssetCollDeployments>getDeploymentFile(getAssetCollDeploymentFilename(chainId))

  /** ******************** Verify OracleLib ****************************************/
  console.time('Verifying OracleLib')
  await hre.run('verify:verify', {
    address: assetCollDeployments.oracleLib,
    constructorArguments: [],
    contract: 'contracts/plugins/assets/OracleLib.sol:OracleLib',
  })
  console.timeEnd('Verifying OracleLib')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})