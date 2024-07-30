/* eslint-disable no-process-exit */
import hre from 'hardhat'
import { getChainId } from '../common/blockchain-utils'
import { arbitrumL2Chains, baseL2Chains, networkConfig } from '../common/configuration'
import { sh } from './deployment/utils'

async function main() {
  const [deployer] = await hre.ethers.getSigners()
  const chainId = await getChainId(hre)

  if (hre.network.name == 'hardhat') {
    throw new Error(
      "Don't use network 'hardhat'.  If you are testing locally, make sure to run 'yarn devchain' in a separate terminal, and then deploy to 'localhost'."
    )
  }

  // Check if chain is supported
  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${hre.network.name}`)
  }

  console.log(`Starting full deployment on network ${hre.network.name} (${chainId})`)
  console.log(`Deployer account: ${deployer.address}\n`)

  // Part 1/3 of the *overall* deployment process: Deploy all contracts
  // See `confirm.ts` for part 2

  // Phase 1 -- Implementations
  const scripts = [
    'phase1-core/0_setup_deployments.ts',
    'phase1-core/1_deploy_libraries.ts',
    'phase1-core/2_deploy_implementations.ts',
    'phase1-core/3_deploy_rsrAsset.ts',
    'phase1-core/4_deploy_facade.ts',
    'phase1-core/5_deploy_deployer.ts',
    'phase1-core/6_deploy_facadeWrite.ts',
  ]

  // =============================================

  // Phase 1.5 -- Facets
  // To update the existing Facade, add new facets to the below list

  scripts.push(
    'phase1-facade/1_deploy_readFacet.ts',
    'phase1-facade/2_deploy_actFacet.ts',
    'phase1-facade/3_deploy_maxIssuable.ts'
  )

  // =============================================

  // Phase 2 - Assets/Collateral
  if (!baseL2Chains.includes(hre.network.name) && !arbitrumL2Chains.includes(hre.network.name)) {
    scripts.push(
      'phase2-assets/0_setup_deployments.ts',
      'phase2-assets/1_deploy_assets.ts',
      'phase2-assets/2_deploy_collateral.ts',
      'phase2-assets/collaterals/deploy_lido_wsteth_collateral.ts',
      'phase2-assets/collaterals/deploy_rocket_pool_reth_collateral.ts',
      'phase2-assets/collaterals/deploy_flux_finance_collateral.ts',
      'phase2-assets/collaterals/deploy_ctokenv3_usdc_collateral.ts',
      'phase2-assets/collaterals/deploy_convex_3pool_collateral.ts',
      'phase2-assets/collaterals/deploy_convex_paypool_collateral.ts',
      'phase2-assets/collaterals/deploy_convex_crvusd_usdc_collateral.ts',
      'phase2-assets/collaterals/deploy_convex_crvusd_usdt_collateral.ts',
      'phase2-assets/collaterals/deploy_convex_rToken_metapool_plugin.ts',
      'phase2-assets/collaterals/deploy_convex_stable_metapool_plugin.ts',
      'phase2-assets/collaterals/deploy_convex_ethplus_eth.ts',
      'phase2-assets/collaterals/deploy_stakedao_usdc_usdcplus.ts',
      'phase2-assets/collaterals/deploy_curve_stable_plugin.ts',
      'phase2-assets/collaterals/deploy_curve_rToken_metapool_plugin.ts',
      'phase2-assets/collaterals/deploy_curve_stable_metapool_plugin.ts',
      'phase2-assets/collaterals/deploy_dsr_sdai.ts',
      'phase2-assets/collaterals/deploy_cbeth_collateral.ts',
      'phase2-assets/collaterals/deploy_morpho_aavev2_plugin.ts',
      'phase2-assets/collaterals/deploy_aave_v3_usdc.ts',
      'phase2-assets/collaterals/deploy_aave_v3_pyusd.ts',
      'phase2-assets/collaterals/deploy_yearn_v2_curve_usdc.ts',
      'phase2-assets/collaterals/deploy_yearn_v2_curve_usdp.ts',
      'phase2-assets/collaterals/deploy_sfrax.ts',
      'phase2-assets/collaterals/deploy_sfrax_eth.ts',
      'phase2-assets/collaterals/deploy_steakusdc.ts',
      'phase2-assets/collaterals/deploy_steakpyusd.ts',
      'phase2-assets/collaterals/deploy_bbusdt.ts',
      'phase2-assets/collaterals/deploy_re7weth.ts',
      'phase2-assets/assets/deploy_crv.ts',
      'phase2-assets/assets/deploy_cvx.ts'
    )
  } else if (chainId == '8453' || chainId == '84531') {
    // Base L2 chains
    scripts.push(
      'phase2-assets/0_setup_deployments.ts',
      'phase2-assets/1_deploy_assets.ts',
      'phase2-assets/2_deploy_collateral.ts',
      'phase2-assets/collaterals/deploy_cbeth_collateral.ts',
      'phase2-assets/collaterals/deploy_ctokenv3_usdc_collateral.ts',
      'phase2-assets/collaterals/deploy_aave_v3_usdc.ts',
      'phase2-assets/collaterals/deploy_lido_wsteth_collateral.ts',
      'phase2-assets/collaterals/deploy_cbeth_collateral.ts',
      'phase2-assets/assets/deploy_stg.ts'
    )
  } else if (chainId == '42161' || chainId == '421614') {
    // Arbitrum One
    scripts.push(
      'phase2-assets/0_setup_deployments.ts',
      'phase2-assets/1_deploy_assets.ts',
      'phase2-assets/2_deploy_collateral.ts',
      'phase2-assets/collaterals/deploy_aave_v3_usdc.ts',
      'phase2-assets/collaterals/deploy_aave_v3_usdt.ts',
      'phase2-assets/collaterals/deploy_ctokenv3_usdc_collateral.ts',
      'phase2-assets/collaterals/deploy_convex_crvusd_usdc_collateral.ts',
      'phase2-assets/collaterals/deploy_convex_crvusd_usdt_collateral.ts',
      'phase2-assets/collaterals/deploy_usdm.ts',
      'phase2-assets/assets/deploy_arb.ts'
    )
  }

  // ===============================================

  // Phase 3 - RTokens
  // These phase3 scripts will not deploy functional RTokens or Governance. They deploy bricked
  // versions that are used for verification only. Further deployment is left up to the Register.
  // 'phase3-rtoken/0_setup_deployments.ts',
  // 'phase3-rtoken/1_deploy_rtoken.ts',
  // 'phase3-rtoken/2_deploy_governance.ts',
  // We can uncomment and prepare this section whenever we update governance, which will be rarely

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
