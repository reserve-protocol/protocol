import fs from 'fs'
import hre, { ethers } from 'hardhat'
import { getChainId } from '../../../../common/blockchain-utils'
import { arbitrumL2Chains, baseL2Chains, networkConfig } from '../../../../common/configuration'
import { expect } from 'chai'
import { CollateralStatus } from '../../../../common/constants'
import {
  getDeploymentFile,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
  getDeploymentFilename,
  fileExists,
} from '../../common'
import { bn, fp } from '#/common/numbers'
import { AaveV3FiatCollateral } from '../../../../typechain'
import { priceTimeout, revenueHiding } from '../../utils'
import {
  USDT_ARBITRUM_MAX_TRADE_VOLUME,
  USDT_ARBITRUM_ORACLE_TIMEOUT,
  USDT_ARBITRUM_ORACLE_ERROR,
} from '../../../../test/plugins/individual-collateral/aave-v3/constants'

// This file specifically deploys Aave V3 USDT collateral on Arbitrum

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

  /********  Deploy Aave V3 USDT collateral plugin  **************************/

  const CollateralFactory = await ethers.getContractFactory('AaveV3FiatCollateral')
  const StaticATokenFactory = await hre.ethers.getContractFactory('StaticATokenV3LM')
  const erc20 = await StaticATokenFactory.deploy(
    networkConfig[chainId].AAVE_V3_POOL!,
    networkConfig[chainId].AAVE_V3_INCENTIVES_CONTROLLER!
  )
  await erc20.deployed()

  /********  Deploy Aave V3 USDT wrapper  **************************/

  if (arbitrumL2Chains.includes(hre.network.name)) {
    // === Arbitrum ===

    await (
      await erc20.initialize(
        networkConfig[chainId].tokens.aArbUSDT!,
        'Static Aave Arbitrum USDT',
        'saArbUSDT'
      )
    ).wait()

    console.log(
      `Deployed wrapper for Aave V3 USDT on ${hre.network.name} (${chainId}): ${erc20.address} `
    )

    const collateral = <AaveV3FiatCollateral>await CollateralFactory.connect(deployer).deploy(
      {
        priceTimeout: priceTimeout,
        chainlinkFeed: networkConfig[chainId].chainlinkFeeds.USDT!,
        oracleError: USDT_ARBITRUM_ORACLE_ERROR.toString(),
        erc20: erc20.address,
        maxTradeVolume: USDT_ARBITRUM_MAX_TRADE_VOLUME.toString(),
        oracleTimeout: USDT_ARBITRUM_ORACLE_TIMEOUT.toString(),
        targetName: ethers.utils.formatBytes32String('USD'),
        defaultThreshold: fp('0.01').add(USDT_ARBITRUM_ORACLE_ERROR).toString(),
        delayUntilDefault: bn('86400').toString(),
      },
      revenueHiding.toString()
    )
    await collateral.deployed()
    await (await collateral.refresh()).wait()
    expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

    console.log(
      `Deployed Aave V3 USDT collateral to ${hre.network.name} (${chainId}): ${collateral.address}`
    )

    assetCollDeployments.erc20s.saArbUSDT = erc20.address
    assetCollDeployments.collateral.saArbUSDT = collateral.address
    deployedCollateral.push(collateral.address.toString())
  } else if (baseL2Chains.includes(hre.network.name)) {
    // === Base ===
    throw new Error('No Aave V3 USDT on Base')
  } else {
    // === Mainnet ===
    throw new Error('No Aave V3 USDT on Mainnet')
  }

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

  console.log(`Deployed collateral to ${hre.network.name} (${chainId})
        New deployments: ${deployedCollateral}
        Deployment file: ${assetCollDeploymentFilename}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
