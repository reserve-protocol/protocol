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
import { CvxStableRTokenMetapoolCollateral } from '../../../../typechain'
import { revenueHiding, oracleTimeout } from '../../utils'
import {
  CurvePoolType,
  DEFAULT_THRESHOLD,
  eUSD_FRAX_BP,
  eUSD_FRAX_BP_POOL_ID,
  FRAX_BP,
  FRAX_BP_TOKEN,
  FRAX_ORACLE_ERROR,
  FRAX_ORACLE_TIMEOUT,
  FRAX_USD_FEED,
  MAX_TRADE_VOL,
  PRICE_TIMEOUT,
  RTOKEN_DELAY_UNTIL_DEFAULT,
  USDC_ORACLE_ERROR,
  USDC_ORACLE_TIMEOUT,
  USDC_USD_FEED,
} from '../../../../test/plugins/individual-collateral/convex/constants'

// This file specifically deploys Convex RToken Metapool Plugin for eUSD/fraxBP

async function main() {
  // ==== Read Configuration ====
  const [deployer] = await hre.ethers.getSigners()

  const chainId = await getChainId(hre)

  console.log(`Deploying CvxStableRTokenMetapoolCollateral to network ${hre.network.name} (${chainId})
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

  /********  Deploy Convex Stable Metapool for eUSD/fraxBP  **************************/

  const CvxMining = await ethers.getContractAt('CvxMining', deployments.cvxMiningLib)
  const CvxStableCollateralFactory = await hre.ethers.getContractFactory(
    'CvxStableRTokenMetapoolCollateral'
  )
  const ConvexStakingWrapperFactory = await ethers.getContractFactory('ConvexStakingWrapper', {
    libraries: { CvxMining: CvxMining.address },
  })

  const wPool = await ConvexStakingWrapperFactory.deploy()
  await wPool.deployed()
  await (await wPool.initialize(eUSD_FRAX_BP_POOL_ID)).wait()

  const collateral = <CvxStableRTokenMetapoolCollateral>await CvxStableCollateralFactory.connect(
    deployer
  ).deploy(
    {
      erc20: wPool.address,
      targetName: ethers.utils.formatBytes32String('USD'),
      priceTimeout: PRICE_TIMEOUT,
      chainlinkFeed: ONE_ADDRESS, // unused but cannot be zero
      oracleError: bn('1'), // unused but cannot be zero
      oracleTimeout: bn('1'), // unused but cannot be zero
      maxTradeVolume: MAX_TRADE_VOL,
      defaultThreshold: DEFAULT_THRESHOLD, // 2%: 1% error on FRAX oracle + 1% base defaultThreshold
      delayUntilDefault: RTOKEN_DELAY_UNTIL_DEFAULT,
    },
    revenueHiding.toString(),
    {
      nTokens: 2,
      curvePool: FRAX_BP,
      poolType: CurvePoolType.Plain,
      feeds: [[FRAX_USD_FEED], [USDC_USD_FEED]],
      oracleTimeouts: [
        [oracleTimeout(chainId, FRAX_ORACLE_TIMEOUT)],
        [oracleTimeout(chainId, USDC_ORACLE_TIMEOUT)],
      ],
      oracleErrors: [[FRAX_ORACLE_ERROR], [USDC_ORACLE_ERROR]],
      lpToken: FRAX_BP_TOKEN,
    },
    eUSD_FRAX_BP,
    DEFAULT_THRESHOLD // 2%
  )
  await collateral.deployed()
  await (await collateral.refresh()).wait()
  expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

  console.log(
    `Deployed Convex RToken Metapool Collateral to ${hre.network.name} (${chainId}): ${collateral.address}`
  )

  assetCollDeployments.collateral.cvxeUSDFRAXBP = collateral.address
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
