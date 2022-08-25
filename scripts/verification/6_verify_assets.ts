import hre from 'hardhat'

import { getChainId } from '../../common/blockchain-utils'
import { developmentChains, networkConfig } from '../../common/configuration'
import { ZERO_ADDRESS } from '../../common/constants'
import { fp } from '../../common/numbers'
import {
  getDeploymentFile,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
  getOracleTimeout,
  verifyContract,
} from '../deployment/deployment_utils'

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

  const assetCollDeploymentFilename = getAssetCollDeploymentFilename(chainId)
  deployments = <IAssetCollDeployments>getDeploymentFile(assetCollDeploymentFilename)

  /** ******************** Verify stkAAVE asset  ****************************************/
  await verifyContract(
    chainId,
    deployments.assets.stkAAVE,
    [
      networkConfig[chainId].chainlinkFeeds.AAVE,
      networkConfig[chainId].tokens.stkAAVE,
      ZERO_ADDRESS,
      {
        minVal: fp(chainId == 1 ? '1e4' : '0').toString(), // $10k,
        maxVal: fp(chainId == 1 ? '1e6' : '0').toString(), // $1m,
        minAmt: fp(chainId == 1 ? '10' : '1').toString(), // 10 StkAAVE
        maxAmt: fp(chainId == 1 ? '1e4' : '1e9').toString(), // 10,000 StkAAVE
      },
      getOracleTimeout(chainId).toString(),
    ],
    'contracts/plugins/assets/Asset.sol:Asset'
  )
  /** ******************** Verify RTokenAsset  ****************************************/
  await verifyContract(
    chainId,
    deployments.assets.stkAAVE,
    [
      networkConfig[chainId].chainlinkFeeds.AAVE,
      networkConfig[chainId].tokens.stkAAVE,
      ZERO_ADDRESS,
      {
        minVal: fp(chainId == 1 ? '1e4' : '0').toString(), // $10k,
        maxVal: fp(chainId == 1 ? '1e6' : '0').toString(), // $1m,
        minAmt: fp(chainId == 1 ? '10' : '1').toString(), // 10 StkAAVE
        maxAmt: fp(chainId == 1 ? '1e4' : '1e9').toString(), // 10,000 StkAAVE
      },
      getOracleTimeout(chainId).toString(),
    ],
    'contracts/plugins/assets/Asset.sol:Asset'
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
