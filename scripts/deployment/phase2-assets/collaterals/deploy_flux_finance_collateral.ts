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

  const { collateral: fUsdcCollateral } = await hre.run('deploy-ctoken-fiat-collateral', {
    priceTimeout: priceTimeout.toString(),
    priceFeed: networkConfig[chainId].chainlinkFeeds.USDC,
    oracleError: fp('0.0025').toString(), // 0.25%
    cToken: networkConfig[chainId].tokens.fUSDC,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: oracleTimeout(chainId, '86400').toString(), // 24 hr
    targetName: hre.ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.0125').toString(), // 1.25%
    delayUntilDefault: bn('86400').toString(), // 24h
    revenueHiding: revenueHiding.toString(),
    comptroller: networkConfig[chainId].FLUX_FINANCE_COMPTROLLER,
  })
  let collateral = <ICollateral>await ethers.getContractAt('ICollateral', fUsdcCollateral)
  await (await collateral.refresh()).wait()
  expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

  assetCollDeployments.collateral.fUSDC = fUsdcCollateral
  deployedCollateral.push(fUsdcCollateral.toString())

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

  /********  Deploy FToken Fiat Collateral - fUSDT  **************************/

  const { collateral: fUsdtCollateral } = await hre.run('deploy-ctoken-fiat-collateral', {
    priceTimeout: priceTimeout.toString(),
    priceFeed: networkConfig[chainId].chainlinkFeeds.USDT,
    oracleError: fp('0.0025').toString(), // 0.25%
    cToken: networkConfig[chainId].tokens.fUSDT,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: oracleTimeout(chainId, '86400').toString(), // 24 hr
    targetName: hre.ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.0125').toString(), // 1.25%
    delayUntilDefault: bn('86400').toString(), // 24h
    revenueHiding: revenueHiding.toString(),
    comptroller: networkConfig[chainId].FLUX_FINANCE_COMPTROLLER,
  })
  collateral = <ICollateral>await ethers.getContractAt('ICollateral', fUsdtCollateral)
  await (await collateral.refresh()).wait()
  expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

  assetCollDeployments.collateral.fUSDT = fUsdtCollateral
  deployedCollateral.push(fUsdtCollateral.toString())

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

  /********  Deploy FToken Fiat Collateral - fDAI  **************************/

  const { collateral: fDaiCollateral } = await hre.run('deploy-ctoken-fiat-collateral', {
    priceTimeout: priceTimeout.toString(),
    priceFeed: networkConfig[chainId].chainlinkFeeds.DAI,
    oracleError: fp('0.0025').toString(), // 0.25%
    cToken: networkConfig[chainId].tokens.fDAI,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: oracleTimeout(chainId, '3600').toString(), // 1 hr
    targetName: hre.ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.0125').toString(), // 1.25%
    delayUntilDefault: bn('86400').toString(), // 24h
    revenueHiding: revenueHiding.toString(),
    comptroller: networkConfig[chainId].FLUX_FINANCE_COMPTROLLER,
  })
  collateral = <ICollateral>await ethers.getContractAt('ICollateral', fDaiCollateral)
  await collateral.refresh()
  expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

  assetCollDeployments.collateral.fDAI = fDaiCollateral
  deployedCollateral.push(fDaiCollateral.toString())

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

  /********  Deploy FToken Fiat Collateral - fFRAX  **************************/

  const { collateral: fFRAXCollateral } = await hre.run('deploy-ctoken-fiat-collateral', {
    priceTimeout: priceTimeout.toString(),
    priceFeed: networkConfig[chainId].chainlinkFeeds.FRAX,
    oracleError: fp('0.01').toString(), // 1%
    cToken: networkConfig[chainId].tokens.fFRAX,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: oracleTimeout(chainId, '3600').toString(), // 1 hr
    targetName: hre.ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.02').toString(), // 2%
    delayUntilDefault: bn('86400').toString(), // 24h
    revenueHiding: revenueHiding.toString(),
    comptroller: networkConfig[chainId].FLUX_FINANCE_COMPTROLLER,
  })
  collateral = <ICollateral>await ethers.getContractAt('ICollateral', fFRAXCollateral)
  await collateral.refresh()
  expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

  assetCollDeployments.collateral.fFRAX = fFRAXCollateral
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
