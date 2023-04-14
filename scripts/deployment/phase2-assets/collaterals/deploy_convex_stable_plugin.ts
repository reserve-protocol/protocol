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
  IDeployments,
  getDeploymentFilename,
  fileExists,
} from '../../common'
import { CvxStableCollateral } from '../../../../typechain'
import { revenueHiding, oracleTimeout } from '../../utils'
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
} from '../../../../test/plugins/individual-collateral/convex/constants'

// This file specifically deploys Convex Stable Plugin for 3pool

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
  const deployments = <IDeployments>getDeploymentFile(phase1File)

  // Check previous step completed
  const assetCollDeploymentFilename = getAssetCollDeploymentFilename(chainId)
  const assetCollDeployments = <IAssetCollDeployments>getDeploymentFile(assetCollDeploymentFilename)

  const deployedCollateral: string[] = []

  /********  Deploy Convex Stable Pool for 3pool  **************************/

  const CvxMining = await ethers.getContractAt('CvxMining', deployments.cvxMiningLib)
  const CvxStableCollateralFactory = await hre.ethers.getContractFactory('CvxStableCollateral')
  const ConvexStakingWrapperFactory = await ethers.getContractFactory('ConvexStakingWrapper', {
    libraries: { CvxMining: CvxMining.address },
  })

  const w3Pool = await ConvexStakingWrapperFactory.deploy()
  await w3Pool.deployed()
  await (await w3Pool.initialize(THREE_POOL_CVX_POOL_ID)).wait()

  const collateral = <CvxStableCollateral>await CvxStableCollateralFactory.connect(deployer).deploy(
    {
      erc20: w3Pool.address,
      targetName: ethers.utils.formatBytes32String('USD'),
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
      curvePool: THREE_POOL,
      poolType: CurvePoolType.Plain,
      feeds: [[DAI_USD_FEED], [USDC_USD_FEED], [USDT_USD_FEED]],
      oracleTimeouts: [
        [oracleTimeout(chainId, DAI_ORACLE_TIMEOUT)],
        [oracleTimeout(chainId, USDC_ORACLE_TIMEOUT)],
        [oracleTimeout(chainId, USDT_ORACLE_TIMEOUT)],
      ],
      oracleErrors: [[DAI_ORACLE_ERROR], [USDC_ORACLE_ERROR], [USDT_ORACLE_ERROR]],
      lpToken: THREE_POOL_TOKEN,
    }
  )
  await collateral.deployed()
  await (await collateral.refresh()).wait()
  expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

  console.log(
    `Deployed Convex Stable Collateral to ${hre.network.name} (${chainId}): ${collateral.address}`
  )

  assetCollDeployments.collateral.cvx3Pool = collateral.address
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
