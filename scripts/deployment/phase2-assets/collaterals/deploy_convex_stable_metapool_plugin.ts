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
  IDeployments,
  getDeploymentFilename,
  fileExists,
} from '../../common'
import { CvxStableMetapoolCollateral } from '../../../../typechain'
import { revenueHiding, oracleTimeout } from '../../utils'
import {
  CurvePoolType,
  DELAY_UNTIL_DEFAULT,
  MIM_DEFAULT_THRESHOLD,
  MIM_THREE_POOL,
  MIM_THREE_POOL_POOL_ID,
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
} from '../../../../test/plugins/individual-collateral/convex/constants'

// This file specifically deploys Convex Metapool Plugin for MIM/3Pool

async function main() {
  // ==== Read Configuration ====
  const [deployer] = await hre.ethers.getSigners()

  const chainId = await getChainId(hre)

  console.log(`Deploying CvxStableMetapoolCollateral to network ${hre.network.name} (${chainId})
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

  /********  Deploy Convex Stable Metapool for MIM/3Pool  **************************/

  const CvxMining = await ethers.getContractAt('CvxMining', deployments.cvxMiningLib)
  const CvxStableCollateralFactory = await hre.ethers.getContractFactory(
    'CvxStableMetapoolCollateral'
  )
  const ConvexStakingWrapperFactory = await ethers.getContractFactory('ConvexStakingWrapper', {
    libraries: { CvxMining: CvxMining.address },
  })

  const wPool = await ConvexStakingWrapperFactory.deploy()
  await wPool.initialize(MIM_THREE_POOL_POOL_ID)

  const collateral = <CvxStableMetapoolCollateral>await CvxStableCollateralFactory.connect(
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
      oracleTimeouts: [
        [oracleTimeout(chainId, DAI_ORACLE_TIMEOUT)],
        [oracleTimeout(chainId, USDC_ORACLE_TIMEOUT)],
        [oracleTimeout(chainId, USDT_ORACLE_TIMEOUT)],
      ],
      oracleErrors: [[DAI_ORACLE_ERROR], [USDC_ORACLE_ERROR], [USDT_ORACLE_ERROR]],
      lpToken: THREE_POOL_TOKEN,
    },
    MIM_THREE_POOL,
    MIM_DEFAULT_THRESHOLD
  )
  await collateral.deployed()
  await collateral.refresh()
  expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

  console.log(
    `Deployed Convex RToken Metapool Collateral to ${hre.network.name} (${chainId}): ${collateral.address}`
  )

  assetCollDeployments.collateral.cvxMIM3Pool = collateral.address
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
