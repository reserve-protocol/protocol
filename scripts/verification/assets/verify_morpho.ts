import hre from 'hardhat'

import { getChainId } from '../../../common/blockchain-utils'
import {
  arbitrumL2Chains,
  baseL2Chains,
  developmentChains,
  networkConfig,
} from '../../../common/configuration'
import {
  getAssetCollDeploymentFilename,
  getDeploymentFile,
  IAssetCollDeployments,
} from '../../deployment/common'
import { verifyContract } from '../../deployment/utils'

let deployments: IAssetCollDeployments

async function main() {
  // ********** Read config **********
  const chainId = await getChainId(hre)
  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${hre.network.name}`)
  }

  if (developmentChains.includes(hre.network.name)) {
    throw new Error(`Cannot verify contracts for development chain ${hre.network.name}`)
  }

  // Only exists on Mainnet -- see deploy_morpho.ts
  if (baseL2Chains.includes(hre.network.name) || arbitrumL2Chains.includes(hre.network.name)) {
    throw new Error(`Invalid network ${hre.network.name} - only available on Mainnet`)
  }

  deployments = <IAssetCollDeployments>getDeploymentFile(getAssetCollDeploymentFilename(chainId))

  if (!deployments.assets.MORPHO) {
    throw new Error(`Missing deployed MORPHO asset on chain ${chainId}`)
  }

  const morphoAsset = await hre.ethers.getContractAt('MorphoAsset', deployments.assets.MORPHO)

  /** ******************** Verify MORPHO Asset ****************************************/
  // Read the constructor args back off the deployed contract so this cannot drift from
  // deploy_morpho.ts
  await verifyContract(
    chainId,
    deployments.assets.MORPHO,
    [
      (await morphoAsset.priceTimeout()).toString(),
      await morphoAsset.chainlinkFeed(),
      (await morphoAsset.oracleError()).toString(),
      await morphoAsset.erc20(),
      (await morphoAsset.maxTradeVolume()).toString(),
      (await morphoAsset.oracleTimeout()).toString(),
      await morphoAsset.uniswapV3Pool(),
      await morphoAsset.quoteToken(),
      (await morphoAsset.twapWindow()).toString(),
    ],
    'contracts/plugins/assets/meta-morpho/MorphoAsset.sol:MorphoAsset'
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
