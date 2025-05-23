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
  priceTimeout,
  oracleTimeout,
  verifyContract,
  combinedError,
  revenueHiding,
} from '../../deployment/utils'

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

  /********  Verify Stargate USDC - wsgUSDC  **************************/

  if (!baseL2Chains.includes(hre.network.name)) {
    const name = 'Wrapped Stargate USDC'
    const symbol = 'wsgUSDC'
    const sUSDC = networkConfig[chainId].tokens.sUSDC

    await verifyContract(
      chainId,
      deployments.erc20s.wsgUSDC,
      [
        name,
        symbol,
        networkConfig[chainId].tokens.STG,
        networkConfig[chainId].STARGATE_STAKING_CONTRACT,
        sUSDC,
      ],
      'contracts/plugins/assets/stargate/StargateRewardableWrapper.sol:StargateRewardableWrapper'
    )

    const oracleError = fp('0.0025') // 0.25%

    await verifyContract(
      chainId,
      deployments.collateral.wsgUSDC,
      [
        {
          priceTimeout: priceTimeout.toString(),
          chainlinkFeed: networkConfig[chainId].chainlinkFeeds.USDC!,
          oracleError: oracleError, // 0.25%
          erc20: deployments.erc20s.wsgUSDC!,
          maxTradeVolume: fp('1e6').toString(), // $1m,
          oracleTimeout: oracleTimeout(chainId, '1200').toString(), // 20 min
          targetName: hre.ethers.utils.formatBytes32String('USD'),
          defaultThreshold: fp('0.01').add(oracleError).toString(),
          delayUntilDefault: bn('86400').toString(), // 24h
        },
        revenueHiding.toString(),
      ],
      'contracts/plugins/assets/stargate/StargatePoolFiatCollateral.sol:StargatePoolFiatCollateral'
    )
  } else if (chainId == '8453' || chainId == '84531') {
    const name = 'Wrapped Stargate USDbC'
    const symbol = 'wsgUSDbC'
    const sUSDC = networkConfig[chainId].tokens.sUSDbC

    await verifyContract(
      chainId,
      deployments.erc20s.wsgUSDbC,
      [
        name,
        symbol,
        networkConfig[chainId].tokens.STG,
        networkConfig[chainId].STARGATE_STAKING_CONTRACT,
        sUSDC,
      ],
      'contracts/plugins/assets/stargate/StargateRewardableWrapper.sol:StargateRewardableWrapper'
    )

    const oracleError = fp('0.003') // 0.3%

    await verifyContract(
      chainId,
      deployments.collateral.wsgUSDbC,
      [
        {
          priceTimeout: priceTimeout.toString(),
          chainlinkFeed: networkConfig['8453'].chainlinkFeeds.USDC!,
          oracleError: oracleError.toString(),
          erc20: deployments.erc20s.wsgUSDbC!,
          maxTradeVolume: fp('1e6').toString(), // $1m,
          oracleTimeout: oracleTimeout('8453', '86400').toString(), // 24h hr,
          targetName: hre.ethers.utils.formatBytes32String('USD'),
          defaultThreshold: fp('0.01').add(oracleError).toString(), // ~2.5%
          delayUntilDefault: bn('86400').toString(), // 24h
        },
        revenueHiding.toString(),
      ],
      'contracts/plugins/assets/stargate/StargatePoolFiatCollateral.sol:StargatePoolFiatCollateral'
    )
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
