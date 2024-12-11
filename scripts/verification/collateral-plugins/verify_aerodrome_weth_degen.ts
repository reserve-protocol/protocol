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
  AERO_WETH_DEGEN_POOL,
  AERO_WETH_DEGEN_GAUGE,
  AERO,
  DEGEN_ORACLE_TIMEOUT,
  DEGEN_USD_FEED,
  DEGEN_ORACLE_ERROR,
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
    const aeroWETHDEGENPoolCollateral = await ethers.getContractAt(
      'AerodromeVolatileCollateral',
      deployments.collateral.aeroWETHDEGEN as string
    )

    /********  Verify Gauge Wrapper  **************************/

    const pool = <IAeroPool>await ethers.getContractAt('IAeroPool', AERO_WETH_DEGEN_POOL)
    await verifyContract(
      chainId,
      await aeroWETHDEGENPoolCollateral.erc20(),
      [
        pool.address,
        'w' + (await pool.name()),
        'w' + (await pool.symbol()),
        AERO,
        AERO_WETH_DEGEN_GAUGE,
      ],
      'contracts/plugins/assets/aerodrome/AerodromeGaugeWrapper.sol:AerodromeGaugeWrapper'
    )

    /********  Verify WETH-DEGEN plugin  **************************/
    const oracleError = combinedError(DEGEN_ORACLE_ERROR, ETH_ORACLE_ERROR) // 0.5% & 0.15%
    await verifyContract(
      chainId,
      deployments.collateral.aeroWETHDEGEN,
      [
        {
          erc20: await aeroWETHDEGENPoolCollateral.erc20(),
          targetName: await aeroWETHDEGENPoolCollateral.targetName(),
          priceTimeout: PRICE_TIMEOUT,
          chainlinkFeed: ONE_ADDRESS, // unused but cannot be zero
          oracleError: oracleError.toString(),
          oracleTimeout: DEGEN_ORACLE_TIMEOUT, // max of oracleTimeouts
          maxTradeVolume: MAX_TRADE_VOL,
          defaultThreshold: '0',
          delayUntilDefault: '86400',
        },
        {
          pool: AERO_WETH_DEGEN_POOL,
          poolType: AerodromePoolType.Volatile,
          feeds: [[ETH_USD_FEED], [DEGEN_USD_FEED]],
          oracleTimeouts: [[ETH_ORACLE_TIMEOUT], [DEGEN_ORACLE_TIMEOUT]],
          oracleErrors: [[ETH_ORACLE_ERROR], [DEGEN_ORACLE_ERROR]],
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
