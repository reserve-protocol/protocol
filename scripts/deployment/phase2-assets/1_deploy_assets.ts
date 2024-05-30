import fs from 'fs'
import hre, { ethers } from 'hardhat'
import { getChainId } from '../../../common/blockchain-utils'
import { arbitrumL2Chains, baseL2Chains, networkConfig } from '../../../common/configuration'
import { fp } from '../../../common/numbers'
import {
  getDeploymentFile,
  getDeploymentFilename,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
  fileExists,
} from '../../deployment/common'
import { priceTimeout } from '../../deployment/utils'
import { Asset } from '../../../typechain'

async function main() {
  // ==== Read Configuration ====
  const [burner] = await hre.ethers.getSigners()
  const chainId = await getChainId(hre)

  console.log(`Deploying Assets to network ${hre.network.name} (${chainId})
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

  /********  Deploy StkAAVE Asset **************************/
  if (!baseL2Chains.includes(hre.network.name) && !arbitrumL2Chains.includes(hre.network.name)) {
    const { asset: stkAAVEAsset } = await hre.run('deploy-asset', {
      priceTimeout: priceTimeout.toString(),
      priceFeed: networkConfig[chainId].chainlinkFeeds.AAVE,
      oracleError: fp('0.01').toString(), // 1%
      tokenAddress: networkConfig[chainId].tokens.stkAAVE,
      maxTradeVolume: fp('1e6').toString(), // $1m,
      oracleTimeout: '3600', // 1 hr
    })
    await (<Asset>await ethers.getContractAt('Asset', stkAAVEAsset)).refresh()

    assetCollDeployments.assets.stkAAVE = stkAAVEAsset
    assetCollDeployments.erc20s.stkAAVE = networkConfig[chainId].tokens.stkAAVE
    deployedAssets.push(stkAAVEAsset.toString())
  }

  const oracleError = arbitrumL2Chains.includes(hre.network.name) ? fp('0.005') : fp('0.01')

  /********  Deploy Comp Asset **************************/
  const { asset: compAsset } = await hre.run('deploy-asset', {
    priceTimeout: priceTimeout.toString(),
    priceFeed: networkConfig[chainId].chainlinkFeeds.COMP,
    oracleError: oracleError.toString(), // 1%
    tokenAddress: networkConfig[chainId].tokens.COMP,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: '3600', // 1 hr
  })
  await (<Asset>await ethers.getContractAt('Asset', compAsset)).refresh()

  assetCollDeployments.assets.COMP = compAsset
  assetCollDeployments.erc20s.COMP = networkConfig[chainId].tokens.COMP
  deployedAssets.push(compAsset.toString())

  /**************************************************************/

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

  console.log(`Deployed assets to ${hre.network.name} (${chainId}):
    New deployments: ${deployedAssets}
    Deployment file: ${assetCollDeploymentFilename}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
