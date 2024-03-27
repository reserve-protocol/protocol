import hre, { ethers } from 'hardhat'
import { getChainId } from '../../../common/blockchain-utils'
import { developmentChains, networkConfig } from '../../../common/configuration'
import { bn } from '../../../common/numbers'
import { ONE_ADDRESS } from '../../../common/constants'
import {
  getDeploymentFile,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
} from '../../deployment/common'
import { verifyContract } from '../../deployment/utils'
import { revenueHiding } from '../../deployment/utils'
import {
  CurvePoolType,
  DAI_ORACLE_ERROR,
  DAI_ORACLE_TIMEOUT,
  DAI_USD_FEED,
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
  MAX_TRADE_VOL,
  PRICE_TIMEOUT,
  THREE_POOL,
  THREE_POOL_TOKEN,
  USDC_ORACLE_ERROR,
  USDC_ORACLE_TIMEOUT,
  USDC_USD_FEED,
  USDT_ORACLE_ERROR,
  USDT_ORACLE_TIMEOUT,
  USDT_USD_FEED,
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

  const w3PoolCollateral = await ethers.getContractAt(
    'CurveStableCollateral',
    deployments.collateral.cvx3Pool as string
  )

  /********  Verify ConvexStakingWrapper  **************************/

  await verifyContract(
    chainId,
    await w3PoolCollateral.erc20(),
    [],
    'contracts/plugins/assets/curve/cvx/vendor/ConvexStakingWrapper.sol:ConvexStakingWrapper'
  )

  /********  Verify 3Pool plugin  **************************/
  await verifyContract(
    chainId,
    deployments.collateral.cvx3Pool,
    [
      {
        erc20: await w3PoolCollateral.erc20(),
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
        nTokens: 3,
        curvePool: THREE_POOL,
        poolType: CurvePoolType.Plain,
        feeds: [[DAI_USD_FEED], [USDC_USD_FEED], [USDT_USD_FEED]],
        oracleTimeouts: [[DAI_ORACLE_TIMEOUT], [USDC_ORACLE_TIMEOUT], [USDT_ORACLE_TIMEOUT]],
        oracleErrors: [[DAI_ORACLE_ERROR], [USDC_ORACLE_ERROR], [USDT_ORACLE_ERROR]],
        lpToken: THREE_POOL_TOKEN,
      },
    ],
    'contracts/plugins/assets/curve/CurveStableCollateral.sol:CurveStableCollateral'
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
