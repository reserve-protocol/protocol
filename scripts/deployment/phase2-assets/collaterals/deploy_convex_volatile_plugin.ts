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
import { CvxVolatileCollateral } from '../../../../typechain'
import { revenueHiding, oracleTimeout } from '../../utils'
import {
  CurvePoolType,
  BTC_USD_ORACLE_ERROR,
  BTC_ORACLE_TIMEOUT,
  BTC_USD_FEED,
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
  MAX_TRADE_VOL,
  PRICE_TIMEOUT,
  TRI_CRYPTO,
  TRI_CRYPTO_TOKEN,
  TRI_CRYPTO_CVX_POOL_ID,
  WBTC_BTC_ORACLE_ERROR,
  WETH_ORACLE_TIMEOUT,
  WBTC_BTC_FEED,
  WBTC_ORACLE_TIMEOUT,
  WETH_USD_FEED,
  WETH_ORACLE_ERROR,
  USDT_ORACLE_ERROR,
  USDT_ORACLE_TIMEOUT,
  USDT_USD_FEED,
} from '../../../../test/plugins/individual-collateral/convex/constants'

// This file specifically deploys Convex Volatile Plugin for Tricrypto

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

  /********  Deploy Convex Volatile Pool for 3pool  **************************/

  const CvxMining = await ethers.getContractAt('CvxMining', deployments.cvxMiningLib)
  const CvxVolatileCollateralFactory = await hre.ethers.getContractFactory('CvxVolatileCollateral')
  const ConvexStakingWrapperFactory = await ethers.getContractFactory('ConvexStakingWrapper', {
    libraries: { CvxMining: CvxMining.address },
  })

  const w3Pool = await ConvexStakingWrapperFactory.deploy()
  await w3Pool.deployed()
  await (await w3Pool.initialize(TRI_CRYPTO_CVX_POOL_ID)).wait()

  const collateral = <CvxVolatileCollateral>await CvxVolatileCollateralFactory.connect(
    deployer
  ).deploy(
    {
      erc20: w3Pool.address,
      targetName: ethers.utils.formatBytes32String('TRICRYPTO'),
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
      curvePool: TRI_CRYPTO,
      poolType: CurvePoolType.Plain,
      feeds: [[USDT_USD_FEED], [WBTC_BTC_FEED, BTC_USD_FEED], [WETH_USD_FEED]],
      oracleTimeouts: [
        [oracleTimeout(chainId, USDT_ORACLE_TIMEOUT)],
        [oracleTimeout(chainId, WBTC_ORACLE_TIMEOUT), oracleTimeout(chainId, BTC_ORACLE_TIMEOUT)],
        [oracleTimeout(chainId, WETH_ORACLE_TIMEOUT)],
      ],
      oracleErrors: [
        [USDT_ORACLE_ERROR],
        [WBTC_BTC_ORACLE_ERROR, BTC_USD_ORACLE_ERROR],
        [WETH_ORACLE_ERROR],
      ],
      lpToken: TRI_CRYPTO_TOKEN,
    }
  )
  await collateral.deployed()
  await (await collateral.refresh()).wait()
  expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

  console.log(
    `Deployed Convex Volatile Collateral to ${hre.network.name} (${chainId}): ${collateral.address}`
  )

  assetCollDeployments.collateral.cvxTriCrypto = collateral.address
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
