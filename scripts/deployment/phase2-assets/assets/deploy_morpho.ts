import fs from 'fs'
import hre from 'hardhat'
import { getChainId } from '../../../../common/blockchain-utils'
import { arbitrumL2Chains, baseL2Chains, networkConfig } from '../../../../common/configuration'
import {
  getDeploymentFile,
  getDeploymentFilename,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
  fileExists,
} from '../../../deployment/common'
import { MorphoAsset } from '../../../../typechain'
import { priceTimeout } from '../../../deployment/utils'
import {
  MORPHO_WETH_POOL_030,
  MORPHO_ORACLE_ERROR,
  ETH_ORACLE_TIMEOUT,
  MORPHO_TWAP_WINDOW,
  MORPHO_MAX_TRADE_VOLUME,
} from '../../../../test/plugins/individual-collateral/meta-morpho/constants'

// Approximate mainnet block time, used only to sanity-check the pool's observation buffer
const BLOCK_TIME = 12

async function main() {
  // ==== Read Configuration ====
  const [deployer] = await hre.ethers.getSigners()
  const chainId = await getChainId(hre)

  console.log(`Deploying MORPHO asset to network ${hre.network.name} (${chainId})
    with burner account: ${deployer.address}`)

  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${hre.network.name}`)
  }

  // Only exists on Mainnet: the MORPHO/WETH Uniswap V3 pool this prices against is mainnet-only.
  // Base has a real Chainlink MORPHO/USD feed and should use a plain Asset instead.
  if (baseL2Chains.includes(hre.network.name) || arbitrumL2Chains.includes(hre.network.name)) {
    throw new Error(`Invalid network ${hre.network.name} - only available on Mainnet`)
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

  const erc20 = networkConfig[chainId].tokens.MORPHO
  if (!erc20) {
    throw new Error(`Missing MORPHO token address for chain ${chainId}`)
  }

  /********  Pre-flight: the pool must retain MORPHO_TWAP_WINDOW of observations  ****************/

  // MorphoAsset's constructor already probes observe(MORPHO_TWAP_WINDOW) and reverts if it cannot be
  // served right now. But a pool traded in consecutive blocks can evict history later, so also
  // warn if the observation buffer is too small to guarantee the window under heavy trading.
  const pool = await hre.ethers.getContractAt('IUniswapV3Pool', MORPHO_WETH_POOL_030)
  const slot0 = await pool.slot0()
  const requiredCardinality = Math.ceil(MORPHO_TWAP_WINDOW / BLOCK_TIME)
  console.log(`
    Uniswap V3 pool:          ${MORPHO_WETH_POOL_030}
    observationCardinality:   ${slot0.observationCardinality}
    ...Next:                  ${slot0.observationCardinalityNext}
    required for ${MORPHO_TWAP_WINDOW}s window: ${requiredCardinality}`)

  if (slot0.observationCardinalityNext < requiredCardinality) {
    console.log(`
    *** WARNING ***
    observationCardinalityNext (${
      slot0.observationCardinalityNext
    }) is below the ${requiredCardinality}
    observations needed to guarantee a ${MORPHO_TWAP_WINDOW}s TWAP if the pool is traded every block.
    The asset will price correctly today, but ~${slot0.observationCardinality} swaps in consecutive
    blocks would evict the history and make it temporarily unpriced.

    Fix (permissionless, anyone can call):
      ${MORPHO_WETH_POOL_030}.increaseObservationCardinalityNext(${requiredCardinality * 2})

    Note cardinality grows only as new observations are written, so do this well in advance.
`)
  }

  /********  Deploy MORPHO asset  **************************/

  const MorphoAssetFactory = await hre.ethers.getContractFactory('MorphoAsset')
  const morphoAsset = <MorphoAsset>await MorphoAssetFactory.connect(deployer).deploy(
    priceTimeout,
    networkConfig[chainId].chainlinkFeeds.ETH!, // {UoA/quoteTok} -- ETH/USD
    MORPHO_ORACLE_ERROR.toString(),
    erc20,
    MORPHO_MAX_TRADE_VOLUME.toString(),
    ETH_ORACLE_TIMEOUT,
    MORPHO_WETH_POOL_030,
    networkConfig[chainId].tokens.WETH!,
    MORPHO_TWAP_WINDOW
  )
  await morphoAsset.deployed()
  await (await morphoAsset.refresh({ gasLimit: 3_000_000 })).wait()

  const [low, high] = await morphoAsset.price()
  console.log(`
    Deployed MorphoAsset:     ${morphoAsset.address}
    price low/high:           ${hre.ethers.utils.formatUnits(
      low,
      18
    )} / ${hre.ethers.utils.formatUnits(high, 18)}`)

  assetCollDeployments.assets.MORPHO = morphoAsset.address
  assetCollDeployments.erc20s.MORPHO = erc20
  deployedAssets.push(morphoAsset.address)

  /**************************************************************/

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

  console.log(`Deployed MORPHO asset to ${hre.network.name} (${chainId}):
    New deployments: ${deployedAssets}
    Deployment file: ${assetCollDeploymentFilename}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
