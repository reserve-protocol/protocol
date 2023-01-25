import fs from 'fs'
import hre, { ethers } from 'hardhat'
import { getChainId } from '../../../common/blockchain-utils'
import { networkConfig } from '../../../common/configuration'
import { bn, fp } from '../../../common/numbers'
import {
  getDeploymentFile,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
  getDeploymentFilename,
  fileExists,
} from '../common'
import { combinedError, priceTimeout, getOracleTimeout } from '../utils'
import { Asset, ATokenMock, StaticATokenLM } from '../../../typechain'

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
    oracleTimeout: getOracleTimeout(chainId).toString(),
    targetName: hre.ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.0125').toString(), // 1.25%
    delayUntilDefault: bn('86400').toString(), // 24h
  })
  await (<Asset>await ethers.getContractAt('Asset', daiCollateral)).refresh()

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

  assetCollDeployments.collateral.DAI = daiCollateral
  deployedCollateral.push(daiCollateral.toString())

  /********  Deploy Fiat Collateral - USDC  **************************/
  const { collateral: usdcCollateral } = await hre.run('deploy-fiat-collateral', {
    priceTimeout: priceTimeout.toString(),
    priceFeed: networkConfig[chainId].chainlinkFeeds.USDC,
    oracleError: fp('0.0025').toString(), // 0.25%
    tokenAddress: networkConfig[chainId].tokens.USDC,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: getOracleTimeout(chainId).toString(),
    targetName: hre.ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.0125').toString(), // 1.25%
    delayUntilDefault: bn('86400').toString(), // 24h
  })
  await (<Asset>await ethers.getContractAt('Asset', usdcCollateral)).refresh()

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

  assetCollDeployments.collateral.USDC = usdcCollateral
  deployedCollateral.push(usdcCollateral.toString())

  /********  Deploy Fiat Collateral - USDT  **************************/
  const { collateral: usdtCollateral } = await hre.run('deploy-fiat-collateral', {
    priceTimeout: priceTimeout.toString(),
    priceFeed: networkConfig[chainId].chainlinkFeeds.USDT,
    oracleError: fp('0.0025').toString(), // 0.25%
    tokenAddress: networkConfig[chainId].tokens.USDT,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: getOracleTimeout(chainId).toString(),
    targetName: hre.ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.0125').toString(), // 1.25%
    delayUntilDefault: bn('86400').toString(), // 24h
  })
  await (<Asset>await ethers.getContractAt('Asset', usdtCollateral)).refresh()

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

  assetCollDeployments.collateral.USDT = usdtCollateral
  deployedCollateral.push(usdtCollateral.toString())

  /********  Deploy Fiat Collateral - USDP  **************************/
  const { collateral: usdpCollateral } = await hre.run('deploy-fiat-collateral', {
    priceTimeout: priceTimeout.toString(),
    priceFeed: networkConfig[chainId].chainlinkFeeds.USDP,
    oracleError: fp('0.01').toString(), // 1%
    tokenAddress: networkConfig[chainId].tokens.USDP,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: getOracleTimeout(chainId).toString(),
    targetName: hre.ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.02').toString(), // 2%
    delayUntilDefault: bn('86400').toString(), // 24h
  })
  await (<Asset>await ethers.getContractAt('Asset', usdpCollateral)).refresh()

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

  assetCollDeployments.collateral.USDP = usdpCollateral
  deployedCollateral.push(usdpCollateral.toString())

  /********  Deploy Fiat Collateral - TUSD  **************************/
  const { collateral: tusdCollateral } = await hre.run('deploy-fiat-collateral', {
    priceTimeout: priceTimeout.toString(),
    priceFeed: networkConfig[chainId].chainlinkFeeds.TUSD,
    oracleError: fp('0.003').toString(), // 0.3%
    tokenAddress: networkConfig[chainId].tokens.TUSD,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: getOracleTimeout(chainId).toString(),
    targetName: hre.ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.013').toString(), // 1.3%
    delayUntilDefault: bn('86400').toString(), // 24h
  })
  await (<Asset>await ethers.getContractAt('Asset', tusdCollateral)).refresh()

  assetCollDeployments.collateral.TUSD = tusdCollateral
  deployedCollateral.push(tusdCollateral.toString())

  /********  Deploy Fiat Collateral - BUSD  **************************/
  const { collateral: busdCollateral } = await hre.run('deploy-fiat-collateral', {
    priceTimeout: priceTimeout.toString(),
    priceFeed: networkConfig[chainId].chainlinkFeeds.BUSD,
    oracleError: fp('0.005').toString(), // 0.5%
    tokenAddress: networkConfig[chainId].tokens.BUSD,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: getOracleTimeout(chainId).toString(),
    targetName: hre.ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.015').toString(), // 1.5%
    delayUntilDefault: bn('86400').toString(), // 24h
  })
  await (<Asset>await ethers.getContractAt('Asset', busdCollateral)).refresh()

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

  assetCollDeployments.collateral.BUSD = busdCollateral
  deployedCollateral.push(busdCollateral.toString())

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

  // Sleep 20s to allow sync
  await new Promise((r) => setTimeout(r, 20000))

  console.log(
    `Deployed StaticAToken for aDAI on ${hre.network.name} (${chainId}): ${adaiStaticToken.address} `
  )

  const { collateral: aDaiCollateral } = await hre.run('deploy-atoken-fiat-collateral', {
    priceTimeout: priceTimeout.toString(),
    priceFeed: networkConfig[chainId].chainlinkFeeds.DAI,
    oracleError: fp('0.0025').toString(), // 0.25%
    staticAToken: adaiStaticToken.address,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: getOracleTimeout(chainId).toString(),
    targetName: hre.ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.0125').toString(), // 1.25%
    delayUntilDefault: bn('86400').toString(), // 24h
  })
  await (<Asset>await ethers.getContractAt('Asset', aDaiCollateral)).refresh()

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

  assetCollDeployments.collateral.aDAI = aDaiCollateral
  deployedCollateral.push(aDaiCollateral.toString())

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

  // Sleep 20s to allow sync
  await new Promise((r) => setTimeout(r, 20000))

  console.log(
    `Deployed StaticAToken for aUSDC on ${hre.network.name} (${chainId}): ${ausdcStaticToken.address} `
  )

  const { collateral: aUsdcCollateral } = await hre.run('deploy-atoken-fiat-collateral', {
    priceTimeout: priceTimeout.toString(),
    priceFeed: networkConfig[chainId].chainlinkFeeds.USDC,
    oracleError: fp('0.0025').toString(), // 0.25%
    staticAToken: ausdcStaticToken.address,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: getOracleTimeout(chainId).toString(),
    targetName: hre.ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.0125').toString(), // 1.25%
    delayUntilDefault: bn('86400').toString(), // 24h
  })
  await (<Asset>await ethers.getContractAt('Asset', aUsdcCollateral)).refresh()

  assetCollDeployments.collateral.aUSDC = aUsdcCollateral
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

  // Sleep 20s to allow sync
  await new Promise((r) => setTimeout(r, 20000))

  console.log(
    `Deployed StaticAToken for aUSDT on ${hre.network.name} (${chainId}): ${ausdtStaticToken.address} `
  )

  const { collateral: aUsdtCollateral } = await hre.run('deploy-atoken-fiat-collateral', {
    priceTimeout: priceTimeout.toString(),
    priceFeed: networkConfig[chainId].chainlinkFeeds.USDT,
    oracleError: fp('0.0025').toString(), // 0.25%
    staticAToken: ausdtStaticToken.address,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: getOracleTimeout(chainId).toString(),
    targetName: hre.ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.0125').toString(), // 1.25%
    delayUntilDefault: bn('86400').toString(), // 24h
  })
  await (<Asset>await ethers.getContractAt('Asset', aUsdtCollateral)).refresh()

  assetCollDeployments.collateral.aUSDT = aUsdtCollateral
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

  // Sleep 20s to allow sync
  await new Promise((r) => setTimeout(r, 20000))

  console.log(
    `Deployed StaticAToken for aBUSD on ${hre.network.name} (${chainId}): ${abusdStaticToken.address} `
  )

  const { collateral: aBusdCollateral } = await hre.run('deploy-atoken-fiat-collateral', {
    priceTimeout: priceTimeout.toString(),
    priceFeed: networkConfig[chainId].chainlinkFeeds.BUSD,
    oracleError: fp('0.005').toString(), // 0.5%
    staticAToken: abusdStaticToken.address,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: getOracleTimeout(chainId).toString(),
    targetName: hre.ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.015').toString(), // 1.5%
    delayUntilDefault: bn('86400').toString(), // 24h
  })
  await (<Asset>await ethers.getContractAt('Asset', aBusdCollateral)).refresh()

  assetCollDeployments.collateral.aBUSD = aBusdCollateral
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

  // Sleep 20s to allow sync
  await new Promise((r) => setTimeout(r, 20000))

  console.log(
    `Deployed StaticAToken for aUSDP on ${hre.network.name} (${chainId}): ${ausdpStaticToken.address} `
  )

  const { collateral: aUsdpCollateral } = await hre.run('deploy-atoken-fiat-collateral', {
    priceTimeout: priceTimeout.toString(),
    priceFeed: networkConfig[chainId].chainlinkFeeds.USDP,
    oracleError: fp('0.01').toString(), // 1%
    staticAToken: ausdpStaticToken.address,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: getOracleTimeout(chainId).toString(),
    targetName: hre.ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.02').toString(), // 2%
    delayUntilDefault: bn('86400').toString(), // 24h
  })
  await (<Asset>await ethers.getContractAt('Asset', aUsdpCollateral)).refresh()

  assetCollDeployments.collateral.aUSDP = aUsdpCollateral
  deployedCollateral.push(aUsdpCollateral.toString())

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

  /********  Deploy CToken Fiat Collateral - cDAI  **************************/

  const { collateral: cDaiCollateral } = await hre.run('deploy-ctoken-fiat-collateral', {
    priceTimeout: priceTimeout.toString(),
    priceFeed: networkConfig[chainId].chainlinkFeeds.DAI,
    oracleError: fp('0.0025').toString(), // 0.25%
    cToken: networkConfig[chainId].tokens.cDAI,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: getOracleTimeout(chainId).toString(),
    targetName: hre.ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.0125').toString(), // 1.25%
    delayUntilDefault: bn('86400').toString(), // 24h
    comptroller: networkConfig[chainId].COMPTROLLER,
  })
  await (<Asset>await ethers.getContractAt('Asset', cDaiCollateral)).refresh()

  assetCollDeployments.collateral.cDAI = cDaiCollateral
  deployedCollateral.push(cDaiCollateral.toString())

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

  /********  Deploy CToken Fiat Collateral - cUSDC  **************************/

  const { collateral: cUsdcCollateral } = await hre.run('deploy-ctoken-fiat-collateral', {
    priceTimeout: priceTimeout.toString(),
    priceFeed: networkConfig[chainId].chainlinkFeeds.USDC,
    oracleError: fp('0.0025').toString(), // 0.25%
    cToken: networkConfig[chainId].tokens.cUSDC,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: getOracleTimeout(chainId).toString(),
    targetName: hre.ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.0125').toString(), // 1.25%
    delayUntilDefault: bn('86400').toString(), // 24h
    comptroller: networkConfig[chainId].COMPTROLLER,
  })
  await (<Asset>await ethers.getContractAt('Asset', cUsdcCollateral)).refresh()

  assetCollDeployments.collateral.cUSDC = cUsdcCollateral
  deployedCollateral.push(cUsdcCollateral.toString())

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

  /********  Deploy CToken Fiat Collateral - cUSDT  **************************/

  const { collateral: cUsdtCollateral } = await hre.run('deploy-ctoken-fiat-collateral', {
    priceTimeout: priceTimeout.toString(),
    priceFeed: networkConfig[chainId].chainlinkFeeds.USDT,
    oracleError: fp('0.0025').toString(), // 0.25%
    cToken: networkConfig[chainId].tokens.cUSDT,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: getOracleTimeout(chainId).toString(),
    targetName: hre.ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.0125').toString(), // 1.25%
    delayUntilDefault: bn('86400').toString(), // 24h
    comptroller: networkConfig[chainId].COMPTROLLER,
  })
  await (<Asset>await ethers.getContractAt('Asset', cUsdtCollateral)).refresh()

  assetCollDeployments.collateral.cUSDT = cUsdtCollateral
  deployedCollateral.push(cUsdtCollateral.toString())

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

  /********  Deploy CToken Fiat Collateral - cUSDP  **************************/

  const { collateral: cUsdpCollateral } = await hre.run('deploy-ctoken-fiat-collateral', {
    priceTimeout: priceTimeout.toString(),
    priceFeed: networkConfig[chainId].chainlinkFeeds.USDP,
    oracleError: fp('0.01').toString(), // 1%
    cToken: networkConfig[chainId].tokens.cUSDP,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: getOracleTimeout(chainId).toString(),
    targetName: hre.ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.02').toString(), // 2%
    delayUntilDefault: bn('86400').toString(), // 24h
    comptroller: networkConfig[chainId].COMPTROLLER,
  })
  await (<Asset>await ethers.getContractAt('Asset', cUsdpCollateral)).refresh()

  assetCollDeployments.collateral.cUSDP = cUsdpCollateral
  deployedCollateral.push(cUsdpCollateral.toString())

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

  /********  Deploy CToken Non-Fiat Collateral - cWBTC  **************************/

  const wbtcOracleError = fp('0.02') // 2%
  const btcOracleError = fp('0.005') // 0.5%
  const combinedBTCWBTCError = combinedError(wbtcOracleError, btcOracleError)

  const { collateral: cWBTCCollateral } = await hre.run('deploy-ctoken-nonfiat-collateral', {
    priceTimeout: priceTimeout.toString(),
    referenceUnitFeed: networkConfig[chainId].chainlinkFeeds.WBTC,
    targetUnitFeed: networkConfig[chainId].chainlinkFeeds.BTC,
    combinedOracleError: combinedBTCWBTCError.toString(),
    cToken: networkConfig[chainId].tokens.cWBTC,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: getOracleTimeout(chainId).toString(),
    targetName: hre.ethers.utils.formatBytes32String('BTC'),
    defaultThreshold: fp('0.01').add(combinedBTCWBTCError).toString(), // ~3.5%
    delayUntilDefault: bn('86400').toString(), // 24h
    comptroller: networkConfig[chainId].COMPTROLLER,
  })
  await (<Asset>await ethers.getContractAt('Asset', cWBTCCollateral)).refresh()

  assetCollDeployments.collateral.cWBTC = cWBTCCollateral
  deployedCollateral.push(cWBTCCollateral.toString())

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

  /********  Deploy CToken Self-Referential Collateral - cETH  **************************/

  const { collateral: cETHCollateral } = await hre.run('deploy-ctoken-selfreferential-collateral', {
    priceTimeout: priceTimeout.toString(),
    priceFeed: networkConfig[chainId].chainlinkFeeds.ETH,
    oracleError: fp('0.005').toString(), // 0.5%
    cToken: networkConfig[chainId].tokens.cETH,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: getOracleTimeout(chainId).toString(),
    targetName: hre.ethers.utils.formatBytes32String('ETH'),
    comptroller: networkConfig[chainId].COMPTROLLER,
    referenceERC20Decimals: '18',
  })
  await (<Asset>await ethers.getContractAt('Asset', cETHCollateral)).refresh()

  assetCollDeployments.collateral.cETH = cETHCollateral
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
    oracleTimeout: getOracleTimeout(chainId).toString(),
    targetName: ethers.utils.formatBytes32String('BTC'),
    defaultThreshold: fp('0.01').add(combinedBTCWBTCError).toString(), // ~3.5%
    delayUntilDefault: bn('86400').toString(), // 24h
  })
  await (<Asset>await ethers.getContractAt('Asset', wBTCCollateral)).refresh()

  assetCollDeployments.collateral.WBTC = wBTCCollateral
  deployedCollateral.push(wBTCCollateral.toString())

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

  /********  Deploy Self Referential Collateral - wETH  **************************/

  const { collateral: wETHCollateral } = await hre.run('deploy-selfreferential-collateral', {
    priceTimeout: priceTimeout.toString(),
    priceFeed: networkConfig[chainId].chainlinkFeeds.ETH,
    oracleError: fp('0.005').toString(), // 0.5%
    tokenAddress: networkConfig[chainId].tokens.WETH,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: getOracleTimeout(chainId).toString(),
    targetName: hre.ethers.utils.formatBytes32String('ETH'),
  })
  await (<Asset>await ethers.getContractAt('Asset', wETHCollateral)).refresh()

  assetCollDeployments.collateral.WETH = wETHCollateral
  deployedCollateral.push(wETHCollateral.toString())

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

  /********  Deploy EURO Fiat Collateral  - EURT **************************/
  const eurtError = fp('0.02') // 2%

  const { collateral: eurtCollateral } = await hre.run('deploy-eurfiat-collateral', {
    priceTimeout: priceTimeout.toString(),
    referenceUnitFeed: networkConfig[chainId].chainlinkFeeds.EURT,
    targetUnitFeed: networkConfig[chainId].chainlinkFeeds.EUR,
    oracleError: eurtError.toString(), // 2%
    tokenAddress: networkConfig[chainId].tokens.EURT,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: getOracleTimeout(chainId).toString(),
    targetName: ethers.utils.formatBytes32String('EURO'),
    defaultThreshold: fp('0.03').toString(), // 3%
    delayUntilDefault: bn('86400').toString(), // 24h
  })
  await (<Asset>await ethers.getContractAt('Asset', eurtCollateral)).refresh()

  assetCollDeployments.collateral.EURT = eurtCollateral
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
