/* eslint-disable no-process-exit */
import hre from 'hardhat'
import { getChainId } from '../common/blockchain-utils'
import { networkConfig } from '../common/configuration'
import { sh } from './deployment/utils'

async function main() {
  const [deployer] = await hre.ethers.getSigners()
  const chainId = await getChainId(hre)

  // Check if chain is supported
  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${hre.network.name}`)
  }

  console.log(`Starting full deployment on network ${hre.network.name} (${chainId})`)
  console.log(`Deployer account: ${deployer.address}\n`)

  // Part 1/3 of the *overall* deployment process: Deploy all contracts
  // See `confirm.ts` for part 2

  const scripts = [
    'phase1-common/0_setup_deployments.ts',
    'phase1-common/1_deploy_libraries.ts',
    'phase1-common/2_deploy_implementations.ts',
    'phase1-common/3_deploy_rsrAsset.ts',
    'phase1-common/4_deploy_facade.ts',
    'phase1-common/5_deploy_deployer.ts',
    'phase1-common/6_deploy_facadeWrite.ts',
    'phase2-assets/0_setup_deployments.ts',
    'phase2-assets/1_deploy_assets.ts',
    'phase2-assets/2_deploy_collateral.ts',

    // These phase3 scripts will not deploy functional RTokens or Governance. They deploy bricked
    // versions that are used for verification only. Further deployment is left up to the Register.
    'phase3-rtoken/0_setup_deployments.ts',
    'phase3-rtoken/1_deploy_rtoken.ts',
    'phase3-rtoken/2_deploy_governance.ts',
  ]

  for (const script of scripts) {
    console.log('\n===========================================\n', script, '')
    await sh(`hardhat run scripts/deployment/${script}`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
