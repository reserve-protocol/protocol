import fs from 'fs'
import hre, { ethers } from 'hardhat'

import { getChainId } from '../../../common/blockchain-utils'
import { networkConfig } from '../../../common/configuration'
import { ZERO_ADDRESS } from '../../../common/constants'
import { fp } from '../../../common/numbers'
import { getDeploymentFile, getDeploymentFilename, IDeployments } from '../common'
import { priceTimeout, validateImplementations } from '../utils'
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

  await validateImplementations(deployments)

  // ******************** Deploy RSR Asset ****************************************/
  const { asset: rsrAssetAddr } = await hre.run('deploy-asset', {
    priceTimeout: priceTimeout.toString(),
    priceFeed: deployments.prerequisites.RSR_FEED,
    oracleError: fp('0.02').toString(), // 2%
    tokenAddress: deployments.prerequisites.RSR,
    rewardToken: ZERO_ADDRESS,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: '86400', // 24h
  })

  rsrAsset = <Asset>await ethers.getContractAt('Asset', rsrAssetAddr)
  await rsrAsset.refresh()

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
