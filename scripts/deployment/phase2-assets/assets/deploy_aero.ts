import fs from 'fs'
import hre, { ethers } from 'hardhat'
import { getChainId } from '../../../../common/blockchain-utils'
import { baseL2Chains, networkConfig } from '../../../../common/configuration'
import { fp } from '../../../../common/numbers'
import {
  getDeploymentFile,
  getDeploymentFilename,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
  fileExists,
} from '../../common'
import { priceTimeout } from '../../utils'
import { Asset } from '../../../../typechain'

async function main() {
  // ==== Read Configuration ====
  const [burner] = await hre.ethers.getSigners()
  const chainId = await getChainId(hre)

  console.log(`Deploying AERO asset to network ${hre.network.name} (${chainId})
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

  // Only for Base
  if (baseL2Chains.includes(hre.network.name)) {
    /********  Deploy AERO asset **************************/
    const { asset: aeroAsset } = await hre.run('deploy-asset', {
      priceTimeout: priceTimeout.toString(),
      priceFeed: networkConfig[chainId].chainlinkFeeds.AERO,
      oracleError: fp('0.005').toString(), // 0.5%
      tokenAddress: networkConfig[chainId].tokens.AERO,
      maxTradeVolume: fp('1e6').toString(), // $1m,
      oracleTimeout: '86400', // 24 hr
    })
    await (<Asset>await ethers.getContractAt('Asset', aeroAsset)).refresh()

    assetCollDeployments.assets.AERO = aeroAsset
    assetCollDeployments.erc20s.AERO = networkConfig[chainId].tokens.AERO
    deployedAssets.push(aeroAsset.toString())
  } else {
    throw new Error(`Unsupported chainId: ${chainId}`)
  }

  /**************************************************************/

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

  console.log(`Deployed AERO asset to ${hre.network.name} (${chainId}):
    New deployments: ${deployedAssets}
    Deployment file: ${assetCollDeploymentFilename}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
