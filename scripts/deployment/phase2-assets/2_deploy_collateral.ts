import fs from 'fs'
import hre, { ethers } from 'hardhat'
import { expect } from 'chai'
import { getChainId } from '../../../common/blockchain-utils'
import { networkConfig } from '../../../common/configuration'
import { bn, fp } from '../../../common/numbers'
import { CollateralStatus } from '../../../common/constants'
import {
  getDeploymentFile,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
  getDeploymentFilename,
  fileExists,
} from '../common'
import { combinedError, priceTimeout, oracleTimeout, revenueHiding } from '../utils'
import { ICollateral, ATokenMock, StaticATokenLM } from '../../../typechain'

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

  /********  Deploy Fiat Collateral - DAI  **************************/
  const { collateral: daiCollateral } = await hre.run('deploy-fiat-collateral', {
    priceTimeout: priceTimeout.toString(),
    priceFeed: networkConfig[chainId].chainlinkFeeds.DAI,
    oracleError: fp('0.0025').toString(), // 0.25%
    tokenAddress: networkConfig[chainId].tokens.DAI,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: oracleTimeout(chainId, '3600').toString(), // 1 hr
    targetName: hre.ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.0125').toString(), // 1.25%
    delayUntilDefault: bn('86400').toString(), // 24h
  })
  let collateral = <ICollateral>await ethers.getContractAt('ICollateral', daiCollateral)
  await (await collateral.refresh()).wait()
  expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

  assetCollDeployments.collateral.DAI = daiCollateral
  assetCollDeployments.erc20s.DAI = networkConfig[chainId].tokens.DAI
  deployedCollateral.push(daiCollateral.toString())

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

  /********  Deploy Fiat Collateral - USDC  **************************/
  const { collateral: usdcCollateral } = await hre.run('deploy-fiat-collateral', {
    priceTimeout: priceTimeout.toString(),
    priceFeed: networkConfig[chainId].chainlinkFeeds.USDC,
    oracleError: fp('0.0025').toString(), // 0.25%
    tokenAddress: networkConfig[chainId].tokens.USDC,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: oracleTimeout(chainId, '86400').toString(), // 24 hr
    targetName: hre.ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.0125').toString(), // 1.25%
    delayUntilDefault: bn('86400').toString(), // 24h
  })
  collateral = <ICollateral>await ethers.getContractAt('ICollateral', usdcCollateral)
  await (await collateral.refresh()).wait()
  expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

  assetCollDeployments.collateral.USDC = usdcCollateral
  assetCollDeployments.erc20s.USDC = networkConfig[chainId].tokens.USDC
  deployedCollateral.push(usdcCollateral.toString())

  /********  Deploy Fiat Collateral - USDT  **************************/
  const { collateral: usdtCollateral } = await hre.run('deploy-fiat-collateral', {
    priceTimeout: priceTimeout.toString(),
    priceFeed: networkConfig[chainId].chainlinkFeeds.USDT,
    oracleError: fp('0.0025').toString(), // 0.25%
    tokenAddress: networkConfig[chainId].tokens.USDT,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: oracleTimeout(chainId, '86400').toString(), // 24 hr
    targetName: hre.ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.0125').toString(), // 1.25%
    delayUntilDefault: bn('86400').toString(), // 24h
  })
  collateral = <ICollateral>await ethers.getContractAt('ICollateral', usdtCollateral)
  await (await collateral.refresh()).wait()
  expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

  assetCollDeployments.collateral.USDT = usdtCollateral
  assetCollDeployments.erc20s.USDT = networkConfig[chainId].tokens.USDT
  deployedCollateral.push(usdtCollateral.toString())

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

  /********  Deploy Fiat Collateral - USDP  **************************/
  const { collateral: usdpCollateral } = await hre.run('deploy-fiat-collateral', {
    priceTimeout: priceTimeout.toString(),
    priceFeed: networkConfig[chainId].chainlinkFeeds.USDP,
    oracleError: fp('0.01').toString(), // 1%
    tokenAddress: networkConfig[chainId].tokens.USDP,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: oracleTimeout(chainId, '3600').toString(), // 1 hr
    targetName: hre.ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.02').toString(), // 2%
    delayUntilDefault: bn('86400').toString(), // 24h
  })
  collateral = <ICollateral>await ethers.getContractAt('ICollateral', usdpCollateral)
  await (await collateral.refresh()).wait()
  expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

  assetCollDeployments.collateral.USDP = usdpCollateral
  assetCollDeployments.erc20s.USDP = networkConfig[chainId].tokens.USDP
  deployedCollateral.push(usdpCollateral.toString())

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

  /********  Deploy Fiat Collateral - TUSD  **************************/
  const { collateral: tusdCollateral } = await hre.run('deploy-fiat-collateral', {
    priceTimeout: priceTimeout.toString(),
    priceFeed: networkConfig[chainId].chainlinkFeeds.TUSD,
    oracleError: fp('0.003').toString(), // 0.3%
    tokenAddress: networkConfig[chainId].tokens.TUSD,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: oracleTimeout(chainId, '86400').toString(), // 24 hr
    targetName: hre.ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.013').toString(), // 1.3%
    delayUntilDefault: bn('86400').toString(), // 24h
  })
  collateral = <ICollateral>await ethers.getContractAt('ICollateral', tusdCollateral)
  await (await collateral.refresh()).wait()
  expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

  assetCollDeployments.collateral.TUSD = tusdCollateral
  assetCollDeployments.erc20s.TUSD = networkConfig[chainId].tokens.TUSD
  deployedCollateral.push(tusdCollateral.toString())

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

  /********  Deploy Fiat Collateral - BUSD  **************************/
  const { collateral: busdCollateral } = await hre.run('deploy-fiat-collateral', {
    priceTimeout: priceTimeout.toString(),
    priceFeed: networkConfig[chainId].chainlinkFeeds.BUSD,
    oracleError: fp('0.005').toString(), // 0.5%
    tokenAddress: networkConfig[chainId].tokens.BUSD,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: oracleTimeout(chainId, '86400').toString(), // 24 hr
    targetName: hre.ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.015').toString(), // 1.5%
    delayUntilDefault: bn('86400').toString(), // 24h
  })
  collateral = <ICollateral>await ethers.getContractAt('ICollateral', busdCollateral)
  await (await collateral.refresh()).wait()
  expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

  assetCollDeployments.collateral.BUSD = busdCollateral
  assetCollDeployments.erc20s.BUSD = networkConfig[chainId].tokens.BUSD
  deployedCollateral.push(busdCollateral.toString())

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

  /********  Deploy AToken Fiat Collateral - aDAI  **************************/

  // Get AToken to retrieve name and symbol
  let aToken: ATokenMock = <ATokenMock>(
    await ethers.getContractAt('ATokenMock', networkConfig[chainId].tokens.aDAI as string)
  )

  // Wrap in StaticAToken
  const StaticATokenFactory = await ethers.getContractFactory('StaticATokenLM')
  const adaiStaticToken: StaticATokenLM = <StaticATokenLM>(
    await StaticATokenFactory.connect(burner).deploy(
      networkConfig[chainId].AAVE_LENDING_POOL as string,
      aToken.address,
      'Static ' + (await aToken.name()),
      's' + (await aToken.symbol())
    )
  )
  await adaiStaticToken.deployed()
  console.log(
    `Deployed StaticAToken for aDAI on ${hre.network.name} (${chainId}): ${adaiStaticToken.address} `
  )

  const { collateral: aDaiCollateral } = await hre.run('deploy-atoken-fiat-collateral', {
    priceTimeout: priceTimeout.toString(),
    priceFeed: networkConfig[chainId].chainlinkFeeds.DAI,
    oracleError: fp('0.0025').toString(), // 0.25%
    staticAToken: adaiStaticToken.address,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: oracleTimeout(chainId, '3600').toString(), // 1 hr
    targetName: hre.ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.0125').toString(), // 1.25%
    delayUntilDefault: bn('86400').toString(), // 24h
    revenueHiding: revenueHiding.toString(),
  })
  collateral = <ICollateral>await ethers.getContractAt('ICollateral', aDaiCollateral)
  await (await collateral.refresh()).wait()
  expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

  assetCollDeployments.collateral.aDAI = aDaiCollateral
  assetCollDeployments.erc20s.aDAI = adaiStaticToken.address
  deployedCollateral.push(aDaiCollateral.toString())

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

  /********  Deploy AToken Fiat Collateral - aUSDC  **************************/

  // Get AToken to retrieve name and symbol
  aToken = <ATokenMock>(
    await ethers.getContractAt('ATokenMock', networkConfig[chainId].tokens.aUSDC as string)
  )

  // Wrap in StaticAToken
  const ausdcStaticToken: StaticATokenLM = <StaticATokenLM>(
    await StaticATokenFactory.connect(burner).deploy(
      networkConfig[chainId].AAVE_LENDING_POOL as string,
      aToken.address,
      'Static ' + (await aToken.name()),
      's' + (await aToken.symbol())
    )
  )
  await ausdcStaticToken.deployed()

  console.log(
    `Deployed StaticAToken for aUSDC on ${hre.network.name} (${chainId}): ${ausdcStaticToken.address} `
  )

  const { collateral: aUsdcCollateral } = await hre.run('deploy-atoken-fiat-collateral', {
    priceTimeout: priceTimeout.toString(),
    priceFeed: networkConfig[chainId].chainlinkFeeds.USDC,
    oracleError: fp('0.0025').toString(), // 0.25%
    staticAToken: ausdcStaticToken.address,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: oracleTimeout(chainId, '86400').toString(), // 24 hr
    targetName: hre.ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.0125').toString(), // 1.25%
    delayUntilDefault: bn('86400').toString(), // 24h
    revenueHiding: revenueHiding.toString(),
  })
  collateral = <ICollateral>await ethers.getContractAt('ICollateral', aUsdcCollateral)
  await (await collateral.refresh()).wait()
  expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

  assetCollDeployments.collateral.aUSDC = aUsdcCollateral
  assetCollDeployments.erc20s.aUSDC = ausdcStaticToken.address
  deployedCollateral.push(aUsdcCollateral.toString())

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

  /********  Deploy AToken Fiat Collateral - aUSDT  **************************/

  // Get AToken to retrieve name and symbol
  aToken = <ATokenMock>(
    await ethers.getContractAt('ATokenMock', networkConfig[chainId].tokens.aUSDT as string)
  )

  // Wrap in StaticAToken
  const ausdtStaticToken: StaticATokenLM = <StaticATokenLM>(
    await StaticATokenFactory.connect(burner).deploy(
      networkConfig[chainId].AAVE_LENDING_POOL as string,
      aToken.address,
      'Static ' + (await aToken.name()),
      's' + (await aToken.symbol())
    )
  )
  await ausdtStaticToken.deployed()

  console.log(
    `Deployed StaticAToken for aUSDT on ${hre.network.name} (${chainId}): ${ausdtStaticToken.address} `
  )

  const { collateral: aUsdtCollateral } = await hre.run('deploy-atoken-fiat-collateral', {
    priceTimeout: priceTimeout.toString(),
    priceFeed: networkConfig[chainId].chainlinkFeeds.USDT,
    oracleError: fp('0.0025').toString(), // 0.25%
    staticAToken: ausdtStaticToken.address,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: oracleTimeout(chainId, '86400').toString(), // 24 hr
    targetName: hre.ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.0125').toString(), // 1.25%
    delayUntilDefault: bn('86400').toString(), // 24h
    revenueHiding: revenueHiding.toString(),
  })
  collateral = <ICollateral>await ethers.getContractAt('ICollateral', aUsdtCollateral)
  await (await collateral.refresh()).wait()
  expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

  assetCollDeployments.collateral.aUSDT = aUsdtCollateral
  assetCollDeployments.erc20s.aUSDT = ausdtStaticToken.address
  deployedCollateral.push(aUsdtCollateral.toString())

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

  /********  Deploy AToken Fiat Collateral - aBUSD  **************************/

  // Get AToken to retrieve name and symbol
  aToken = <ATokenMock>(
    await ethers.getContractAt('ATokenMock', networkConfig[chainId].tokens.aBUSD as string)
  )

  const abusdStaticToken: StaticATokenLM = <StaticATokenLM>(
    await StaticATokenFactory.connect(burner).deploy(
      networkConfig[chainId].AAVE_LENDING_POOL as string,
      aToken.address,
      'Static ' + (await aToken.name()),
      's' + (await aToken.symbol())
    )
  )
  await abusdStaticToken.deployed()

  console.log(
    `Deployed StaticAToken for aBUSD on ${hre.network.name} (${chainId}): ${abusdStaticToken.address} `
  )

  const { collateral: aBusdCollateral } = await hre.run('deploy-atoken-fiat-collateral', {
    priceTimeout: priceTimeout.toString(),
    priceFeed: networkConfig[chainId].chainlinkFeeds.BUSD,
    oracleError: fp('0.005').toString(), // 0.5%
    staticAToken: abusdStaticToken.address,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: oracleTimeout(chainId, '86400').toString(), // 24 hr
    targetName: hre.ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.015').toString(), // 1.5%
    delayUntilDefault: bn('86400').toString(), // 24h
    revenueHiding: revenueHiding.toString(),
  })
  collateral = <ICollateral>await ethers.getContractAt('ICollateral', aBusdCollateral)
  await (await collateral.refresh()).wait()
  expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

  assetCollDeployments.collateral.aBUSD = aBusdCollateral
  assetCollDeployments.erc20s.aBUSD = abusdStaticToken.address
  deployedCollateral.push(aBusdCollateral.toString())

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

  /********  Deploy AToken Fiat Collateral - aUSDP  **************************/

  // Get AToken to retrieve name and symbol
  aToken = <ATokenMock>(
    await ethers.getContractAt('ATokenMock', networkConfig[chainId].tokens.aUSDP as string)
  )

  // Wrap in StaticAToken
  const ausdpStaticToken: StaticATokenLM = <StaticATokenLM>(
    await StaticATokenFactory.connect(burner).deploy(
      networkConfig[chainId].AAVE_LENDING_POOL as string,
      aToken.address,
      'Static ' + (await aToken.name()),
      's' + (await aToken.symbol())
    )
  )
  await ausdpStaticToken.deployed()

  console.log(
    `Deployed StaticAToken for aUSDP on ${hre.network.name} (${chainId}): ${ausdpStaticToken.address} `
  )

  const { collateral: aUsdpCollateral } = await hre.run('deploy-atoken-fiat-collateral', {
    priceTimeout: priceTimeout.toString(),
    priceFeed: networkConfig[chainId].chainlinkFeeds.USDP,
    oracleError: fp('0.01').toString(), // 1%
    staticAToken: ausdpStaticToken.address,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: oracleTimeout(chainId, '3600').toString(), // 1 hr
    targetName: hre.ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.02').toString(), // 2%
    delayUntilDefault: bn('86400').toString(), // 24h
    revenueHiding: revenueHiding.toString(),
  })
  collateral = <ICollateral>await ethers.getContractAt('ICollateral', aUsdpCollateral)
  await (await collateral.refresh()).wait()
  expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

  assetCollDeployments.collateral.aUSDP = aUsdpCollateral
  assetCollDeployments.erc20s.aUSDP = ausdpStaticToken.address
  deployedCollateral.push(aUsdpCollateral.toString())

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

  /********  Deploy CToken Fiat Collateral - cDAI  **************************/
  const CTokenFactory = await ethers.getContractFactory('CTokenWrapper')
  const cDai = await ethers.getContractAt('IERC20Metadata', networkConfig[chainId].tokens.cDAI!)

  const cDaiVault = await CTokenFactory.deploy(
    networkConfig[chainId].tokens.cDAI!,
    `${await cDai.name()} Vault`,
    `${await cDai.symbol()}-VAULT`,
    networkConfig[chainId].COMPTROLLER!
  )

  await cDaiVault.deployed()

  console.log(`Deployed Vault for cDAI on ${hre.network.name} (${chainId}): ${cDaiVault.address} `)

  const { collateral: cDaiCollateral } = await hre.run('deploy-ctoken-fiat-collateral', {
    priceTimeout: priceTimeout.toString(),
    priceFeed: networkConfig[chainId].chainlinkFeeds.DAI,
    oracleError: fp('0.0025').toString(), // 0.25%
    cToken: cDaiVault.address,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: oracleTimeout(chainId, '3600').toString(), // 1 hr
    targetName: hre.ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.0125').toString(), // 1.25%
    delayUntilDefault: bn('86400').toString(), // 24h
    revenueHiding: revenueHiding.toString(),
  })
  collateral = <ICollateral>await ethers.getContractAt('ICollateral', cDaiCollateral)
  await (await collateral.refresh()).wait()
  expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

  assetCollDeployments.collateral.cDAI = cDaiCollateral
  assetCollDeployments.erc20s.cDAI = cDaiVault.address
  deployedCollateral.push(cDaiCollateral.toString())

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

  /********  Deploy CToken Fiat Collateral - cUSDC  **************************/
  const cUsdc = await ethers.getContractAt('IERC20Metadata', networkConfig[chainId].tokens.cUSDC!)

  const cUsdcVault = await CTokenFactory.deploy(
    networkConfig[chainId].tokens.cUSDC!,
    `${await cUsdc.name()} Vault`,
    `${await cUsdc.symbol()}-VAULT`,
    networkConfig[chainId].COMPTROLLER!
  )

  await cUsdcVault.deployed()

  console.log(
    `Deployed Vault for cUSDC on ${hre.network.name} (${chainId}): ${cUsdcVault.address} `
  )

  const { collateral: cUsdcCollateral } = await hre.run('deploy-ctoken-fiat-collateral', {
    priceTimeout: priceTimeout.toString(),
    priceFeed: networkConfig[chainId].chainlinkFeeds.USDC,
    oracleError: fp('0.0025').toString(), // 0.25%
    cToken: cUsdcVault.address,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: oracleTimeout(chainId, '86400').toString(), // 24 hr
    targetName: hre.ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.0125').toString(), // 1.25%
    delayUntilDefault: bn('86400').toString(), // 24h
    revenueHiding: revenueHiding.toString(),
  })
  collateral = <ICollateral>await ethers.getContractAt('ICollateral', cUsdcCollateral)
  await (await collateral.refresh()).wait()
  expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

  assetCollDeployments.collateral.cUSDC = cUsdcCollateral
  assetCollDeployments.erc20s.cUSDC = cUsdcVault.address
  deployedCollateral.push(cUsdcCollateral.toString())

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

  /********  Deploy CToken Fiat Collateral - cUSDT  **************************/
  const cUsdt = await ethers.getContractAt('IERC20Metadata', networkConfig[chainId].tokens.cUSDT!)

  const cUsdtVault = await CTokenFactory.deploy(
    networkConfig[chainId].tokens.cUSDT!,
    `${await cUsdt.name()} Vault`,
    `${await cUsdt.symbol()}-VAULT`,
    networkConfig[chainId].COMPTROLLER!
  )

  await cUsdtVault.deployed()

  console.log(
    `Deployed Vault for cUSDT on ${hre.network.name} (${chainId}): ${cUsdtVault.address} `
  )

  const { collateral: cUsdtCollateral } = await hre.run('deploy-ctoken-fiat-collateral', {
    priceTimeout: priceTimeout.toString(),
    priceFeed: networkConfig[chainId].chainlinkFeeds.USDT,
    oracleError: fp('0.0025').toString(), // 0.25%
    cToken: cUsdtVault.address,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: oracleTimeout(chainId, '86400').toString(), // 24 hr
    targetName: hre.ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.0125').toString(), // 1.25%
    delayUntilDefault: bn('86400').toString(), // 24h
    revenueHiding: revenueHiding.toString(),
  })
  collateral = <ICollateral>await ethers.getContractAt('ICollateral', cUsdtCollateral)
  await (await collateral.refresh()).wait()
  expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

  assetCollDeployments.collateral.cUSDT = cUsdtCollateral
  assetCollDeployments.erc20s.cUSDT = cUsdtVault.address
  deployedCollateral.push(cUsdtCollateral.toString())

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

  /********  Deploy CToken Fiat Collateral - cUSDP  **************************/
  const cUsdp = await ethers.getContractAt('IERC20Metadata', networkConfig[chainId].tokens.cUSDP!)

  const cUsdpVault = await CTokenFactory.deploy(
    networkConfig[chainId].tokens.cUSDP!,
    `${await cUsdp.name()} Vault`,
    `${await cUsdp.symbol()}-VAULT`,
    networkConfig[chainId].COMPTROLLER!
  )

  await cUsdpVault.deployed()

  console.log(
    `Deployed Vault for cUSDP on ${hre.network.name} (${chainId}): ${cUsdpVault.address} `
  )

  const { collateral: cUsdpCollateral } = await hre.run('deploy-ctoken-fiat-collateral', {
    priceTimeout: priceTimeout.toString(),
    priceFeed: networkConfig[chainId].chainlinkFeeds.USDP,
    oracleError: fp('0.01').toString(), // 1%
    cToken: cUsdpVault.address,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: oracleTimeout(chainId, '3600').toString(), // 1 hr
    targetName: hre.ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.02').toString(), // 2%
    delayUntilDefault: bn('86400').toString(), // 24h
    revenueHiding: revenueHiding.toString(),
  })
  collateral = <ICollateral>await ethers.getContractAt('ICollateral', cUsdpCollateral)
  await (await collateral.refresh()).wait()
  expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

  assetCollDeployments.collateral.cUSDP = cUsdpCollateral
  assetCollDeployments.erc20s.cUSDP = cUsdpVault.address
  deployedCollateral.push(cUsdpCollateral.toString())

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

  /********  Deploy CToken Non-Fiat Collateral - cWBTC  **************************/
  const cWBTC = await ethers.getContractAt('IERC20Metadata', networkConfig[chainId].tokens.cWBTC!)

  const cWBTCVault = await CTokenFactory.deploy(
    networkConfig[chainId].tokens.cWBTC!,
    `${await cWBTC.name()} Vault`,
    `${await cWBTC.symbol()}-VAULT`,
    networkConfig[chainId].COMPTROLLER!
  )

  await cWBTCVault.deployed()

  console.log(
    `Deployed Vault for cWBTC on ${hre.network.name} (${chainId}): ${cWBTCVault.address} `
  )

  const wbtcOracleError = fp('0.02') // 2%
  const btcOracleError = fp('0.005') // 0.5%
  const combinedBTCWBTCError = combinedError(wbtcOracleError, btcOracleError)

  const { collateral: cWBTCCollateral } = await hre.run('deploy-ctoken-nonfiat-collateral', {
    priceTimeout: priceTimeout.toString(),
    referenceUnitFeed: networkConfig[chainId].chainlinkFeeds.WBTC,
    targetUnitFeed: networkConfig[chainId].chainlinkFeeds.BTC,
    combinedOracleError: combinedBTCWBTCError.toString(),
    cToken: cWBTCVault.address,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: oracleTimeout(chainId, '86400').toString(), // 24 hr
    targetUnitOracleTimeout: oracleTimeout(chainId, '3600').toString(), // 1 hr
    targetName: hre.ethers.utils.formatBytes32String('BTC'),
    defaultThreshold: fp('0.01').add(combinedBTCWBTCError).toString(), // ~3.5%
    delayUntilDefault: bn('86400').toString(), // 24h
    revenueHiding: revenueHiding.toString(),
  })
  collateral = <ICollateral>await ethers.getContractAt('ICollateral', cWBTCCollateral)
  await (await collateral.refresh()).wait()
  expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

  assetCollDeployments.collateral.cWBTC = cWBTCCollateral
  assetCollDeployments.erc20s.cWBTC = cWBTCVault.address
  deployedCollateral.push(cWBTCCollateral.toString())

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

  /********  Deploy CToken Self-Referential Collateral - cETH  **************************/
  const cETH = await ethers.getContractAt('IERC20Metadata', networkConfig[chainId].tokens.cETH!)

  const cETHVault = await CTokenFactory.deploy(
    networkConfig[chainId].tokens.cETH!,
    `${await cETH.name()} Vault`,
    `${await cETH.symbol()}-VAULT`,
    networkConfig[chainId].COMPTROLLER!
  )

  await cETHVault.deployed()

  console.log(`Deployed Vault for cETH on ${hre.network.name} (${chainId}): ${cETHVault.address} `)

  const { collateral: cETHCollateral } = await hre.run('deploy-ctoken-selfreferential-collateral', {
    priceTimeout: priceTimeout.toString(),
    priceFeed: networkConfig[chainId].chainlinkFeeds.ETH,
    oracleError: fp('0.005').toString(), // 0.5%
    cToken: cETHVault.address,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: oracleTimeout(chainId, '3600').toString(), // 1 hr
    targetName: hre.ethers.utils.formatBytes32String('ETH'),
    revenueHiding: revenueHiding.toString(),
    referenceERC20Decimals: '18',
  })
  collateral = <ICollateral>await ethers.getContractAt('ICollateral', cETHCollateral)
  await (await collateral.refresh()).wait()
  expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

  assetCollDeployments.collateral.cETH = cETHCollateral
  assetCollDeployments.erc20s.cETH = cETHVault.address
  deployedCollateral.push(cETHCollateral.toString())

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

  /********  Deploy Non-Fiat Collateral  - wBTC **************************/
  const { collateral: wBTCCollateral } = await hre.run('deploy-nonfiat-collateral', {
    priceTimeout: priceTimeout.toString(),
    referenceUnitFeed: networkConfig[chainId].chainlinkFeeds.WBTC,
    targetUnitFeed: networkConfig[chainId].chainlinkFeeds.BTC,
    combinedOracleError: combinedBTCWBTCError.toString(),
    tokenAddress: networkConfig[chainId].tokens.WBTC,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: oracleTimeout(chainId, '86400').toString(), // 24 hr
    targetUnitOracleTimeout: oracleTimeout(chainId, '3600').toString(), // 1 hr
    targetName: ethers.utils.formatBytes32String('BTC'),
    defaultThreshold: fp('0.01').add(combinedBTCWBTCError).toString(), // ~3.5%
    delayUntilDefault: bn('86400').toString(), // 24h
  })
  collateral = <ICollateral>await ethers.getContractAt('ICollateral', wBTCCollateral)
  await (await collateral.refresh()).wait()
  expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

  assetCollDeployments.collateral.WBTC = wBTCCollateral
  assetCollDeployments.erc20s.WBTC = networkConfig[chainId].tokens.WBTC
  deployedCollateral.push(wBTCCollateral.toString())

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

  /********  Deploy Self Referential Collateral - wETH  **************************/

  const { collateral: wETHCollateral } = await hre.run('deploy-selfreferential-collateral', {
    priceTimeout: priceTimeout.toString(),
    priceFeed: networkConfig[chainId].chainlinkFeeds.ETH,
    oracleError: fp('0.005').toString(), // 0.5%
    tokenAddress: networkConfig[chainId].tokens.WETH,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: oracleTimeout(chainId, '3600').toString(), // 1 hr
    targetName: hre.ethers.utils.formatBytes32String('ETH'),
  })
  collateral = <ICollateral>await ethers.getContractAt('ICollateral', wETHCollateral)
  await (await collateral.refresh()).wait()
  expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

  assetCollDeployments.collateral.WETH = wETHCollateral
  assetCollDeployments.erc20s.WETH = networkConfig[chainId].tokens.WETH
  deployedCollateral.push(wETHCollateral.toString())

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

  /********  Deploy EUR Fiat Collateral  - EURT **************************/
  const eurtError = fp('0.02') // 2%

  const { collateral: eurtCollateral } = await hre.run('deploy-eurfiat-collateral', {
    priceTimeout: priceTimeout.toString(),
    referenceUnitFeed: networkConfig[chainId].chainlinkFeeds.EURT,
    targetUnitFeed: networkConfig[chainId].chainlinkFeeds.EUR,
    oracleError: eurtError.toString(), // 2%
    tokenAddress: networkConfig[chainId].tokens.EURT,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: oracleTimeout(chainId, '86400').toString(), // 24 hr
    targetUnitOracleTimeout: oracleTimeout(chainId, '86400').toString(), // 24 hr
    targetName: ethers.utils.formatBytes32String('EUR'),
    defaultThreshold: fp('0.03').toString(), // 3%
    delayUntilDefault: bn('86400').toString(), // 24h
  })
  collateral = <ICollateral>await ethers.getContractAt('ICollateral', eurtCollateral)
  await (await collateral.refresh()).wait()
  expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

  assetCollDeployments.collateral.EURT = eurtCollateral
  assetCollDeployments.erc20s.EURT = networkConfig[chainId].tokens.EURT
  deployedCollateral.push(eurtCollateral.toString())

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

  console.log(`Deployed collateral to ${hre.network.name} (${chainId})
    New deployments: ${deployedCollateral}
    Deployment file: ${assetCollDeploymentFilename}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
