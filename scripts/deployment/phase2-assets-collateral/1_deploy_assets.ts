import fs from 'fs'
import hre from 'hardhat'
import { getChainId } from '../../../common/blockchain-utils'
import { networkConfig } from '../../../common/configuration'
import { fp } from '../../../common/numbers'
import {
  getDeploymentFile,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
} from '../deployment_utils'

async function main() {
  // ==== Read Configuration ====
  const [burner] = await hre.ethers.getSigners()
  const chainId = await getChainId(hre)

  console.log(`Deploying Assets to network ${hre.network.name} (${chainId})
    with burner account: ${burner.address}`)

  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${hre.network.name}`)
  }

  // Check previous step completed
  const assetCollDeploymentFilename = getAssetCollDeploymentFilename(chainId)
  const assetCollDeployments = <IAssetCollDeployments>getDeploymentFile(assetCollDeploymentFilename)

  let deployedAssets: string[] = []

  /********  Deploy StkAAVE Asset **************************/
  const { stkAAVEAsset } = await hre.run('deploy-asset-stkaave', {
    stkAAVE: networkConfig[chainId].tokens.stkAAVE,
    maxTradeVolume: fp('1e6').toString(), // max trade volume
    comptroller: networkConfig[chainId].COMPTROLLER,
    aaveLendingPool: networkConfig[chainId].AAVE_LENDING_POOL,
  })

  assetCollDeployments.assets.stkAAVE = stkAAVEAsset
  deployedAssets.push(stkAAVEAsset.toString())

  /********  Deploy Comp Asset **************************/
  const { compoundAsset: compAsset } = await hre.run('deploy-compound-asset', {
    tokenAddress: networkConfig[chainId].tokens.COMP,
    maxTradeVolume: fp('1e6').toString(), // max trade volume
    comptroller: networkConfig[chainId].COMPTROLLER,
  })

  assetCollDeployments.assets.COMP = compAsset
  deployedAssets.push(compAsset.toString())

  /********  Deploy Weth Asset **************************/
  const { aaveAsset: wethAsset } = await hre.run('deploy-aave-asset', {
    tokenAddress: networkConfig[chainId].tokens.WETH,
    maxTradeVolume: fp('1e6').toString(), // max trade volume
    comptroller: networkConfig[chainId].COMPTROLLER,
    aaveLendingPool: networkConfig[chainId].AAVE_LENDING_POOL,
  })

  assetCollDeployments.assets.WETH = wethAsset
  deployedAssets.push(wethAsset.toString())

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
