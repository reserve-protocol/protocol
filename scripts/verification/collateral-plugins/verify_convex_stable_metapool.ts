import hre, { ethers } from 'hardhat'
import { getChainId } from '../../../common/blockchain-utils'
import { developmentChains, networkConfig } from '../../../common/configuration'
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
  DELAY_UNTIL_DEFAULT,
  MAX_TRADE_VOL,
  MIM_DEFAULT_THRESHOLD,
  MIM_USD_FEED,
  MIM_ORACLE_ERROR,
  MIM_ORACLE_TIMEOUT,
  MIM_THREE_POOL,
  PRICE_TIMEOUT,
  THREE_POOL_DEFAULT_THRESHOLD,
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

  const wPoolCollateral = await ethers.getContractAt(
    'CurveStableMetapoolCollateral',
    deployments.collateral.cvxMIM3Pool as string
  )

  /********  Verify Convex MIM/3Pool plugin  **************************/
  await verifyContract(
    chainId,
    deployments.collateral.cvxMIM3Pool,
    [
      {
        erc20: await wPoolCollateral.erc20(),
        targetName: ethers.utils.formatBytes32String('USD'),
        priceTimeout: PRICE_TIMEOUT,
        chainlinkFeed: MIM_USD_FEED,
        oracleError: MIM_ORACLE_ERROR,
        oracleTimeout: MIM_ORACLE_TIMEOUT,
        maxTradeVolume: MAX_TRADE_VOL,
        defaultThreshold: THREE_POOL_DEFAULT_THRESHOLD, // 1.25%
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
      MIM_THREE_POOL,
      MIM_DEFAULT_THRESHOLD,
    ],
    'contracts/plugins/assets/curve/CurveStableMetapoolCollateral.sol:CurveStableMetapoolCollateral'
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
