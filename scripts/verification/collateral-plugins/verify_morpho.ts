import hre, { ethers } from 'hardhat'
import { getChainId } from '../../../common/blockchain-utils'
import { developmentChains, networkConfig } from '../../../common/configuration'
import { fp, bn } from '../../../common/numbers'
import {
  getDeploymentFile,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
} from '../../deployment/common'
import { combinedError, priceTimeout, verifyContract, revenueHiding } from '../../deployment/utils'

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

  /********  MorphoAaveV2TokenisedDeposit **************************/

  await verifyContract(
    chainId,
    deployments.erc20s.maUSDT,
    [
      {
        morphoController: networkConfig[chainId].MORPHO_AAVE_CONTROLLER!,
        morphoLens: networkConfig[chainId].MORPHO_AAVE_LENS!,
        rewardsDistributor: networkConfig[chainId].MORPHO_REWARDS_DISTRIBUTOR!,
        underlyingERC20: networkConfig[chainId].tokens.USDT!,
        poolToken: networkConfig[chainId].tokens.aUSDT!,
        rewardToken: networkConfig[chainId].tokens.MORPHO!,
      },
    ],
    'contracts/plugins/assets/morpho-aave/MorphoAaveV2TokenisedDeposit.sol:MorphoAaveV2TokenisedDeposit'
  )

  /********  MorphoFiatCollateral **************************/

  const maUSDT = await ethers.getContractAt(
    'MorphoFiatCollateral',
    deployments.collateral.maUSDT as string
  )

  await verifyContract(
    chainId,
    maUSDT.address,
    [
      {
        priceTimeout: priceTimeout.toString(),
        oracleError: fp('0.0025').toString(), // 0.25%
        maxTradeVolume: fp('1e6').toString(), // $1m,
        oracleTimeout: '86400', // 1 hr
        targetName: ethers.utils.formatBytes32String('USD'),
        defaultThreshold: fp('0.0025').add(fp('0.01')).toString(), // 1.25%
        delayUntilDefault: bn('86400').toString(), // 24h
        chainlinkFeed: networkConfig[chainId].chainlinkFeeds.USDT!,
        erc20: await maUSDT.erc20(),
      },
      revenueHiding,
    ],
    'contracts/plugins/assets/morpho-aave/MorphoFiatCollateral.sol:MorphoFiatCollateral'
  )

  /********  MorphoNonFiatCollateral **************************/

  const maWBTC = await ethers.getContractAt(
    'MorphoNonFiatCollateral',
    deployments.collateral.maWBTC as string
  )
  const combinedBTCWBTCError = combinedError(fp('0.02'), fp('0.005'))

  await verifyContract(
    chainId,
    maWBTC.address,
    [
      {
        priceTimeout: priceTimeout.toString(),
        oracleError: combinedBTCWBTCError.toString(), // 0.25%
        maxTradeVolume: fp('1e6'), // $1m,
        oracleTimeout: '86400', // 24 hr
        targetName: ethers.utils.formatBytes32String('BTC'),
        defaultThreshold: fp('0.01').add(combinedBTCWBTCError), // ~3.5%
        delayUntilDefault: bn('86400'), // 24h
        chainlinkFeed: networkConfig[chainId].chainlinkFeeds.WBTC!,
        erc20: await maWBTC.erc20(),
      },
      revenueHiding,
      networkConfig[chainId].chainlinkFeeds.BTC!,
      '3600', // 1 hr
    ],
    'contracts/plugins/assets/morpho-aave/MorphoNonFiatCollateral.sol:MorphoNonFiatCollateral'
  )

  /********  MorphoSelfReferentialCollateral **************************/

  const maWETH = await ethers.getContractAt(
    'MorphoSelfReferentialCollateral',
    deployments.collateral.maWETH as string
  )

  await verifyContract(
    chainId,
    maWETH.address,
    [
      {
        priceTimeout: priceTimeout,
        oracleError: fp('0.005'),
        maxTradeVolume: fp('1e6'), // $1m,
        oracleTimeout: '3600', // 1 hr
        targetName: ethers.utils.formatBytes32String('ETH'),
        defaultThreshold: fp('0'), // 0% -- no soft default for self-referential collateral
        delayUntilDefault: bn('86400'), // 24h
        chainlinkFeed: networkConfig[chainId].chainlinkFeeds.ETH!,
        erc20: await maWETH.erc20(),
      },
      revenueHiding,
    ],
    'contracts/plugins/assets/morpho-aave/MorphoSelfReferentialCollateral.sol:MorphoSelfReferentialCollateral'
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
