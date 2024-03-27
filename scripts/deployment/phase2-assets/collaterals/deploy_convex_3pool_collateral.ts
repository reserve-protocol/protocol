import fs from 'fs'
import hre, { ethers } from 'hardhat'
import { getChainId } from '../../../../common/blockchain-utils'
import { networkConfig } from '../../../../common/configuration'
import { bn } from '../../../../common/numbers'
import { expect } from 'chai'
import { CollateralStatus, ONE_ADDRESS } from '../../../../common/constants'
import {
  getDeploymentFile,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
  getDeploymentFilename,
  fileExists,
} from '../../common'
import { CurveStableCollateral } from '../../../../typechain'
import { revenueHiding } from '../../utils'
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
  THREE_POOL_CVX_POOL_ID,
  USDC_ORACLE_ERROR,
  USDC_ORACLE_TIMEOUT,
  USDC_USD_FEED,
  USDT_ORACLE_ERROR,
  USDT_ORACLE_TIMEOUT,
  USDT_USD_FEED,
} from '../../../../test/plugins/individual-collateral/curve/constants'

// Convex Stable Plugin: 3pool

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

  /********  Deploy Convex Stable Pool for 3pool  **************************/

  const CurveStableCollateralFactory = await hre.ethers.getContractFactory('CurveStableCollateral')
  const ConvexStakingWrapperFactory = await ethers.getContractFactory('ConvexStakingWrapper')

  const w3Pool = await ConvexStakingWrapperFactory.deploy()
  await w3Pool.deployed()
  await (await w3Pool.initialize(THREE_POOL_CVX_POOL_ID)).wait()

  console.log(
    `Deployed wrapper for Convex Stable 3Pool on ${hre.network.name} (${chainId}): ${w3Pool.address} `
  )

  const collateral = <CurveStableCollateral>await CurveStableCollateralFactory.connect(
    deployer
  ).deploy(
    {
      erc20: w3Pool.address,
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
    }
  )
  await collateral.deployed()
  await (await collateral.refresh()).wait()
  expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

  console.log(
    `Deployed Convex Stable Collateral for 3Pool to ${hre.network.name} (${chainId}): ${collateral.address}`
  )

  assetCollDeployments.collateral.cvx3Pool = collateral.address
  assetCollDeployments.erc20s.cvx3Pool = w3Pool.address
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
