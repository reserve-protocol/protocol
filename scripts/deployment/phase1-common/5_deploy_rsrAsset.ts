import fs from 'fs'
import hre, { ethers } from 'hardhat'

import { getChainId } from '../../../common/blockchain-utils'
import { networkConfig } from '../../../common/configuration'
import { ZERO_ADDRESS } from '../../../common/constants'
import { bn, fp } from '../../../common/numbers'
import {
  getDeploymentFile,
  getDeploymentFilename,
  IDeployments,
  validateImplementations,
} from '../deployment_utils'
import { Asset } from '../../../typechain'

let rsrAsset: Asset

async function main() {
  // ==== Read Configuration ====
  const [burner] = await hre.ethers.getSigners()
  const chainId = await getChainId(hre)

  console.log(`Deploying Deployer to network ${hre.network.name} (${chainId})
    with burner account: ${burner.address}`)

  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${hre.network.name}`)
  }

  const deploymentFilename = getDeploymentFilename(chainId)
  const deployments = <IDeployments>getDeploymentFile(deploymentFilename)

  await validateImplementations(deployments)

  // ******************** Deploy RSR Asset ****************************************/
  const { asset: rsrAssetAddr } = await hre.run('deploy-asset', {
    priceFeed: deployments.prerequisites.RSR_FEED,
    tokenAddress: deployments.prerequisites.RSR,
    rewardToken: ZERO_ADDRESS,
    maxTradeVolume: fp('1e6').toString(), // max trade volume
    maxOracleTimeout: bn('86400').toString(), // 1 day
  })

  rsrAsset = <Asset>await ethers.getContractAt('Asset', rsrAssetAddr)

  // Write temporary deployments file
  deployments.rsrAsset = rsrAsset.address
  fs.writeFileSync(deploymentFilename, JSON.stringify(deployments, null, 2))

  console.log(`Deployed to ${hre.network.name} (${chainId})
    RSR Asset:  ${rsrAsset.address}
    Deployment file: ${deploymentFilename}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
