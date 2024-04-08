import fs from 'fs'
import hre, { ethers } from 'hardhat'
import { expect } from 'chai'
import { getChainId } from '../../../common/blockchain-utils'
import { arbitrumL2Chains, baseL2Chains, networkConfig } from '../../../common/configuration'
import { bn, fp } from '../../../common/numbers'
import { CollateralStatus } from '../../../common/constants'
import {
  getDeploymentFile,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
  getDeploymentFilename,
  fileExists,
} from '../common'
import {
  combinedError,
  getDaiOracleError,
  getDaiOracleTimeout,
  getUsdcOracleError,
  getUsdtOracleError,
  priceTimeout,
  revenueHiding,
} from '../utils'
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

  let collateral: ICollateral

  /********  Deploy Fiat Collateral - DAI  **************************/
  const daiOracleTimeout = getDaiOracleTimeout(hre.network.name)
  const daiOracleError = getDaiOracleError(hre.network.name)

  if (networkConfig[chainId].tokens.DAI && networkConfig[chainId].chainlinkFeeds.DAI) {
    const { collateral: daiCollateral } = await hre.run('deploy-fiat-collateral', {
      priceTimeout: priceTimeout.toString(),
      priceFeed: networkConfig[chainId].chainlinkFeeds.DAI,
      oracleError: daiOracleError.toString(),
      tokenAddress: networkConfig[chainId].tokens.DAI,
      maxTradeVolume: fp('1e6').toString(), // $1m,
      oracleTimeout: daiOracleTimeout,
      targetName: hre.ethers.utils.formatBytes32String('USD'),
      defaultThreshold: fp('0.01').add(daiOracleError).toString(),
      delayUntilDefault: bn('86400').toString(), // 24h
    })
    collateral = <ICollateral>await ethers.getContractAt('ICollateral', daiCollateral)
    await (await collateral.refresh()).wait()
    expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

    assetCollDeployments.collateral.DAI = daiCollateral
    assetCollDeployments.erc20s.DAI = networkConfig[chainId].tokens.DAI
    deployedCollateral.push(daiCollateral.toString())

    fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))
  }

  const usdcOracleTimeout = '86400'
  const usdcOracleError = getUsdcOracleError(hre.network.name)

  /********  Deploy Fiat Collateral - USDC  **************************/
  if (networkConfig[chainId].tokens.USDC && networkConfig[chainId].chainlinkFeeds.USDC) {
    const { collateral: usdcCollateral } = await hre.run('deploy-fiat-collateral', {
      priceTimeout: priceTimeout.toString(),
      priceFeed: networkConfig[chainId].chainlinkFeeds.USDC,
      oracleError: usdcOracleError.toString(),
      tokenAddress: networkConfig[chainId].tokens.USDC,
      maxTradeVolume: fp('1e6').toString(), // $1m,
      oracleTimeout: usdcOracleTimeout, // 24 hr
      targetName: hre.ethers.utils.formatBytes32String('USD'),
      defaultThreshold: fp('0.01').add(usdcOracleError).toString(),
      delayUntilDefault: bn('86400').toString(), // 24h
    })
    collateral = <ICollateral>await ethers.getContractAt('ICollateral', usdcCollateral)
    await (await collateral.refresh()).wait()
    expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

    assetCollDeployments.collateral.USDC = usdcCollateral
    assetCollDeployments.erc20s.USDC = networkConfig[chainId].tokens.USDC
    deployedCollateral.push(usdcCollateral.toString())

    fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))
  }

  /********  Deploy Fiat Collateral - USDT  **************************/
  const usdtOracleTimeout = '86400' // 24 hr
  const usdtOracleError = getUsdtOracleError(hre.network.name)

  if (networkConfig[chainId].tokens.USDT && networkConfig[chainId].chainlinkFeeds.USDT) {
    const { collateral: usdtCollateral } = await hre.run('deploy-fiat-collateral', {
      priceTimeout: priceTimeout.toString(),
      priceFeed: networkConfig[chainId].chainlinkFeeds.USDT,
      oracleError: usdtOracleError.toString(),
      tokenAddress: networkConfig[chainId].tokens.USDT,
      maxTradeVolume: fp('1e6').toString(), // $1m,
      oracleTimeout: usdtOracleTimeout, // 24 hr
      targetName: hre.ethers.utils.formatBytes32String('USD'),
      defaultThreshold: fp('0.01').add(usdtOracleError).toString(),
      delayUntilDefault: bn('86400').toString(), // 24h
    })
    collateral = <ICollateral>await ethers.getContractAt('ICollateral', usdtCollateral)
    await (await collateral.refresh()).wait()
    expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

    assetCollDeployments.collateral.USDT = usdtCollateral
    assetCollDeployments.erc20s.USDT = networkConfig[chainId].tokens.USDT
    deployedCollateral.push(usdtCollateral.toString())

    fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))
  }

  /********  Deploy Fiat Collateral - USDP  **************************/

  if (networkConfig[chainId].tokens.USDP && networkConfig[chainId].chainlinkFeeds.USDP) {
    const { collateral: usdpCollateral } = await hre.run('deploy-fiat-collateral', {
      priceTimeout: priceTimeout.toString(),
      priceFeed: networkConfig[chainId].chainlinkFeeds.USDP,
      oracleError: fp('0.01').toString(), // 1%
      tokenAddress: networkConfig[chainId].tokens.USDP,
      maxTradeVolume: fp('1e6').toString(), // $1m,
      oracleTimeout: '3600', // 1 hr
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
  }

  /********  Deploy Fiat Collateral - BUSD  **************************/
  if (networkConfig[chainId].tokens.BUSD && networkConfig[chainId].chainlinkFeeds.BUSD) {
    const { collateral: busdCollateral } = await hre.run('deploy-fiat-collateral', {
      priceTimeout: priceTimeout.toString(),
      priceFeed: networkConfig[chainId].chainlinkFeeds.BUSD,
      oracleError: fp('0.005').toString(), // 0.5%
      tokenAddress: networkConfig[chainId].tokens.BUSD,
      maxTradeVolume: fp('1e6').toString(), // $1m,
      oracleTimeout: '86400', // 24 hr
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
  }

  /********  Base L2 - Deploy Fiat Collateral - USDbC  **************************/
  if (networkConfig[chainId].tokens.USDbC && networkConfig[chainId].chainlinkFeeds.USDC) {
    const { collateral: usdcCollateral } = await hre.run('deploy-fiat-collateral', {
      priceTimeout: priceTimeout.toString(),
      priceFeed: networkConfig[chainId].chainlinkFeeds.USDC,
      oracleError: usdcOracleError.toString(),
      tokenAddress: networkConfig[chainId].tokens.USDbC,
      maxTradeVolume: fp('1e6').toString(), // $1m,
      oracleTimeout: usdcOracleTimeout, // 24 hr
      targetName: hre.ethers.utils.formatBytes32String('USD'),
      defaultThreshold: fp('0.01').add(usdcOracleError).toString(), // 1.3%
      delayUntilDefault: bn('86400').toString(), // 24h
    })
    collateral = <ICollateral>await ethers.getContractAt('ICollateral', usdcCollateral)
    await (await collateral.refresh()).wait()
    expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

    assetCollDeployments.collateral.USDbC = usdcCollateral
    assetCollDeployments.erc20s.USDbC = networkConfig[chainId].tokens.USDbC
    deployedCollateral.push(usdcCollateral.toString())

    fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))
  }

  /*** AAVE V2 not available in Base or Arbitrum L2s */
  if (!baseL2Chains.includes(hre.network.name) && !arbitrumL2Chains.includes(hre.network.name)) {
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
      oracleTimeout: '3600', // 1 hr
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
      oracleTimeout: '86400', // 24 hr
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
      oracleTimeout: '86400', // 24 hr
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
      oracleTimeout: '86400', // 24 hr
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
      oracleTimeout: '3600', // 1 hr
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
  }

  const wbtcOracleError = fp('0.02') // 2%
  const btcOracleError = fp('0.005') // 0.5%
  const combinedBTCWBTCError = combinedError(wbtcOracleError, btcOracleError)

  /*** Compound V2 not available in Base or Arbitrum L2s */
  if (!baseL2Chains.includes(hre.network.name) && !arbitrumL2Chains.includes(hre.network.name)) {
    /********  Deploy CToken Fiat Collateral - cDAI  **************************/
    const { collateral: cDaiCollateral } = await hre.run('deploy-ctoken-fiat-collateral', {
      priceTimeout: priceTimeout.toString(),
      priceFeed: networkConfig[chainId].chainlinkFeeds.DAI,
      oracleError: fp('0.0025').toString(), // 0.25%
      cToken: networkConfig[chainId].tokens.cDAI,
      maxTradeVolume: fp('1e6').toString(), // $1m,
      oracleTimeout: '3600', // 1 hr
      targetName: hre.ethers.utils.formatBytes32String('USD'),
      defaultThreshold: fp('0.0125').toString(), // 1.25%
      delayUntilDefault: bn('86400').toString(), // 24h
      revenueHiding: revenueHiding.toString(),
    })
    collateral = <ICollateral>await ethers.getContractAt('ICollateral', cDaiCollateral)
    await (await collateral.refresh()).wait()
    expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

    assetCollDeployments.collateral.cDAI = cDaiCollateral
    assetCollDeployments.erc20s.cDAI = networkConfig[chainId].tokens.cDAI
    deployedCollateral.push(cDaiCollateral.toString())

    fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

    /********  Deploy CToken Fiat Collateral - cUSDC  **************************/
    const { collateral: cUsdcCollateral } = await hre.run('deploy-ctoken-fiat-collateral', {
      priceTimeout: priceTimeout.toString(),
      priceFeed: networkConfig[chainId].chainlinkFeeds.USDC,
      oracleError: fp('0.0025').toString(), // 0.25%
      cToken: networkConfig[chainId].tokens.cUSDC,
      maxTradeVolume: fp('1e6').toString(), // $1m,
      oracleTimeout: '86400', // 24 hr
      targetName: hre.ethers.utils.formatBytes32String('USD'),
      defaultThreshold: fp('0.0125').toString(), // 1.25%
      delayUntilDefault: bn('86400').toString(), // 24h
      revenueHiding: revenueHiding.toString(),
    })
    collateral = <ICollateral>await ethers.getContractAt('ICollateral', cUsdcCollateral)
    await (await collateral.refresh()).wait()
    expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

    assetCollDeployments.collateral.cUSDC = cUsdcCollateral
    assetCollDeployments.erc20s.cUSDC = networkConfig[chainId].tokens.cUSDC
    deployedCollateral.push(cUsdcCollateral.toString())

    fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

    /********  Deploy CToken Fiat Collateral - cUSDT  **************************/
    const { collateral: cUsdtCollateral } = await hre.run('deploy-ctoken-fiat-collateral', {
      priceTimeout: priceTimeout.toString(),
      priceFeed: networkConfig[chainId].chainlinkFeeds.USDT,
      oracleError: fp('0.0025').toString(), // 0.25%
      cToken: networkConfig[chainId].tokens.cUSDT,
      maxTradeVolume: fp('1e6').toString(), // $1m,
      oracleTimeout: '86400', // 24 hr
      targetName: hre.ethers.utils.formatBytes32String('USD'),
      defaultThreshold: fp('0.0125').toString(), // 1.25%
      delayUntilDefault: bn('86400').toString(), // 24h
      revenueHiding: revenueHiding.toString(),
    })
    collateral = <ICollateral>await ethers.getContractAt('ICollateral', cUsdtCollateral)
    await (await collateral.refresh()).wait()
    expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

    assetCollDeployments.collateral.cUSDT = cUsdtCollateral
    assetCollDeployments.erc20s.cUSDT = networkConfig[chainId].tokens.cUSDT
    deployedCollateral.push(cUsdtCollateral.toString())

    fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

    /********  Deploy CToken Fiat Collateral - cUSDP  **************************/
    const { collateral: cUsdpCollateral } = await hre.run('deploy-ctoken-fiat-collateral', {
      priceTimeout: priceTimeout.toString(),
      priceFeed: networkConfig[chainId].chainlinkFeeds.USDP,
      oracleError: fp('0.01').toString(), // 1%
      cToken: networkConfig[chainId].tokens.cUSDP,
      maxTradeVolume: fp('1e6').toString(), // $1m,
      oracleTimeout: '3600', // 1 hr
      targetName: hre.ethers.utils.formatBytes32String('USD'),
      defaultThreshold: fp('0.02').toString(), // 2%
      delayUntilDefault: bn('86400').toString(), // 24h
      revenueHiding: revenueHiding.toString(),
    })
    collateral = <ICollateral>await ethers.getContractAt('ICollateral', cUsdpCollateral)
    await (await collateral.refresh()).wait()
    expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

    assetCollDeployments.collateral.cUSDP = cUsdpCollateral
    assetCollDeployments.erc20s.cUSDP = networkConfig[chainId].tokens.cUSDP
    deployedCollateral.push(cUsdpCollateral.toString())

    fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

    /********  Deploy CToken Non-Fiat Collateral - cWBTC  **************************/
    const { collateral: cWBTCCollateral } = await hre.run('deploy-ctoken-nonfiat-collateral', {
      priceTimeout: priceTimeout.toString(),
      referenceUnitFeed: networkConfig[chainId].chainlinkFeeds.WBTC,
      targetUnitFeed: networkConfig[chainId].chainlinkFeeds.BTC,
      combinedOracleError: combinedBTCWBTCError.toString(),
      cToken: networkConfig[chainId].tokens.cWBTC,
      maxTradeVolume: fp('1e6').toString(), // $1m,
      oracleTimeout: '86400', // 24 hr
      targetUnitOracleTimeout: '3600', // 1 hr
      targetName: hre.ethers.utils.formatBytes32String('BTC'),
      defaultThreshold: fp('0.01').add(combinedBTCWBTCError).toString(), // ~3.5%
      delayUntilDefault: bn('86400').toString(), // 24h
      revenueHiding: revenueHiding.toString(),
    })
    collateral = <ICollateral>await ethers.getContractAt('ICollateral', cWBTCCollateral)
    await (await collateral.refresh()).wait()
    expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

    assetCollDeployments.collateral.cWBTC = cWBTCCollateral
    assetCollDeployments.erc20s.cWBTC = networkConfig[chainId].tokens.cWBTC
    deployedCollateral.push(cWBTCCollateral.toString())

    fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

    /********  Deploy CToken Self-Referential Collateral - cETH  **************************/
    const { collateral: cETHCollateral } = await hre.run(
      'deploy-ctoken-selfreferential-collateral',
      {
        priceTimeout: priceTimeout.toString(),
        priceFeed: networkConfig[chainId].chainlinkFeeds.ETH,
        oracleError: fp('0.005').toString(), // 0.5%
        cToken: networkConfig[chainId].tokens.cETH,
        maxTradeVolume: fp('1e6').toString(), // $1m,
        oracleTimeout: '3600', // 1 hr
        targetName: hre.ethers.utils.formatBytes32String('ETH'),
        revenueHiding: revenueHiding.toString(),
        referenceERC20Decimals: '18',
      }
    )
    collateral = <ICollateral>await ethers.getContractAt('ICollateral', cETHCollateral)
    await (await collateral.refresh()).wait()
    expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

    assetCollDeployments.collateral.cETH = cETHCollateral
    assetCollDeployments.erc20s.cETH = networkConfig[chainId].tokens.cETH
    deployedCollateral.push(cETHCollateral.toString())

    fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))
  }

  /********  Deploy Non-Fiat Collateral  - wBTC **************************/
  if (
    networkConfig[chainId].tokens.WBTC &&
    networkConfig[chainId].chainlinkFeeds.BTC &&
    networkConfig[chainId].chainlinkFeeds.WBTC
  ) {
    const { collateral: wBTCCollateral } = await hre.run('deploy-nonfiat-collateral', {
      priceTimeout: priceTimeout.toString(),
      referenceUnitFeed: networkConfig[chainId].chainlinkFeeds.WBTC,
      targetUnitFeed: networkConfig[chainId].chainlinkFeeds.BTC,
      combinedOracleError: combinedBTCWBTCError.toString(),
      tokenAddress: networkConfig[chainId].tokens.WBTC,
      maxTradeVolume: fp('1e6').toString(), // $1m,
      oracleTimeout: '86400', // 24 hr
      targetUnitOracleTimeout: '3600', // 1 hr
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
  }
  /********  Deploy Self Referential Collateral - wETH  **************************/

  if (networkConfig[chainId].tokens.WETH && networkConfig[chainId].chainlinkFeeds.ETH) {
    const ethOracleTimeout = baseL2Chains.includes(hre.network.name) ? '1200' : '3600' // 20 min (Base) or 1 hr
    const ethOracleError = baseL2Chains.includes(hre.network.name) ? fp('0.0015') : fp('0.005') // 0.15% (Base) or 0.5%

    const { collateral: wETHCollateral } = await hre.run('deploy-selfreferential-collateral', {
      priceTimeout: priceTimeout.toString(),
      priceFeed: networkConfig[chainId].chainlinkFeeds.ETH,
      oracleError: ethOracleError.toString(),
      tokenAddress: networkConfig[chainId].tokens.WETH,
      maxTradeVolume: fp('1e6').toString(), // $1m,
      oracleTimeout: ethOracleTimeout,
      targetName: hre.ethers.utils.formatBytes32String('ETH'),
    })
    collateral = <ICollateral>await ethers.getContractAt('ICollateral', wETHCollateral)
    await (await collateral.refresh()).wait()
    expect(await collateral.status()).to.equal(CollateralStatus.SOUND)

    assetCollDeployments.collateral.WETH = wETHCollateral
    assetCollDeployments.erc20s.WETH = networkConfig[chainId].tokens.WETH
    deployedCollateral.push(wETHCollateral.toString())

    fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))
  }

  console.log(`Deployed collateral to ${hre.network.name} (${chainId})
    New deployments: ${deployedCollateral}
    Deployment file: ${assetCollDeploymentFilename}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
