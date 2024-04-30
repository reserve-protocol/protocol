import fs from 'fs'
import hre from 'hardhat'
import { getChainId } from '../../../../common/blockchain-utils'
import { networkConfig } from '../../../../common/configuration'
import { expect } from 'chai'
import { ONE_ADDRESS, CollateralStatus } from '../../../../common/constants'
import { bn, fp } from '../../../../common/numbers'
import {
  getDeploymentFile,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
  getDeploymentFilename,
  fileExists,
} from '../../common'
import { CurveAppreciatingRTokenSelfReferentialCollateral } from '../../../../typechain'
import {
  CurvePoolType,
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
  ETHPLUS_BP_POOL_ID,
  ETHPLUS_BP_POOL,
  ETHPLUS_BP_TOKEN,
  WETH_USD_FEED,
  WETH_ORACLE_TIMEOUT,
  WETH_ORACLE_ERROR,
  MAX_TRADE_VOL,
  PRICE_TIMEOUT,
} from '../../../../test/plugins/individual-collateral/curve/constants'

// This file specifically deploys CurveAppreciatingRTokenSelfReferentialCollateral Plugin for ETH+/ETH

async function main() {
  // ==== Read Configuration ====
  const [deployer] = await hre.ethers.getSigners()

  const chainId = await getChainId(hre)

  console.log(`Deploying CurveAppreciatingRTokenSelfReferentialCollateral to network ${hre.network.name} (${chainId})
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

  /********  Deploy Convex Appreciating RToken Collateral for ETH+/ETH  **************************/

  const CurveStableCollateralFactory = await hre.ethers.getContractFactory(
    'CurveAppreciatingRTokenSelfReferentialCollateral'
  )
  const ConvexStakingWrapperFactory = await hre.ethers.getContractFactory('ConvexStakingWrapper')

  const wPool = await ConvexStakingWrapperFactory.deploy()
  await wPool.deployed()
  await (await wPool.initialize(ETHPLUS_BP_POOL_ID)).wait()

  console.log(
    `Deployed wrapper for Convex Stable ETH+/ETH on ${hre.network.name} (${chainId}): ${wPool.address} `
  )

  const collateral = <CurveAppreciatingRTokenSelfReferentialCollateral>(
    await CurveStableCollateralFactory.connect(deployer).deploy(
      {
        erc20: wPool.address,
        targetName: hre.ethers.utils.formatBytes32String('ETH'),
        priceTimeout: PRICE_TIMEOUT,
        chainlinkFeed: ONE_ADDRESS,
        oracleError: bn('1'),
        oracleTimeout: bn('1'),
        maxTradeVolume: MAX_TRADE_VOL,
        defaultThreshold: DEFAULT_THRESHOLD.add(WETH_ORACLE_ERROR),
        delayUntilDefault: DELAY_UNTIL_DEFAULT, // 72h
      },
      fp('1e-3').toString(),
      {
        nTokens: 2,
        curvePool: ETHPLUS_BP_POOL,
        poolType: CurvePoolType.Plain,
        feeds: [[ONE_ADDRESS], [WETH_USD_FEED]],
        oracleTimeouts: [[bn('1')], [WETH_ORACLE_TIMEOUT]],
        oracleErrors: [[bn('1')], [WETH_ORACLE_ERROR]],
        lpToken: ETHPLUS_BP_TOKEN,
      }
    )
  )
  await collateral.deployed()
  await (await collateral.refresh()).wait()
  expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

  console.log(
    `Deployed Convex Metapool Collateral to ${hre.network.name} (${chainId}): ${collateral.address}`
  )

  assetCollDeployments.collateral.cvxETHPlusETH = collateral.address
  assetCollDeployments.erc20s.cvxETHPlusETH = wPool.address
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
