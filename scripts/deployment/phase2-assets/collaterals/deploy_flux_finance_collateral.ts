import fs from 'fs'
import hre, { ethers } from 'hardhat'
import { expect } from 'chai'
import { getChainId } from '../../../../common/blockchain-utils'
import { networkConfig } from '../../../../common/configuration'
import { bn, fp } from '../../../../common/numbers'
import { CollateralStatus } from '../../../../common/constants'
import {
  getDeploymentFile,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
  getDeploymentFilename,
  fileExists,
} from '../../common'
import { priceTimeout, oracleTimeout, revenueHiding } from '../../utils'
import { ICollateral } from '../../../../typechain'

async function main() {
  // ==== Read Configuration ====
  const [burner] = await hre.ethers.getSigners()

  const chainId = await getChainId(hre)

  console.log(`Deploying Collateral to network ${hre.network.name} (${chainId})
  with burner account: ${burner.address}`)

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

  // Get Oracle Lib address if previously deployed (can override with arbitrary address)
  const deployedCollateral: string[] = []

  /********  Deploy FToken Fiat Collateral - fUSDC  **************************/
  const FTokenFactory = await ethers.getContractFactory('CTokenVault')
  const fUsdc = await ethers.getContractAt('IERC20Metadata', networkConfig[chainId].tokens.fUSDC!)

  const fUsdcVault = await FTokenFactory.deploy(
    networkConfig[chainId].tokens.fUSDC!,
    `${await fUsdc.name()} Vault`,
    `${await fUsdc.symbol()}-VAULT`,
    networkConfig[chainId].COMPTROLLER!
  )

  await fUsdcVault.deployed()

  console.log(
    `Deployed Vault for fUSDC on ${hre.network.name} (${chainId}): ${fUsdcVault.address} `
  )

  const { collateral: fUsdcCollateral } = await hre.run('deploy-ctoken-fiat-collateral', {
    priceTimeout: priceTimeout.toString(),
    priceFeed: networkConfig[chainId].chainlinkFeeds.USDC,
    oracleError: fp('0.0025').toString(), // 0.25%
    cToken: fUsdcVault.address,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: oracleTimeout(chainId, '86400').toString(), // 24 hr
    targetName: hre.ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.0125').toString(), // 1.25%
    delayUntilDefault: bn('86400').toString(), // 24h
    revenueHiding: revenueHiding.toString(),
  })
  let collateral = <ICollateral>await ethers.getContractAt('ICollateral', fUsdcCollateral)
  await (await collateral.refresh()).wait()
  expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

  assetCollDeployments.collateral.fUSDC = fUsdcCollateral
  assetCollDeployments.erc20s.fUSDC = fUsdcVault.address
  deployedCollateral.push(fUsdcCollateral.toString())

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

  /********  Deploy FToken Fiat Collateral - fUSDT  **************************/
  const fUsdt = await ethers.getContractAt('IERC20Metadata', networkConfig[chainId].tokens.fUSDT!)

  const fUsdtVault = await FTokenFactory.deploy(
    networkConfig[chainId].tokens.fUSDT!,
    `${await fUsdt.name()} Vault`,
    `${await fUsdt.symbol()}-VAULT`,
    networkConfig[chainId].COMPTROLLER!
  )

  await fUsdtVault.deployed()

  console.log(
    `Deployed Vault for fUSDT on ${hre.network.name} (${chainId}): ${fUsdtVault.address} `
  )

  const { collateral: fUsdtCollateral } = await hre.run('deploy-ctoken-fiat-collateral', {
    priceTimeout: priceTimeout.toString(),
    priceFeed: networkConfig[chainId].chainlinkFeeds.USDT,
    oracleError: fp('0.0025').toString(), // 0.25%
    cToken: fUsdtVault.address,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: oracleTimeout(chainId, '86400').toString(), // 24 hr
    targetName: hre.ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.0125').toString(), // 1.25%
    delayUntilDefault: bn('86400').toString(), // 24h
    revenueHiding: revenueHiding.toString(),
  })
  collateral = <ICollateral>await ethers.getContractAt('ICollateral', fUsdtCollateral)
  await (await collateral.refresh()).wait()
  expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

  assetCollDeployments.collateral.fUSDT = fUsdtCollateral
  assetCollDeployments.erc20s.fUSDT = fUsdtVault.address
  deployedCollateral.push(fUsdtCollateral.toString())

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

  /********  Deploy FToken Fiat Collateral - fDAI  **************************/
  const fDai = await ethers.getContractAt('IERC20Metadata', networkConfig[chainId].tokens.fDAI!)

  const fDaiVault = await FTokenFactory.deploy(
    networkConfig[chainId].tokens.fDAI!,
    `${await fDai.name()} Vault`,
    `${await fDai.symbol()}-VAULT`,
    networkConfig[chainId].COMPTROLLER!
  )

  await fDaiVault.deployed()

  console.log(`Deployed Vault for fDAI on ${hre.network.name} (${chainId}): ${fDaiVault.address} `)

  const { collateral: fDaiCollateral } = await hre.run('deploy-ctoken-fiat-collateral', {
    priceTimeout: priceTimeout.toString(),
    priceFeed: networkConfig[chainId].chainlinkFeeds.DAI,
    oracleError: fp('0.0025').toString(), // 0.25%
    cToken: fDaiVault.address,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: oracleTimeout(chainId, '3600').toString(), // 1 hr
    targetName: hre.ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.0125').toString(), // 1.25%
    delayUntilDefault: bn('86400').toString(), // 24h
    revenueHiding: revenueHiding.toString(),
  })
  collateral = <ICollateral>await ethers.getContractAt('ICollateral', fDaiCollateral)
  await collateral.refresh()
  expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

  assetCollDeployments.collateral.fDAI = fDaiCollateral
  assetCollDeployments.erc20s.fDAI = fDaiVault.address
  deployedCollateral.push(fDaiCollateral.toString())

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

  /********  Deploy FToken Fiat Collateral - fFRAX  **************************/
  const fFrax = await ethers.getContractAt('IERC20Metadata', networkConfig[chainId].tokens.fFRAX!)

  const fFraxVault = await FTokenFactory.deploy(
    networkConfig[chainId].tokens.fFRAX!,
    `${await fFrax.name()} Vault`,
    `${await fFrax.symbol()}-VAULT`,
    networkConfig[chainId].COMPTROLLER!
  )

  await fFraxVault.deployed()

  console.log(
    `Deployed Vault for fFRAX on ${hre.network.name} (${chainId}): ${fFraxVault.address} `
  )

  const { collateral: fFRAXCollateral } = await hre.run('deploy-ctoken-fiat-collateral', {
    priceTimeout: priceTimeout.toString(),
    priceFeed: networkConfig[chainId].chainlinkFeeds.FRAX,
    oracleError: fp('0.01').toString(), // 1%
    cToken: fFraxVault.address,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: oracleTimeout(chainId, '3600').toString(), // 1 hr
    targetName: hre.ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.02').toString(), // 2%
    delayUntilDefault: bn('86400').toString(), // 24h
    revenueHiding: revenueHiding.toString(),
  })
  collateral = <ICollateral>await ethers.getContractAt('ICollateral', fFRAXCollateral)
  await collateral.refresh()
  expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

  assetCollDeployments.collateral.fFRAX = fFRAXCollateral
  assetCollDeployments.erc20s.fFRAX = fFraxVault.address
  deployedCollateral.push(fFRAXCollateral.toString())

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

  console.log(`Deployed collateral to ${hre.network.name} (${chainId})
    New deployments: ${deployedCollateral}
    Deployment file: ${assetCollDeploymentFilename}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
