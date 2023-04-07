/* eslint-disable no-process-exit */
import hre from 'hardhat'
import { getChainId } from '../common/blockchain-utils'
import { developmentChains, networkConfig } from '../common/configuration'
import { sh } from './deployment/utils'
import {
  getDeploymentFile,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
  IDeployments,
  getDeploymentFilename,
} from './deployment/common'

async function main() {
  const chainId = await getChainId(hre)

  // Check if chain is supported
  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${hre.network.name}`)
  }

  if (developmentChains.includes(hre.network.name)) {
    throw new Error(`Cannot verify contracts for development chain ${hre.network.name}`)
  }

  const phase1Deployments = <IDeployments>getDeploymentFile(getDeploymentFilename(chainId))
  const assetCollDeploymentFilename = getAssetCollDeploymentFilename(chainId)
  const assetDeployments = <IAssetCollDeployments>getDeploymentFile(assetCollDeploymentFilename)
  if (!phase1Deployments || !assetDeployments) throw new Error('Missing deployments')

  console.log(`Starting full verification on network ${hre.network.name} (${chainId})`)

  // Part 3/3 of the *overall* deployment process: Verification

  // This process is intelligent enough that it can be run on all verify scripts,
  // even if some portions have already been verified

  const scripts = [
    '0_verify_libraries.ts',
    '1_verify_implementations.ts',
    '2_verify_rsrAsset.ts',
    '3_verify_deployer.ts',
    '4_verify_facade.ts',
    '5_verify_facadeWrite.ts',
    '6_verify_collateral.ts',
    '7_verify_rToken.ts',
    '8_verify_governance.ts',
    'collateral-plugins/verify_convex_stable_plugin.ts',
    'collateral-plugins/verify_convex_stable_metapool_plugin.ts',
    'collateral-plugins/verify_convex_volatile_plugin.ts',
    'collateral-plugins/verify_eusd_fraxbp_collateral.ts',
    'collateral-plugins/verify_cusdcv3_collateral.ts',
    'collateral-plugins/verify_reth_collateral.ts',
    'collateral-plugins/verify_wsteth_collateral.ts',
  ]

  for (const script of scripts) {
    console.log('\n===========================================\n', script, '')
    await sh(`hardhat run scripts/verification/${script}`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
