import hre from 'hardhat'

import { getChainId } from '../../../common/blockchain-utils'
import { developmentChains, networkConfig } from '../../../common/configuration'
import {
  getAssetCollDeploymentFilename,
  getDeploymentFile,
  IAssetCollDeployments,
} from '../../deployment/common'
import { verifyContract } from '../../deployment/utils'
import { fp } from '../../../common/numbers'

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

  deployments = <IAssetCollDeployments>getDeploymentFile(getAssetCollDeploymentFilename(chainId))

  const kingAsset = await hre.ethers.getContractAt('KingAsset', deployments.assets.KING!)

  /** ******************** Verify KING Asset ****************************************/
  await verifyContract(
    chainId,
    deployments.assets.KING,
    [
      (await kingAsset.priceTimeout()).toString(),
      await kingAsset.chainlinkFeed(),
      fp('0.04').toString(), // 4% oracle error
      await kingAsset.erc20(),
      (await kingAsset.maxTradeVolume()).toString(),
      (await kingAsset.oracleTimeout()).toString(),
    ],
    'contracts/plugins/assets/etherfi/KingAsset.sol:KingAsset'
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
