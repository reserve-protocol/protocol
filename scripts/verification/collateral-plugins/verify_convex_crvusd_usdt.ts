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
  crvUSD_USDT,
  USDT_ORACLE_ERROR,
  USDT_ORACLE_TIMEOUT,
  USDT_USD_FEED,
  crvUSD_ORACLE_ERROR,
  crvUSD_ORACLE_TIMEOUT,
  crvUSD_USD_FEED,
  ARB_crvUSD_USDT,
  ARB_crvUSD_ORACLE_ERROR,
  ARB_crvUSD_ORACLE_TIMEOUT,
  ARB_crvUSD_USD_FEED,
  ARB_USDT_ORACLE_ERROR,
  ARB_USDT_ORACLE_TIMEOUT,
  ARB_USDT_USD_FEED,
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

  const crvUsdUSDTPoolCollateral = await ethers.getContractAt(
    'CurveStableCollateral',
    deployments.collateral.cvxCrvUSDUSDT as string
  )

  // Perform verification based on network (no wrapper in L2)
  if (!arbitrumL2Chains.includes(hre.network.name)) {
    /********  Verify ConvexStakingWrapper  **************************/

    await verifyContract(
      chainId,
      await crvUsdUSDTPoolCollateral.erc20(),
      [],
      'contracts/plugins/assets/curve/cvx/vendor/ConvexStakingWrapper.sol:ConvexStakingWrapper'
    )

    /********  Verify crvUSD-USDC plugin  **************************/
    await verifyContract(
      chainId,
      deployments.collateral.cvxCrvUSDUSDT,
      [
        {
          erc20: await crvUsdUSDTPoolCollateral.erc20(),
          targetName: ethers.utils.formatBytes32String('USD'),
          priceTimeout: PRICE_TIMEOUT,
          chainlinkFeed: ONE_ADDRESS, // unused but cannot be zero
          oracleError: bn('1'), // unused but cannot be zero
          oracleTimeout: USDT_ORACLE_TIMEOUT, // max of oracleTimeouts
          maxTradeVolume: MAX_TRADE_VOL,
          defaultThreshold: DEFAULT_THRESHOLD,
          delayUntilDefault: DELAY_UNTIL_DEFAULT,
        },
        revenueHiding.toString(),
        {
          nTokens: 2,
          curvePool: crvUSD_USDT,
          poolType: CurvePoolType.Plain,
          feeds: [[USDT_USD_FEED], [crvUSD_USD_FEED]],
          oracleTimeouts: [[USDT_ORACLE_TIMEOUT], [crvUSD_ORACLE_TIMEOUT]],
          oracleErrors: [[USDT_ORACLE_ERROR], [crvUSD_ORACLE_ERROR]],
          lpToken: crvUSD_USDT,
        },
      ],
      'contracts/plugins/assets/curve/CurveStableCollateral.sol:CurveStableCollateral'
    )
  } else if (chainId == '42161' || chainId == '421614') {
    /********  Verify crvUSD-USDC plugin  **************************/
    await verifyContract(
      chainId,
      deployments.collateral.cvxCrvUSDUSDT,
      [
        {
          erc20: await crvUsdUSDTPoolCollateral.erc20(),
          targetName: ethers.utils.formatBytes32String('USD'),
          priceTimeout: PRICE_TIMEOUT,
          chainlinkFeed: ONE_ADDRESS, // unused but cannot be zero
          oracleError: bn('1'), // unused but cannot be zero
          oracleTimeout: ARB_USDT_ORACLE_TIMEOUT, // max of oracleTimeouts
          maxTradeVolume: MAX_TRADE_VOL,
          defaultThreshold: combinedError(ARB_crvUSD_ORACLE_ERROR, ARB_USDT_ORACLE_ERROR)
            .add(fp('0.01'))
            .toString(),
          delayUntilDefault: DELAY_UNTIL_DEFAULT,
        },
        revenueHiding.toString(),
        {
          nTokens: 2,
          curvePool: ARB_crvUSD_USDT,
          poolType: CurvePoolType.Plain,
          feeds: [[ARB_crvUSD_USD_FEED], [ARB_USDT_USD_FEED]],
          oracleTimeouts: [[ARB_crvUSD_ORACLE_TIMEOUT], [ARB_USDT_ORACLE_TIMEOUT]],
          oracleErrors: [[ARB_crvUSD_ORACLE_ERROR], [ARB_USDT_ORACLE_ERROR]],
          lpToken: ARB_crvUSD_USDT,
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
