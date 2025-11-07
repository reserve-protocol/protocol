import fs from 'fs'
import hre, { ethers } from 'hardhat'
import { getChainId } from '../../../../common/blockchain-utils'
import { baseL2Chains, networkConfig } from '../../../../common/configuration'
import { expect } from 'chai'
import { CollateralStatus, ONE_ADDRESS } from '../../../../common/constants'
import {
  getDeploymentFile,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
  getDeploymentFilename,
  fileExists,
} from '../../common'
import {
  AerodromeVolatileCollateral,
  AerodromeGaugeWrapper,
  IAeroPool,
} from '../../../../typechain'
import { combinedError } from '../../utils'
import {
  AerodromePoolType,
  MAX_TRADE_VOL,
  PRICE_TIMEOUT,
  AERO_WETH_cbBTC_POOL,
  AERO_WETH_cbBTC_GAUGE,
  AERO,
  cbBTC_USD_FEED,
  cbBTC_ORACLE_TIMEOUT,
  cbBTC_ORACLE_ERROR,
  ETH_USD_FEED,
  ETH_ORACLE_TIMEOUT,
  ETH_ORACLE_ERROR,
} from '../../../../test/plugins/individual-collateral/aerodrome/constants'

// Aerodrome volatile plugin: WETH-cbBTCvAMM

async function main() {
  // ==== Read Configuration ====
  const [deployer] = await hre.ethers.getSigners()

  const chainId = await getChainId(hre)

  console.log(`Deploying Collateral to network ${hre.network.name} (${chainId})
    with burner account: ${deployer.address}`)

  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${hre.network.name}`)
  }

  // Get phase1 deployment
  const phase1File = getDeploymentFilename(chainId)
  if (!fileExists(phase1File)) {
    throw new Error(`${phase1File} doesn't exist yet. Run phase 1`)
  }
  // Check previous step completed
  const assetCollDeploymentFilename = getAssetCollDeploymentFilename(chainId)
  const assetCollDeployments = <IAssetCollDeployments>getDeploymentFile(assetCollDeploymentFilename)

  const deployedCollateral: string[] = []

  /********  Deploy Aerodrome Volatile Pool for WETH-cbBTC  **************************/

  let collateral: AerodromeVolatileCollateral
  let erc20 = networkConfig[chainId].tokens.waeroWETHcbBTC

  // Only for Base
  if (baseL2Chains.includes(hre.network.name)) {
    const AerodromeVolatileCollateralFactory = await hre.ethers.getContractFactory(
      'AerodromeVolatileCollateral'
    )

    if (!erc20) {
      const AerodromeGaugeWrapperFactory = await ethers.getContractFactory('AerodromeGaugeWrapper')

      // Deploy gauge wrapper
      const pool = <IAeroPool>await ethers.getContractAt('IAeroPool', AERO_WETH_cbBTC_POOL)
      const wWethcbBTC = <AerodromeGaugeWrapper>(
        await AerodromeGaugeWrapperFactory.deploy(
          pool.address,
          'w' + (await pool.name()),
          'w' + (await pool.symbol()),
          AERO,
          AERO_WETH_cbBTC_GAUGE
        )
      )
      await wWethcbBTC.deployed()

      console.log(
        `Deployed wrapper for Aerodrome Volatile WETH-cbBTC pool on ${hre.network.name} (${chainId}): ${wWethcbBTC.address} `
      )
      erc20 = wWethcbBTC.address
    }

    const oracleError = combinedError(cbBTC_ORACLE_ERROR, ETH_ORACLE_ERROR) // 0.3% & 0.15%

    collateral = <AerodromeVolatileCollateral>await AerodromeVolatileCollateralFactory.connect(
      deployer
    ).deploy(
      {
        erc20: erc20,
        targetName: ethers.utils.formatBytes32String('ETH_BTC_AERODROME_cpAMM'),
        priceTimeout: PRICE_TIMEOUT,
        chainlinkFeed: ONE_ADDRESS, // unused but cannot be zero
        oracleError: oracleError.toString(), // unused but cannot be zero
        oracleTimeout: ETH_ORACLE_TIMEOUT, // max of oracleTimeouts
        maxTradeVolume: MAX_TRADE_VOL,
        defaultThreshold: '0',
        delayUntilDefault: '86400', // 24h
      },
      {
        pool: AERO_WETH_cbBTC_POOL,
        poolType: AerodromePoolType.Volatile,
        feeds: [[ETH_USD_FEED], [cbBTC_USD_FEED]],
        oracleTimeouts: [[ETH_ORACLE_TIMEOUT], [cbBTC_ORACLE_TIMEOUT]],
        oracleErrors: [[ETH_ORACLE_ERROR], [cbBTC_ORACLE_ERROR]],
      }
    )
  } else {
    throw new Error(`Unsupported chainId: ${chainId}`)
  }

  await collateral.deployed()
  await (await collateral.refresh({ gasLimit: 3_000_000 })).wait()
  expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

  console.log(
    `Deployed Aerodrome Volatile Collateral for WETH-cbBTC to ${hre.network.name} (${chainId}): ${collateral.address}`
  )

  assetCollDeployments.collateral.aeroWETHcbBTC = collateral.address
  assetCollDeployments.erc20s.aeroWETHcbBTC = erc20
  deployedCollateral.push(collateral.address.toString())

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

  console.log(`Deployed collateral to ${hre.network.name} (${chainId})
        New deployments: ${deployedCollateral}
        Deployment file: ${assetCollDeploymentFilename}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
