import hre from 'hardhat'

import { getChainId } from '../../common/blockchain-utils'
import { developmentChains, networkConfig } from '../../common/configuration'
import { getDeploymentFile, getDeploymentFilename, IDeployments } from '../deployment/common'
import { verifyContract } from '../deployment/utils'
import { fp } from '../../common/numbers'

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

  const asset = await hre.ethers.getContractAt('Asset', deployments.rsrAsset)

  /** ******************** Verify RSR Asset ****************************************/
  await verifyContract(
    chainId,
    deployments.rsrAsset,
    [
      (await asset.priceTimeout()).toString(),
      await asset.chainlinkFeed(),
      fp('0.02').toString(),
      await asset.erc20(),
      (await asset.maxTradeVolume()).toString(),
      (await asset.oracleTimeout()).toString(),
    ],
    'contracts/plugins/assets/Asset.sol:Asset'
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
