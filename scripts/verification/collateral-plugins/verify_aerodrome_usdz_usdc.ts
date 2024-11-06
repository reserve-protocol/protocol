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
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
  MAX_TRADE_VOL,
  PRICE_TIMEOUT,
  AERO_USDz_USDC_POOL,
  AERO_USDz_USDC_GAUGE,
  AERO,
  USDC_ORACLE_ERROR,
  USDC_ORACLE_TIMEOUT,
  USDC_USD_FEED,
  USDz_ORACLE_ERROR,
  USDz_ORACLE_TIMEOUT,
  USDz_USD_FEED,
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
    const aeroUSDzUSDCPoolCollateral = await ethers.getContractAt(
      'AerodromeStableCollateral',
      deployments.collateral.aeroUSDzUSDC as string
    )

    /********  Verify Gauge Wrapper  **************************/

    const pool = <IAeroPool>await ethers.getContractAt('IAeroPool', AERO_USDz_USDC_POOL)
    await verifyContract(
      chainId,
      await aeroUSDzUSDCPoolCollateral.erc20(),
      [
        pool.address,
        'w' + (await pool.name()),
        'w' + (await pool.symbol()),
        AERO,
        AERO_USDz_USDC_GAUGE,
      ],
      'contracts/plugins/assets/aerodrome/AerodromeGaugeWrapper.sol:AerodromeGaugeWrapper'
    )

    /********  Verify USDz-USDC plugin  **************************/
    const oracleError = combinedError(USDC_ORACLE_ERROR, USDz_ORACLE_ERROR) // 0.3% & 0.5%
    await verifyContract(
      chainId,
      deployments.collateral.aeroUSDzUSDC,
      [
        {
          erc20: await aeroUSDzUSDCPoolCollateral.erc20(),
          targetName: ethers.utils.formatBytes32String('USD'),
          priceTimeout: PRICE_TIMEOUT,
          chainlinkFeed: ONE_ADDRESS, // unused but cannot be zero
          oracleError: oracleError.toString(),
          oracleTimeout: USDC_ORACLE_TIMEOUT, // max of oracleTimeouts
          maxTradeVolume: MAX_TRADE_VOL,
          defaultThreshold: DEFAULT_THRESHOLD,
          delayUntilDefault: DELAY_UNTIL_DEFAULT,
        },
        {
          pool: AERO_USDz_USDC_POOL,
          poolType: AerodromePoolType.Stable,
          feeds: [[USDz_USD_FEED], [USDC_USD_FEED]],
          oracleTimeouts: [[USDz_ORACLE_TIMEOUT], [USDC_ORACLE_TIMEOUT]],
          oracleErrors: [[USDz_ORACLE_ERROR], [USDC_ORACLE_ERROR]],
        },
      ],
      'contracts/plugins/assets/aerodrome/AerodromeStableCollateral.sol:AerodromeStableCollateral'
    )
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
