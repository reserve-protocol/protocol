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
import { revenueHiding, oracleTimeout } from '../../deployment/utils'
import {
  CurvePoolType,
  BTC_USD_ORACLE_ERROR,
  BTC_ORACLE_TIMEOUT,
  BTC_USD_FEED,
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
  MAX_TRADE_VOL,
  PRICE_TIMEOUT,
  TRI_CRYPTO,
  TRI_CRYPTO_TOKEN,
  WBTC_BTC_ORACLE_ERROR,
  WETH_ORACLE_TIMEOUT,
  WBTC_BTC_FEED,
  WBTC_ORACLE_TIMEOUT,
  WETH_USD_FEED,
  WETH_ORACLE_ERROR,
  USDT_ORACLE_ERROR,
  USDT_ORACLE_TIMEOUT,
  USDT_USD_FEED,
} from '../../../test/plugins/individual-collateral/convex/constants'

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

  const wTriCrypto = await ethers.getContractAt(
    'CvxVolatileCollateral',
    deployments.collateral.cvxTriCrypto as string
  )

  /********  Verify TriCrypto plugin  **************************/
  await verifyContract(
    chainId,
    deployments.collateral.cvxTriCrypto,
    [
      {
        erc20: await wTriCrypto.erc20(),
        targetName: ethers.utils.formatBytes32String('TRICRYPTO'),
        priceTimeout: PRICE_TIMEOUT,
        chainlinkFeed: ONE_ADDRESS, // unused but cannot be zero
        oracleError: bn('1'), // unused but cannot be zero
        oracleTimeout: bn('1'), // unused but cannot be zero
        maxTradeVolume: MAX_TRADE_VOL,
        defaultThreshold: DEFAULT_THRESHOLD,
        delayUntilDefault: DELAY_UNTIL_DEFAULT,
      },
      revenueHiding.toString(),
      {
        nTokens: 3,
        curvePool: TRI_CRYPTO,
        poolType: CurvePoolType.Plain,
        feeds: [[USDT_USD_FEED], [WBTC_BTC_FEED, BTC_USD_FEED], [WETH_USD_FEED]],
        oracleTimeouts: [
          [oracleTimeout(chainId, USDT_ORACLE_TIMEOUT)],
          [oracleTimeout(chainId, WBTC_ORACLE_TIMEOUT), oracleTimeout(chainId, BTC_ORACLE_TIMEOUT)],
          [oracleTimeout(chainId, WETH_ORACLE_TIMEOUT)],
        ],
        oracleErrors: [
          [USDT_ORACLE_ERROR],
          [WBTC_BTC_ORACLE_ERROR, BTC_USD_ORACLE_ERROR],
          [WETH_ORACLE_ERROR],
        ],
        lpToken: TRI_CRYPTO_TOKEN,
      },
    ],
    'contracts/plugins/assets/convex/CvxVolatileCollateral.sol:CvxVolatileCollateral'
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
