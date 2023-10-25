import fs from 'fs'
import hre, { ethers } from 'hardhat'
import { getChainId } from '../../../../common/blockchain-utils'
import { networkConfig } from '../../../../common/configuration'
import { fp } from '../../../../common/numbers'
import {
  getDeploymentFile,
  getDeploymentFilename,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
  fileExists,
} from '../../../deployment/common'
import { priceTimeout } from '../../../deployment/utils'
import { Asset } from '../../../../typechain'

async function main() {
  // ==== Read Configuration ====
  const [burner] = await hre.ethers.getSigners()
  const chainId = await getChainId(hre)

  console.log(`Deploying CRV asset to network ${hre.network.name} (${chainId})
    with burner account: ${burner.address}`)

  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${hre.network.name}`)
  }

  // Get phase1 deployment
  const phase1File = getDeploymentFilename(chainId)
  if (!fileExists(phase1File)) {
    throw new Error(`${phase1File} doesn't exist yet. Run phase 1`)
  }
  // Check previous step completed
  const assetCollDeploymentFilename = getAssetCollDeploymentFilename(chainId)
  const assetCollDeployments = <IAssetCollDeployments>getDeploymentFile(assetCollDeploymentFilename)

  const deployedAssets: string[] = []

  /********  Deploy CRV asset **************************/
  const { asset: crvAsset } = await hre.run('deploy-asset', {
    priceTimeout: priceTimeout.toString(),
    priceFeed: networkConfig[chainId].chainlinkFeeds.CRV,
    oracleError: fp('0.01').toString(), // 1%
    tokenAddress: networkConfig[chainId].tokens.CRV,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: '86400', // 24 hr
  })
  await (<Asset>await ethers.getContractAt('Asset', crvAsset)).refresh()

  assetCollDeployments.assets.CRV = crvAsset
  assetCollDeployments.erc20s.CRV = networkConfig[chainId].tokens.CRV
  deployedAssets.push(crvAsset.toString())

  /**************************************************************/

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

  console.log(`Deployed CRV asset to ${hre.network.name} (${chainId}):
    New deployments: ${deployedAssets}
    Deployment file: ${assetCollDeploymentFilename}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
