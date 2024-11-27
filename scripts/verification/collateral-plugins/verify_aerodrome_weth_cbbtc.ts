import hre, { ethers } from 'hardhat'
import { getChainId } from '../../../common/blockchain-utils'
import { baseL2Chains, developmentChains, networkConfig } from '../../../common/configuration'
import { ONE_ADDRESS } from '../../../common/constants'
import {
  getDeploymentFile,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
} from '../../deployment/common'
import { verifyContract } from '../../deployment/utils'
import { combinedError } from '../../deployment/utils'
import { IAeroPool } from '@typechain/IAeroPool'
import {
  AerodromePoolType,
  MAX_TRADE_VOL,
  PRICE_TIMEOUT,
  AERO_WETH_cbBTC_POOL,
  AERO_WETH_cbBTC_GAUGE,
  AERO,
  cbBTC_ORACLE_TIMEOUT,
  cbBTC_USD_FEED,
  cbBTC_ORACLE_ERROR,
  ETH_USD_FEED,
  ETH_ORACLE_TIMEOUT,
  ETH_ORACLE_ERROR,
} from '../../../test/plugins/individual-collateral/aerodrome/constants'

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

  // Only on base, aways use wrapper
  if (baseL2Chains.includes(hre.network.name)) {
    const aeroWETHcbBTCPoolCollateral = await ethers.getContractAt(
      'AerodromeVolatileCollateral',
      deployments.collateral.aeroWETHcbBTC as string
    )

    /********  Verify Gauge Wrapper  **************************/

    const pool = <IAeroPool>await ethers.getContractAt('IAeroPool', AERO_WETH_cbBTC_POOL)
    await verifyContract(
      chainId,
      await aeroWETHcbBTCPoolCollateral.erc20(),
      [
        pool.address,
        'w' + (await pool.name()),
        'w' + (await pool.symbol()),
        AERO,
        AERO_WETH_cbBTC_GAUGE,
      ],
      'contracts/plugins/assets/aerodrome/AerodromeGaugeWrapper.sol:AerodromeGaugeWrapper'
    )

    /********  Verify WETH-cbBTC plugin  **************************/
    const oracleError = combinedError(cbBTC_ORACLE_ERROR, ETH_ORACLE_ERROR) // 0.3% & 0.15%
    await verifyContract(
      chainId,
      deployments.collateral.aeroWETHcbBTC,
      [
        {
          erc20: await aeroWETHcbBTCPoolCollateral.erc20(),
          targetName: await aeroWETHcbBTCPoolCollateral.targetName(),
          priceTimeout: PRICE_TIMEOUT,
          chainlinkFeed: ONE_ADDRESS, // unused but cannot be zero
          oracleError: oracleError.toString(),
          oracleTimeout: ETH_ORACLE_TIMEOUT, // max of oracleTimeouts
          maxTradeVolume: MAX_TRADE_VOL,
          defaultThreshold: '0',
          delayUntilDefault: '86400',
        },
        {
          pool: AERO_WETH_cbBTC_POOL,
          poolType: AerodromePoolType.Volatile,
          feeds: [[ETH_USD_FEED], [cbBTC_USD_FEED]],
          oracleTimeouts: [[ETH_ORACLE_TIMEOUT], [cbBTC_ORACLE_TIMEOUT]],
          oracleErrors: [[ETH_ORACLE_ERROR], [cbBTC_ORACLE_ERROR]],
        },
      ],
      'contracts/plugins/assets/aerodrome/AerodromeVolatileCollateral.sol:AerodromeVolatileCollateral'
    )
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
