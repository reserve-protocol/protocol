import fs from 'fs'
import hre, { ethers } from 'hardhat'
import { getChainId } from '../../../../common/blockchain-utils'
import { networkConfig } from '../../../../common/configuration'
import { expect } from 'chai'
import { CollateralStatus } from '../../../../common/constants'
import {
  getDeploymentFile,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
  getDeploymentFilename,
  fileExists,
} from '../../common'
import { CurveStableMetapoolCollateral } from '../../../../typechain'
import { revenueHiding } from '../../utils'
import {
  CRV,
  CurvePoolType,
  DELAY_UNTIL_DEFAULT,
  MIM_DEFAULT_THRESHOLD,
  MIM_THREE_POOL,
  MIM_THREE_POOL_GAUGE,
  MIM_USD_FEED,
  MIM_ORACLE_ERROR,
  MIM_ORACLE_TIMEOUT,
  MAX_TRADE_VOL,
  THREE_POOL_DEFAULT_THRESHOLD,
  THREE_POOL,
  THREE_POOL_TOKEN,
  PRICE_TIMEOUT,
  USDC_ORACLE_ERROR,
  USDC_ORACLE_TIMEOUT,
  USDC_USD_FEED,
  DAI_ORACLE_ERROR,
  DAI_ORACLE_TIMEOUT,
  DAI_USD_FEED,
  USDT_ORACLE_ERROR,
  USDT_ORACLE_TIMEOUT,
  USDT_USD_FEED,
} from '../../../../test/plugins/individual-collateral/curve/constants'

// Deploy Curve Metapool Plugin for MIM/3Pool

async function main() {
  // ==== Read Configuration ====
  const [deployer] = await hre.ethers.getSigners()

  const chainId = await getChainId(hre)

  console.log(`Deploying CurveStableMetapoolCollateral to network ${hre.network.name} (${chainId})
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

  /********  Deploy Curve Stable Metapool for MIM/3Pool  **************************/

  const CurveStableCollateralFactory = await hre.ethers.getContractFactory(
    'CurveStableMetapoolCollateral'
  )
  const CurveStakingWrapperFactory = await ethers.getContractFactory('CurveGaugeWrapper')
  const wPool = await CurveStakingWrapperFactory.deploy(
    MIM_THREE_POOL,
    'Wrapped Curve MIM+3Pool',
    'wMIM3CRV',
    CRV,
    MIM_THREE_POOL_GAUGE
  )
  await wPool.deployed()

  console.log(
    `Deployed wrapper for Curve Stable MIM/3Pool on ${hre.network.name} (${chainId}): ${wPool.address} `
  )

  const collateral = <CurveStableMetapoolCollateral>await CurveStableCollateralFactory.connect(
    deployer
  ).deploy(
    {
      erc20: wPool.address,
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
    MIM_DEFAULT_THRESHOLD
  )
  await collateral.deployed()
  await (await collateral.refresh()).wait()
  expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

  console.log(
    `Deployed Curve Metapool Collateral to ${hre.network.name} (${chainId}): ${collateral.address}`
  )

  assetCollDeployments.collateral.crvMIM3Pool = collateral.address
  assetCollDeployments.erc20s.crvMIM3Pool = wPool.address
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
