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
import { StakeDAORecursiveCollateral } from '../../../../typechain'
import {
  CurvePoolType,
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
  USDC_USDCPLUS_GAUGE,
  USDC_USDCPLUS_POOL,
  USDC_USDCPLUS_LP_TOKEN,
  USDC_USD_FEED,
  USDC_ORACLE_TIMEOUT,
  USDC_ORACLE_ERROR,
  MAX_TRADE_VOL,
  PRICE_TIMEOUT,
} from '../../../../test/plugins/individual-collateral/curve/constants'

// This file specifically deploys StakeDAORecursiveCollateral Plugin for USDC/USDC+

async function main() {
  // ==== Read Configuration ====
  const [deployer] = await hre.ethers.getSigners()

  const chainId = await getChainId(hre)

  console.log(`Deploying StakeDAORecursiveCollateral to network ${hre.network.name} (${chainId})
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

  /********  Deploy StakeDAO Recursive RToken Collateral for USDC/USDC+  **************************/

  const CollateralFactory = await hre.ethers.getContractFactory('StakeDAORecursiveCollateral')

  const collateral = <StakeDAORecursiveCollateral>await CollateralFactory.connect(deployer).deploy(
    {
      erc20: USDC_USDCPLUS_GAUGE,
      targetName: hre.ethers.utils.formatBytes32String('USD'),
      priceTimeout: PRICE_TIMEOUT,
      chainlinkFeed: ONE_ADDRESS,
      oracleError: bn('1'),
      oracleTimeout: bn('1'),
      maxTradeVolume: MAX_TRADE_VOL,
      defaultThreshold: DEFAULT_THRESHOLD.add(USDC_ORACLE_ERROR),
      delayUntilDefault: DELAY_UNTIL_DEFAULT, // 72h
    },
    fp('1e-4'), // backtest to confirm: 0.01% since pool virtual price will probably decrease
    {
      nTokens: 2,
      curvePool: USDC_USDCPLUS_POOL,
      poolType: CurvePoolType.Plain,
      feeds: [[USDC_USD_FEED], [ONE_ADDRESS]],
      oracleTimeouts: [[USDC_ORACLE_TIMEOUT], [bn('1')]],
      oracleErrors: [[USDC_ORACLE_ERROR], [bn('1')]],
      lpToken: USDC_USDCPLUS_LP_TOKEN,
    }
  )
  await collateral.deployed()
  await (await collateral.refresh()).wait()
  expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

  console.log(
    `Deployed StakeDAO Recursive Collateral to ${hre.network.name} (${chainId}): ${collateral.address}`
  )

  assetCollDeployments.collateral.sdUSDCUSDCPlus = collateral.address
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
