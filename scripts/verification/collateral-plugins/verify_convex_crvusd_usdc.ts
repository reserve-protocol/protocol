import hre, { ethers } from 'hardhat'
import { getChainId } from '../../../common/blockchain-utils'
import { arbitrumL2Chains, developmentChains, networkConfig } from '../../../common/configuration'
import { bn, fp } from '../../../common/numbers'
import { ONE_ADDRESS } from '../../../common/constants'
import {
  getDeploymentFile,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
} from '../../deployment/common'
import { verifyContract } from '../../deployment/utils'
import { combinedError, revenueHiding } from '../../deployment/utils'
import {
  CurvePoolType,
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
  MAX_TRADE_VOL,
  PRICE_TIMEOUT,
  crvUSD_USDC,
  USDC_ORACLE_ERROR,
  USDC_ORACLE_TIMEOUT,
  USDC_USD_FEED,
  crvUSD_ORACLE_ERROR,
  crvUSD_ORACLE_TIMEOUT,
  crvUSD_USD_FEED,
  ARB_crvUSD_USDC,
  ARB_crvUSD_ORACLE_ERROR,
  ARB_crvUSD_ORACLE_TIMEOUT,
  ARB_crvUSD_USD_FEED,
  ARB_USDC_ORACLE_ERROR,
  ARB_USDC_ORACLE_TIMEOUT,
  ARB_USDC_USD_FEED,
} from '../../../test/plugins/individual-collateral/curve/constants'

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

  // Perform verification based on network (no wrapper in L2)
  if (!arbitrumL2Chains.includes(hre.network.name)) {
    const crvUsdUSDCPoolCollateral = await ethers.getContractAt(
      'CurveStableCollateral',
      deployments.collateral.cvxCrvUSDUSDC as string
    )

    /********  Verify ConvexStakingWrapper  **************************/

    await verifyContract(
      chainId,
      await crvUsdUSDCPoolCollateral.erc20(),
      [],
      'contracts/plugins/assets/curve/cvx/vendor/ConvexStakingWrapper.sol:ConvexStakingWrapper'
    )

    /********  Verify crvUSD-USDC plugin  **************************/
    await verifyContract(
      chainId,
      deployments.collateral.cvxCrvUSDUSDC,
      [
        {
          erc20: await crvUsdUSDCPoolCollateral.erc20(),
          targetName: ethers.utils.formatBytes32String('USD'),
          priceTimeout: PRICE_TIMEOUT,
          chainlinkFeed: ONE_ADDRESS, // unused but cannot be zero
          oracleError: bn('1'), // unused but cannot be zero
          oracleTimeout: USDC_ORACLE_TIMEOUT, // max of oracleTimeouts
          maxTradeVolume: MAX_TRADE_VOL,
          defaultThreshold: DEFAULT_THRESHOLD,
          delayUntilDefault: DELAY_UNTIL_DEFAULT,
        },
        revenueHiding.toString(),
        {
          nTokens: 2,
          curvePool: crvUSD_USDC,
          poolType: CurvePoolType.Plain,
          feeds: [[USDC_USD_FEED], [crvUSD_USD_FEED]],
          oracleTimeouts: [[USDC_ORACLE_TIMEOUT], [crvUSD_ORACLE_TIMEOUT]],
          oracleErrors: [[USDC_ORACLE_ERROR], [crvUSD_ORACLE_ERROR]],
          lpToken: crvUSD_USDC,
        },
      ],
      'contracts/plugins/assets/curve/CurveStableCollateral.sol:CurveStableCollateral'
    )
  } else if (chainId == '42161' || chainId == '421614') {
    const crvUsdUSDCPoolCollateral = await ethers.getContractAt(
      'L2ConvexStableCollateral',
      deployments.collateral.cvxCrvUSDUSDC as string
    )

    /********  Verify crvUSD-USDC plugin  **************************/
    await verifyContract(
      chainId,
      deployments.collateral.cvxCrvUSDUSDC,
      [
        {
          erc20: await crvUsdUSDCPoolCollateral.erc20(),
          targetName: ethers.utils.formatBytes32String('USD'),
          priceTimeout: PRICE_TIMEOUT,
          chainlinkFeed: ONE_ADDRESS, // unused but cannot be zero
          oracleError: bn('1'), // unused but cannot be zero
          oracleTimeout: ARB_USDC_ORACLE_TIMEOUT, // max of oracleTimeouts
          maxTradeVolume: MAX_TRADE_VOL,
          defaultThreshold: combinedError(ARB_crvUSD_ORACLE_ERROR, ARB_USDC_ORACLE_ERROR)
            .add(fp('0.01'))
            .toString(),
          delayUntilDefault: DELAY_UNTIL_DEFAULT,
        },
        revenueHiding.toString(),
        {
          nTokens: 2,
          curvePool: ARB_crvUSD_USDC,
          poolType: CurvePoolType.Plain,
          feeds: [[ARB_crvUSD_USD_FEED], [ARB_USDC_USD_FEED]],
          oracleTimeouts: [[ARB_crvUSD_ORACLE_TIMEOUT], [ARB_USDC_ORACLE_TIMEOUT]],
          oracleErrors: [[ARB_crvUSD_ORACLE_ERROR], [ARB_USDC_ORACLE_ERROR]],
          lpToken: ARB_crvUSD_USDC,
        },
      ],
      'contracts/plugins/assets/curve/L2ConvexStableCollateral.sol:L2ConvexStableCollateral'
    )
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
