import fs from 'fs'
import hre, { ethers } from 'hardhat'
import { expect } from 'chai'
import { getChainId } from '../../../common/blockchain-utils'
import { baseL2Chains, networkConfig } from '../../../common/configuration'
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

  let collateral: ICollateral

  /********  Deploy Fiat Collateral - DAI  **************************/

  const daiOracleTimeout = baseL2Chains.includes(hre.network.name) ? 86400 : 3600 // 24 hr (Base) or 1 hour
  const daiOracleError = baseL2Chains.includes(hre.network.name) ? fp('0.003') : fp('0.0025') // 0.3% (Base) or 0.25%

  if (networkConfig[chainId].tokens.DAI && networkConfig[chainId].chainlinkFeeds.DAI) {
    const { collateral: daiCollateral } = await hre.run('deploy-fiat-collateral', {
      priceTimeout: priceTimeout.toString(),
      priceFeed: networkConfig[chainId].chainlinkFeeds.DAI,
      oracleError: daiOracleError.toString(),
      tokenAddress: networkConfig[chainId].tokens.DAI,
      maxTradeVolume: fp('1e6').toString(), // $1m,
      oracleTimeout: oracleTimeout(chainId, daiOracleTimeout).toString(),
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

  const usdcOracleTimeout = 86400 // 24 hr
  const usdcOracleError = baseL2Chains.includes(hre.network.name) ? fp('0.003') : fp('0.0025') // 0.3% (Base) or 0.25%

  /********  Deploy Fiat Collateral - USDC  **************************/
  if (networkConfig[chainId].tokens.USDC && networkConfig[chainId].chainlinkFeeds.USDC) {
    const { collateral: usdcCollateral } = await hre.run('deploy-fiat-collateral', {
      priceTimeout: priceTimeout.toString(),
      priceFeed: networkConfig[chainId].chainlinkFeeds.USDC,
      oracleError: usdcOracleError.toString(),
      tokenAddress: networkConfig[chainId].tokens.USDC,
      maxTradeVolume: fp('1e6').toString(), // $1m,
      oracleTimeout: oracleTimeout(chainId, usdcOracleTimeout).toString(), // 24 hr
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
  const usdtOracleTimeout = 86400 // 24 hr
  const usdtOracleError = baseL2Chains.includes(hre.network.name) ? fp('0.003') : fp('0.0025') // 0.3% (Base) or 0.25%

  if (networkConfig[chainId].tokens.USDT && networkConfig[chainId].chainlinkFeeds.USDT) {
    const { collateral: usdtCollateral } = await hre.run('deploy-fiat-collateral', {
      priceTimeout: priceTimeout.toString(),
      priceFeed: networkConfig[chainId].chainlinkFeeds.USDT,
      oracleError: usdtOracleError.toString(),
      tokenAddress: networkConfig[chainId].tokens.USDT,
      maxTradeVolume: fp('1e6').toString(), // $1m,
      oracleTimeout: oracleTimeout(chainId, usdtOracleTimeout).toString(), // 24 hr
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
  }

  /********  Deploy Fiat Collateral - TUSD  **************************/
  if (networkConfig[chainId].tokens.TUSD && networkConfig[chainId].chainlinkFeeds.TUSD) {
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
  }
  /********  Deploy Fiat Collateral - BUSD  **************************/
  if (networkConfig[chainId].tokens.BUSD && networkConfig[chainId].chainlinkFeeds.BUSD) {
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
  }

  /********  Base L2 - Deploy Fiat Collateral - USDbC  **************************/
  if (networkConfig[chainId].tokens.USDbC && networkConfig[chainId].chainlinkFeeds.USDC) {
    const { collateral: usdcCollateral } = await hre.run('deploy-fiat-collateral', {
      priceTimeout: priceTimeout.toString(),
      priceFeed: networkConfig[chainId].chainlinkFeeds.USDC,
      oracleError: usdcOracleError.toString(),
      tokenAddress: networkConfig[chainId].tokens.USDbC,
      maxTradeVolume: fp('1e6').toString(), // $1m,
      oracleTimeout: oracleTimeout(chainId, usdcOracleTimeout).toString(), // 24 hr
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

  /*** AAVE V2 not available in Base L2s */
  if (!baseL2Chains.includes(hre.network.name)) {
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
  }

  const wbtcOracleError = fp('0.02') // 2%
  const btcOracleError = fp('0.005') // 0.5%
  const combinedBTCWBTCError = combinedError(wbtcOracleError, btcOracleError)

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
  }
  /********  Deploy Self Referential Collateral - wETH  **************************/

  if (networkConfig[chainId].tokens.WETH && networkConfig[chainId].chainlinkFeeds.ETH) {
    const ethOracleTimeout = baseL2Chains.includes(hre.network.name) ? 1200 : 3600 // 20 min (Base) or 1 hr
    const ethOracleError = baseL2Chains.includes(hre.network.name) ? fp('0.0015') : fp('0.005') // 0.15% (Base) or 0.5%

    const { collateral: wETHCollateral } = await hre.run('deploy-selfreferential-collateral', {
      priceTimeout: priceTimeout.toString(),
      priceFeed: networkConfig[chainId].chainlinkFeeds.ETH,
      oracleError: ethOracleError.toString(),
      tokenAddress: networkConfig[chainId].tokens.WETH,
      maxTradeVolume: fp('1e6').toString(), // $1m,
      oracleTimeout: oracleTimeout(chainId, ethOracleTimeout).toString(),
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

  /********  Deploy EUR Fiat Collateral  - EURT **************************/
  const eurtError = fp('0.02') // 2%

  if (
    networkConfig[chainId].tokens.EURT &&
    networkConfig[chainId].chainlinkFeeds.EUR &&
    networkConfig[chainId].chainlinkFeeds.EURT
  ) {
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
  }

  console.log(`Deployed collateral to ${hre.network.name} (${chainId})
    New deployments: ${deployedCollateral}
    Deployment file: ${assetCollDeploymentFilename}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
