import fs from 'fs'
import hre, { ethers } from 'hardhat'
import { getChainId } from '../../../../common/blockchain-utils'
import { baseL2Chains, networkConfig } from '../../../../common/configuration'
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
  PYUSD_MAX_TRADE_VOLUME,
  PYUSD_ORACLE_TIMEOUT,
  PYUSD_ORACLE_ERROR,
} from '../../../../test/plugins/individual-collateral/aave-v3/constants'

// This file specifically deploys Aave V3 pyUSD collateral on Mainnet

async function main() {
  // ==== Read Configuration ====
  const [deployer] = await hre.ethers.getSigners()

  const chainId = await getChainId(hre)

  console.log(`Deploying Collateral to network ${hre.network.name} (${chainId})
    with burner account: ${deployer.address}`)

  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${hre.network.name}`)
  }

  // Only exists on Mainnet
  if (baseL2Chains.includes(hre.network.name)) {
    throw new Error(`Invalid network ${hre.network.name} - only available on Mainnet`)
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

  const CollateralFactory = await ethers.getContractFactory('AaveV3FiatCollateral')
  const StaticATokenFactory = await hre.ethers.getContractFactory('StaticATokenV3LM')

  /********  Deploy Aave V3 pyUSD ERC20  **************************/

  const erc20 = await StaticATokenFactory.deploy(
    networkConfig[chainId].AAVE_V3_POOL!,
    networkConfig[chainId].AAVE_V3_INCENTIVES_CONTROLLER!
  )
  await erc20.deployed()
  await (
    await erc20.initialize(
      networkConfig[chainId].tokens.aEthPyUSD!,
      'Static Aave Ethereum pyUSD',
      'saEthPyUSD'
    )
  ).wait()

  /********  Deploy Aave V3 pyUSD collateral plugin  **************************/

  const collateral = <AaveV3FiatCollateral>await CollateralFactory.connect(deployer).deploy(
    {
      priceTimeout: priceTimeout,
      chainlinkFeed: networkConfig[chainId].chainlinkFeeds.pyUSD!,
      oracleError: PYUSD_ORACLE_ERROR,
      erc20: erc20.address,
      maxTradeVolume: PYUSD_MAX_TRADE_VOLUME,
      oracleTimeout: PYUSD_ORACLE_TIMEOUT,
      targetName: ethers.utils.formatBytes32String('USD'),
      defaultThreshold: fp('0.01').add(PYUSD_ORACLE_ERROR),
      delayUntilDefault: bn('86400'),
    },
    revenueHiding
  )
  await collateral.deployed()
  await (await collateral.refresh()).wait()
  expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

  console.log(
    `Deployed Aave V3 pyUSD collateral to ${hre.network.name} (${chainId}): ${collateral.address}`
  )

  assetCollDeployments.erc20s.saEthPyUSD = erc20.address
  assetCollDeployments.collateral.saEthPyUSD = collateral.address
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
