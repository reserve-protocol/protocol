import hre, { ethers } from 'hardhat'
import { getChainId } from '../../../common/blockchain-utils'
import { developmentChains, networkConfig } from '../../../common/configuration'
import { fp, bn } from '../../../common/numbers'
import {
  getDeploymentFile,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
} from '../../deployment/common'
import { priceTimeout, oracleTimeout, verifyContract, revenueHiding } from '../../deployment/utils'

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

  const assetCollDeploymentFilename = getAssetCollDeploymentFilename(chainId)
  deployments = <IAssetCollDeployments>getDeploymentFile(assetCollDeploymentFilename)

  /********  MorphoFiatCollateral **************************/

  const collateral = await ethers.getContractAt(
    'MorphoFiatCollateral',
    deployments.collateral.maUSDT as string
  )

  await verifyContract(
    chainId,
    await collateral.erc20(),
    [
      networkConfig[chainId].MORPHO_AAVE_CONTROLLER!,
      networkConfig[chainId].MORPHO_AAVE_LENS!,
      networkConfig[chainId].MORPHO_REWARDS_DISTRIBUTOR!,
      networkConfig[chainId].tokens.USDT!,
      networkConfig[chainId].tokens.aUSDT!,
      networkConfig[chainId].tokens.MORPHO!,
    ],
    'contracts/plugins/assets/morpho-aave/MorphoAaveV2TokenisedDeposit.sol:MorphoAaveV2TokenisedDeposit'
  )

  await verifyContract(
    chainId,
    collateral.address,
    [
      {
        priceTimeout: priceTimeout.toString(),
        chainlinkFeed: networkConfig[chainId].chainlinkFeeds.USDC,
        oracleError: fp('0.0025').toString(), // 0.25%,
        erc20: await collateral.erc20(),
        maxTradeVolume: fp('1e6').toString(), // $1m,
        oracleTimeout: oracleTimeout(chainId, '86400').toString(), // 24h hr,
        targetName: hre.ethers.utils.formatBytes32String('USD'),
        defaultThreshold: fp('0.0125').toString(), // 1% + 0.25%
        delayUntilDefault: bn('86400').toString(), // 24h
      },
      revenueHiding,
      bn('10000e6'), // $10k
    ],
    'contracts/plugins/assets/compoundv3/CTokenV3Collateral.sol:CTokenV3Collateral'
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
