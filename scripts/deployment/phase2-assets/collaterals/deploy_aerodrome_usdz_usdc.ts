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
import { AerodromeStableCollateral, AerodromeGaugeWrapper, IAeroPool } from '../../../../typechain'
import { combinedError } from '../../utils'
import {
  AerodromePoolType,
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
  MAX_TRADE_VOL,
  PRICE_TIMEOUT,
  USDC_ORACLE_ERROR,
  USDC_ORACLE_TIMEOUT,
  USDC_USD_FEED,
  AERO_USDz_USDC_POOL,
  AERO_USDz_USDC_GAUGE,
  AERO,
  USDz_ORACLE_ERROR,
  USDz_ORACLE_TIMEOUT,
  USDz_USD_FEED,
} from '../../../../test/plugins/individual-collateral/aerodrome/constants'

// Convex Stable Plugin: crvUSD-USDC

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

  /********  Deploy Aerodrome Stable Pool for USDz-USDC  **************************/

  let collateral: AerodromeStableCollateral
  let erc20 = networkConfig[chainId].tokens.waeroUSDzUSDC

  // Only for Base
  if (baseL2Chains.includes(hre.network.name)) {
    const AerodromeStableCollateralFactory = await hre.ethers.getContractFactory(
      'AerodromeStableCollateral'
    )

    if (!erc20) {
      const AerodromeGaugeWrapperFactory = await ethers.getContractFactory('AerodromeGaugeWrapper')

      // Deploy gauge wrapper
      const pool = <IAeroPool>await ethers.getContractAt('IAeroPool', AERO_USDz_USDC_POOL)
      const wusdzusdc = <AerodromeGaugeWrapper>(
        await AerodromeGaugeWrapperFactory.deploy(
          pool.address,
          'w' + (await pool.name()),
          'w' + (await pool.symbol()),
          AERO,
          AERO_USDz_USDC_GAUGE
        )
      )
      await wusdzusdc.deployed()

      console.log(
        `Deployed wrapper for Aerodrome Stable USDz-USDC pool on ${hre.network.name} (${chainId}): ${wusdzusdc.address} `
      )
      erc20 = wusdzusdc.address
    }

    const oracleError = combinedError(USDC_ORACLE_ERROR, USDz_ORACLE_ERROR) // 0.3% & 0.5%

    collateral = <AerodromeStableCollateral>await AerodromeStableCollateralFactory.connect(
      deployer
    ).deploy(
      {
        erc20: erc20,
        targetName: ethers.utils.formatBytes32String('USD'),
        priceTimeout: PRICE_TIMEOUT,
        chainlinkFeed: ONE_ADDRESS, // unused but cannot be zero
        oracleError: oracleError.toString(), // unused but cannot be zero
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
      }
    )
  } else {
    throw new Error(`Unsupported chainId: ${chainId}`)
  }

  await collateral.deployed()
  await (await collateral.refresh({ gasLimit: 3_000_000 })).wait()
  expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

  console.log(
    `Deployed Aerodrome Stable Collateral for USDz-USDC to ${hre.network.name} (${chainId}): ${collateral.address}`
  )

  assetCollDeployments.collateral.aeroUSDzUSDC = collateral.address
  assetCollDeployments.erc20s.aeroUSDzUSDC = erc20
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
