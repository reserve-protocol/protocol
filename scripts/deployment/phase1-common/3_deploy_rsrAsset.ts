import fs from 'fs'
import hre, { ethers } from 'hardhat'

import { getChainId } from '../../../common/blockchain-utils'
import { networkConfig } from '../../../common/configuration'
import { ZERO_ADDRESS } from '../../../common/constants'
import { fp } from '../../../common/numbers'
import {
  getDeploymentFile,
  getDeploymentFilename,
  IDeployments,
  validateImplementations,
  getOracleTimeout,
} from '../deployment_utils'
import { Asset } from '../../../typechain'

let rsrAsset: Asset

async function main() {
  // ==== Read Configuration ====
  const [burner] = await hre.ethers.getSigners()
  const chainId = await getChainId(hre)

  console.log(`Deploying RSR asset to network ${hre.network.name} (${chainId})
    with burner account: ${burner.address}`)

  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${hre.network.name}`)
  }

  const deploymentFilename = getDeploymentFilename(chainId)
  const deployments = <IDeployments>getDeploymentFile(deploymentFilename)
  const tradingRange = {
    minVal: fp(chainId == 1 ? '1e4' : '0'), // $10k
    maxVal: fp(chainId == 1 ? '1e6' : '0'), // $1m,
    minAmt: fp(chainId == 1 ? '1e6' : '1'), // 1M RSR
    maxAmt: fp(chainId == 1 ? '1e8' : '1e9'), // 100M RSR,
  }

  await validateImplementations(deployments)

  // ******************** Deploy RSR Asset ****************************************/
  const { asset: rsrAssetAddr } = await hre.run('deploy-asset', {
    priceFeed: deployments.prerequisites.RSR_FEED,
    tokenAddress: deployments.prerequisites.RSR,
    rewardToken: ZERO_ADDRESS,
    tradingValMin: tradingRange.minVal.toString(),
    tradingValMax: tradingRange.maxVal.toString(),
    tradingAmtMin: tradingRange.minAmt.toString(),
    tradingAmtMax: tradingRange.maxAmt.toString(),
    oracleTimeout: getOracleTimeout(chainId).toString(),
    oracleLib: deployments.oracleLib,
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
