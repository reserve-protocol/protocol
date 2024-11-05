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
  AERO_USDC_eUSD_POOL,
  AERO_USDC_eUSD_GAUGE,
  AERO,
  eUSD_ORACLE_ERROR,
  eUSD_ORACLE_TIMEOUT,
  eUSD_USD_FEED,
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

  /********  Deploy Aerodrome Stable Pool for USDC-eUSD  **************************/

  let collateral: AerodromeStableCollateral
  let wusdceusd: AerodromeGaugeWrapper

  // Only for Base
  if (baseL2Chains.includes(hre.network.name)) {
    const AerodromeStableCollateralFactory = await hre.ethers.getContractFactory(
      'AerodromeStableCollateral'
    )
    const AerodromeGaugeWrapperFactory = await ethers.getContractFactory('AerodromeGaugeWrapper')

    // Deploy gauge wrapper
    const pool = <IAeroPool>await ethers.getContractAt('IAeroPool', AERO_USDC_eUSD_POOL)
    wusdceusd = <AerodromeGaugeWrapper>(
      await AerodromeGaugeWrapperFactory.deploy(
        pool.address,
        'w' + (await pool.name()),
        'w' + (await pool.symbol()),
        AERO,
        AERO_USDC_eUSD_GAUGE
      )
    )
    await wusdceusd.deployed()

    console.log(
      `Deployed wrapper for Aerodrome Stable USDC-eUSD pool on ${hre.network.name} (${chainId}): ${wusdceusd.address} `
    )

    const oracleError = combinedError(USDC_ORACLE_ERROR, eUSD_ORACLE_ERROR) // 0.3% & 0.5%

    collateral = <AerodromeStableCollateral>await AerodromeStableCollateralFactory.connect(
      deployer
    ).deploy(
      {
        erc20: wusdceusd.address,
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
        pool: AERO_USDC_eUSD_POOL,
        poolType: AerodromePoolType.Stable,
        feeds: [[USDC_USD_FEED], [eUSD_USD_FEED]],
        oracleTimeouts: [[USDC_ORACLE_TIMEOUT], [eUSD_ORACLE_TIMEOUT]],
        oracleErrors: [[USDC_ORACLE_ERROR], [eUSD_ORACLE_ERROR]],
      }
    )
  } else {
    throw new Error(`Unsupported chainId: ${chainId}`)
  }

  await collateral.deployed()
  await (await collateral.refresh()).wait()
  expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

  console.log(
    `Deployed Aerodrome Stable Collateral for USDC-eUSD to ${hre.network.name} (${chainId}): ${collateral.address}`
  )

  assetCollDeployments.collateral.aeroUSDCeUSD = collateral.address
  assetCollDeployments.erc20s.aeroUSDCeUSD = wusdceusd.address
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
