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
} from '../../common'
import { getArbOracleError, priceTimeout } from '../../utils'
import { Asset } from '../../../../typechain'

// Mainnet + Arbitrum

async function main() {
  // ==== Read Configuration ====
  const [burner] = await hre.ethers.getSigners()
  const chainId = await getChainId(hre)

  console.log(`Deploying ARB asset to network ${hre.network.name} (${chainId})
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

  const oracleError = getArbOracleError(hre.network.name)

  /********  Deploy ARB asset **************************/
  const { asset: arbAsset } = await hre.run('deploy-asset', {
    priceTimeout: priceTimeout.toString(),
    priceFeed: networkConfig[chainId].chainlinkFeeds.ARB,
    oracleError: oracleError.toString(),
    tokenAddress: networkConfig[chainId].tokens.ARB,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: '86400', // 24 hr
  })
  await (<Asset>await ethers.getContractAt('Asset', arbAsset)).refresh()

  assetCollDeployments.assets.ARB = arbAsset
  assetCollDeployments.erc20s.ARB = networkConfig[chainId].tokens.ARB
  deployedAssets.push(arbAsset.toString())

  /**************************************************************/

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

  console.log(`Deployed ARB asset to ${hre.network.name} (${chainId}):
    New deployments: ${deployedAssets}
    Deployment file: ${assetCollDeploymentFilename}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
