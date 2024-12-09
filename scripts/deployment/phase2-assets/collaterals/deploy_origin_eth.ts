import fs from 'fs'
import hre from 'hardhat'
import { getChainId } from '../../../../common/blockchain-utils'
import { baseL2Chains, networkConfig } from '../../../../common/configuration'
import { bn, fp } from '../../../../common/numbers'
import { expect } from 'chai'
import { CollateralStatus } from '../../../../common/constants'
import {
  BASE_PRICE_FEEDS,
  BASE_ORACLE_ERROR,
  BASE_FEEDS_TIMEOUT,
} from '../../../../test/plugins/individual-collateral/origin/constants'
import {
  getDeploymentFile,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
  getDeploymentFilename,
  fileExists,
} from '../../common'
import { priceTimeout } from '../../utils'
import { OETHCollateralL2Base } from '../../../../typechain'
import { ContractFactory } from 'ethers'

async function main() {
  // ==== Read Configuration ====
  const [deployer] = await hre.ethers.getSigners()

  const chainId = await getChainId(hre)

  console.log(`Deploying Origin ETH to network ${hre.network.name} (${chainId})
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

  /********  Deploy Super Origin ETH Collateral - wsuperOETHb  **************************/

  // Only for Base
  if (!baseL2Chains.includes(hre.network.name)) {
    throw new Error(`Unsupported chainId: ${chainId}`)
  }

  const OETHCollateralL2BaseFactory: ContractFactory = await hre.ethers.getContractFactory(
    'OETHCollateralL2Base'
  )

  const collateral = <OETHCollateralL2Base>await OETHCollateralL2BaseFactory.connect(
    deployer
  ).deploy(
    {
      priceTimeout: priceTimeout.toString(),
      chainlinkFeed: BASE_PRICE_FEEDS.wsuperOETHb_ETH, // ignored
      oracleError: BASE_ORACLE_ERROR.toString(), // 0.5% + 0.5%
      erc20: networkConfig[chainId].tokens.wsuperOETHb,
      maxTradeVolume: fp('1e6').toString(), // $1m,
      oracleTimeout: BASE_FEEDS_TIMEOUT.wsuperOETHb_ETH, // ignored
      targetName: hre.ethers.utils.formatBytes32String('ETH'),
      defaultThreshold: fp('0.02').add(BASE_ORACLE_ERROR).toString(),
      delayUntilDefault: bn('86400').toString(), // 24h
    },
    fp('1e-4').toString(), // revenueHiding = 0.01%
    BASE_PRICE_FEEDS.wsuperOETHb_ETH, // targetPerTokChainlinkFeed
    BASE_PRICE_FEEDS.ETH_USD, // uoaPerTargetChainlinkFeed
    BASE_FEEDS_TIMEOUT.ETH_USD // uoaPerTarget timeout
  )
  await collateral.deployed()
  await (await collateral.refresh()).wait()
  expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

  console.log(`Deployed Origin ETH to ${hre.network.name} (${chainId}): ${collateral.address}`)

  assetCollDeployments.collateral.wsuperOETHb = collateral.address
  assetCollDeployments.erc20s.wsuperOETHb = networkConfig[chainId].tokens.wsuperOETHb
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
