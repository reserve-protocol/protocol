/* eslint-disable no-process-exit */
import hre from 'hardhat'
import { getChainId } from '../common/blockchain-utils'
import { networkConfig } from '../common/configuration'
import { sh } from './deployment/deployment_utils'

async function main() {
  const [deployer] = await hre.ethers.getSigners()
  const chainId = await getChainId(hre)

  // Check if chain is supported
  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${hre.network.name}`)
  }

  console.log(`Starting full deployment on network ${hre.network.name} (${chainId})`)
  console.log(`Deployer account: ${deployer.address}\n`)

  // Part 1: Deploy and verify all contracts

  const allScripts = [
    'phase1-common/0_setup_deployments.ts',
    'phase1-common/1_deploy_libraries.ts',
    'phase1-common/2_verify_libraries.ts',
    'phase1-common/3_deploy_implementations.ts',
    'phase1-common/4_verify_implementations.ts',
    'phase1-common/5_deploy_rsrAsset.ts',
    'phase1-common/6_verify_rsrAsset.ts',
    'phase1-common/7_deploy_facade.ts',
    'phase1-common/8_verify_facade.ts',
    'phase1-common/9_deploy_deployer.ts',
    'phase1-common/10_verify_deployer.ts',
    'phase1-common/11_deploy_facadeWrite.ts',
    'phase1-common/12_verify_facadeWrite.ts',
    'phase2-assets/0_setup_deployments.ts',
    'phase2-assets/1_deploy_assets.ts',
    'phase2-assets/2_verify_assets.ts',
    'phase2-assets/3_deploy_collateral.ts',
    'phase2-assets/4_verify_collateral.ts',
    'phase3-rtoken/0_setup_deployments.ts',
    'phase3-rtoken/1_deploy_rtoken.ts',
    'phase3-rtoken/2_verify_rtoken.ts',
    'phase3-rtoken/3_setup_governance.ts',
    'phase3-rtoken/4_verify_governance.ts',
  ]

  for (const script of allScripts) {
    console.log(
      '\n===========================================\n',
      script,
      '\n===========================================\n'
    )

    if (script.indexOf('verify') >= 0) {
      console.log('\n', 'sleeping 20s before verification...', '\n')

      // Sleep
      await new Promise((r) => setTimeout(r, 20000))
    }

    await sh(`hardhat run scripts/deployment/${script}`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
