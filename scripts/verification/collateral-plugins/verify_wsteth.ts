import hre from 'hardhat'
import { getChainId } from '../../../common/blockchain-utils'
import { baseL2Chains, developmentChains, networkConfig } from '../../../common/configuration'
import { fp, bn } from '../../../common/numbers'
import {
  getDeploymentFile,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
} from '../../deployment/common'
import {
  BASE_PRICE_FEEDS,
  BASE_FEEDS_TIMEOUT,
  BASE_ORACLE_ERROR,
} from '../../../test/plugins/individual-collateral/lido/constants'
import { priceTimeout, verifyContract } from '../../deployment/utils'

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

  // Don't need to verify wrapper token because it's canonical

  /********  Verify Lido Wrapped-Staked-ETH - wstETH  **************************/
  if (!baseL2Chains.includes(hre.network.name)) {
    await verifyContract(
      chainId,
      deployments.collateral.wstETH,
      [
        {
          priceTimeout: priceTimeout.toString(),
          chainlinkFeed: networkConfig[chainId].chainlinkFeeds.stETHUSD,
          oracleError: fp('0.01').toString(), // 1%: only for stETHUSD feed
          erc20: networkConfig[chainId].tokens.wstETH,
          maxTradeVolume: fp('1e6').toString(), // $1m,
          oracleTimeout: '3600', // 1 hr,
          targetName: hre.ethers.utils.formatBytes32String('ETH'),
          defaultThreshold: fp('0.025').toString(), // 2.5% = 2% + 0.5% stethETH feed oracleError
          delayUntilDefault: bn('86400').toString(), // 24h
        },
        fp('1e-4'), // revenueHiding = 0.01%
        networkConfig[chainId].chainlinkFeeds.stETHETH, // targetPerRefChainlinkFeed
        '86400', // targetPerRefChainlinkTimeout
      ],
      'contracts/plugins/assets/lido/LidoStakedEthCollateral.sol:LidoStakedEthCollateral'
    )
  } else if (chainId == '8453' || chainId == '84531') {
    await verifyContract(
      chainId,
      deployments.collateral.wstETH,
      [
        {
          priceTimeout: priceTimeout.toString(),
          chainlinkFeed: BASE_PRICE_FEEDS.stETH_ETH, // ignored
          oracleError: BASE_ORACLE_ERROR.toString(), // 0.5% & 0.5% & 0.15%
          erc20: networkConfig[chainId].tokens.wstETH,
          maxTradeVolume: fp('5e5').toString(), // $500k
          oracleTimeout: BASE_FEEDS_TIMEOUT.stETH_ETH, // 86400, ignored
          targetName: hre.ethers.utils.formatBytes32String('ETH'),
          defaultThreshold: fp('0.025').toString(), // 2.5% = 2% + 0.5% stethEth feed oracleError
          delayUntilDefault: bn('86400').toString(), // 24h
        },
        fp('1e-4'), // revenueHiding = 0.01%
        BASE_PRICE_FEEDS.stETH_ETH,
        BASE_FEEDS_TIMEOUT.stETH_ETH,
        BASE_PRICE_FEEDS.ETH_USD,
        BASE_FEEDS_TIMEOUT.ETH_USD,
        BASE_PRICE_FEEDS.wstETH_stETH,
        BASE_FEEDS_TIMEOUT.wstETH_stETH,
      ],
      'contracts/plugins/assets/lido/L2LidoStakedEthCollateral.sol:L2LidoStakedEthCollateral'
    )
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
