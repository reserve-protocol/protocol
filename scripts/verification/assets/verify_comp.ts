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

  const asset = await hre.ethers.getContractAt('Asset', deployments.assets.COMP!)

  /** ******************** Verify COMP Asset ****************************************/
  await verifyContract(
    chainId,
    deployments.assets.COMP,
    [
      await asset.priceTimeout(),
      await asset.chainlinkFeed(),
      fp('0.01').toString(), // 1%
      await asset.erc20(),
      await asset.maxTradeVolume(),
      await asset.oracleTimeout(),
    ],
    'contracts/plugins/assets/Asset.sol:Asset'
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
