import fs from 'fs'
import hre, { ethers } from 'hardhat'
import { getChainId } from '../../../../common/blockchain-utils'
import { arbitrumL2Chains, networkConfig } from '../../../../common/configuration'
import { bn, fp } from '../../../../common/numbers'
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
  ConvexStakingWrapper,
  CurveStableCollateral,
  L2ConvexStableCollateral,
  IConvexRewardPool,
} from '../../../../typechain'
import { combinedError, revenueHiding } from '../../utils'
import {
  CurvePoolType,
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
  MAX_TRADE_VOL,
  PRICE_TIMEOUT,
  crvUSD_USDT,
  crvUSD_USDT_POOL_ID,
  USDT_ORACLE_ERROR,
  USDT_ORACLE_TIMEOUT,
  USDT_USD_FEED,
  crvUSD_ORACLE_ERROR,
  crvUSD_ORACLE_TIMEOUT,
  crvUSD_USD_FEED,
  ARB_crvUSD_USDT,
  ARB_Convex_crvUSD_USDT,
  ARB_USDT_ORACLE_ERROR,
  ARB_USDT_ORACLE_TIMEOUT,
  ARB_USDT_USD_FEED,
  ARB_crvUSD_ORACLE_ERROR,
  ARB_crvUSD_ORACLE_TIMEOUT,
  ARB_crvUSD_USD_FEED,
} from '../../../../test/plugins/individual-collateral/curve/constants'

// Convex Stable Plugin: crvUSD-USDT

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

  /********  Deploy Convex Stable Pool for crvUSD-USDT  **************************/

  let collateral: CurveStableCollateral | L2ConvexStableCollateral
  let crvUsdUSDTPool: ConvexStakingWrapper | IConvexRewardPool // no wrapper needed for L2s

  if (!arbitrumL2Chains.includes(hre.network.name)) {
    const CurveStableCollateralFactory = await hre.ethers.getContractFactory(
      'CurveStableCollateral'
    )
    const ConvexStakingWrapperFactory = await ethers.getContractFactory('ConvexStakingWrapper')

    crvUsdUSDTPool = <ConvexStakingWrapper>await ConvexStakingWrapperFactory.deploy()
    await crvUsdUSDTPool.deployed()
    await (await crvUsdUSDTPool.initialize(crvUSD_USDT_POOL_ID)).wait()

    console.log(
      `Deployed wrapper for Convex Stable crvUSD-USDT pool on ${hre.network.name} (${chainId}): ${crvUsdUSDTPool.address} `
    )

    collateral = <CurveStableCollateral>await CurveStableCollateralFactory.connect(deployer).deploy(
      {
        erc20: crvUsdUSDTPool.address,
        targetName: ethers.utils.formatBytes32String('USD'),
        priceTimeout: PRICE_TIMEOUT,
        chainlinkFeed: ONE_ADDRESS, // unused but cannot be zero
        oracleError: bn('1'), // unused but cannot be zero
        oracleTimeout: USDT_ORACLE_TIMEOUT, // max of oracleTimeouts
        maxTradeVolume: MAX_TRADE_VOL,
        defaultThreshold: DEFAULT_THRESHOLD,
        delayUntilDefault: DELAY_UNTIL_DEFAULT,
      },
      revenueHiding.toString(),
      {
        nTokens: 2,
        curvePool: crvUSD_USDT,
        poolType: CurvePoolType.Plain,
        feeds: [[USDT_USD_FEED], [crvUSD_USD_FEED]],
        oracleTimeouts: [[USDT_ORACLE_TIMEOUT], [crvUSD_ORACLE_TIMEOUT]],
        oracleErrors: [[USDT_ORACLE_ERROR], [crvUSD_ORACLE_ERROR]],
        lpToken: crvUSD_USDT,
      }
    )
  } else if (chainId == '42161' || chainId == '421614') {
    const L2ConvexStableCollateralFactory = await hre.ethers.getContractFactory(
      'L2ConvexStableCollateral'
    )
    crvUsdUSDTPool = <IConvexRewardPool>(
      await ethers.getContractAt('IConvexRewardPool', ARB_Convex_crvUSD_USDT)
    )
    collateral = <L2ConvexStableCollateral>await L2ConvexStableCollateralFactory.connect(
      deployer
    ).deploy(
      {
        erc20: crvUsdUSDTPool.address,
        targetName: ethers.utils.formatBytes32String('USD'),
        priceTimeout: PRICE_TIMEOUT,
        chainlinkFeed: ONE_ADDRESS, // unused but cannot be zero
        oracleError: bn('1'), // unused but cannot be zero
        oracleTimeout: ARB_USDT_ORACLE_TIMEOUT, // max of oracleTimeouts
        maxTradeVolume: MAX_TRADE_VOL,
        defaultThreshold: combinedError(ARB_crvUSD_ORACLE_ERROR, ARB_USDT_ORACLE_ERROR)
          .add(fp('0.01'))
          .toString(),
        delayUntilDefault: DELAY_UNTIL_DEFAULT,
      },
      revenueHiding.toString(),
      {
        nTokens: 2,
        curvePool: ARB_crvUSD_USDT,
        poolType: CurvePoolType.Plain,
        feeds: [[ARB_crvUSD_USD_FEED], [ARB_USDT_USD_FEED]],
        oracleTimeouts: [[ARB_crvUSD_ORACLE_TIMEOUT], [ARB_USDT_ORACLE_TIMEOUT]],
        oracleErrors: [[ARB_crvUSD_ORACLE_ERROR], [ARB_USDT_ORACLE_ERROR]],
        lpToken: ARB_crvUSD_USDT,
      }
    )
  } else {
    throw new Error(`Unsupported chainId: ${chainId}`)
  }

  await collateral.deployed()
  await (await collateral.refresh()).wait()
  expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

  console.log(
    `Deployed Convex Stable Collateral for crvUSD-USDT to ${hre.network.name} (${chainId}): ${collateral.address}`
  )

  assetCollDeployments.collateral.cvxCrvUSDUSDT = collateral.address
  assetCollDeployments.erc20s.cvxCrvUSDUSDT = crvUsdUSDTPool.address
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
