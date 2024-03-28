import fs from 'fs'
import { BigNumber } from 'ethers'
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
import { priceTimeout } from '../../utils'
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

  const oracleErrors: { [key: string]: BigNumber } = {
    '1': fp('0.02'), // 2%
    '42161': fp('0.0005'), // 0.05%
  }
  const oracleError = oracleErrors[chainId]

  /********  Deploy ARB asset **************************/
  const { asset: crvAsset } = await hre.run('deploy-asset', {
    priceTimeout: priceTimeout.toString(),
    priceFeed: networkConfig[chainId].chainlinkFeeds.ARB,
    oracleError: oracleError.toString(),
    tokenAddress: networkConfig[chainId].tokens.ARB,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: '86400', // 24 hr
  })
  await (<Asset>await ethers.getContractAt('Asset', crvAsset)).refresh()

  assetCollDeployments.assets.ARB = crvAsset
  assetCollDeployments.erc20s.ARB = networkConfig[chainId].tokens.ARB
  deployedAssets.push(crvAsset.toString())

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
