import fs from 'fs'
import hre, { ethers } from 'hardhat'
import { getChainId } from '../../../common/blockchain-utils'
import { networkConfig } from '../../../common/configuration'
import { ZERO_ADDRESS } from '../../../common/constants'
import { bn, fp } from '../../../common/numbers'
import {
  getDeploymentFile,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
  getDeploymentFilename,
  IDeployments,
  fileExists,
} from '../common'
import { getCurrentPrice, getOracleTimeout } from '../utils'
import { ATokenMock, StaticATokenLM } from '../../../typechain'

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
  const phase1Deployment = <IDeployments>getDeploymentFile(phase1File)

  // Check previous step completed
  const assetCollDeploymentFilename = getAssetCollDeploymentFilename(chainId)
  const assetCollDeployments = <IAssetCollDeployments>getDeploymentFile(assetCollDeploymentFilename)

  // Get Oracle Lib address if previously deployed (can override with arbitrary address)
  const deployedCollateral: string[] = []

  /********  Deploy Fiat Collateral - DAI  **************************/
  const { collateral: daiCollateral } = await hre.run('deploy-fiat-collateral', {
    fallbackPrice: (await getCurrentPrice(networkConfig[chainId].chainlinkFeeds.DAI)).toString(),
    priceFeed: networkConfig[chainId].chainlinkFeeds.DAI,
    tokenAddress: networkConfig[chainId].tokens.DAI,
    rewardToken: ZERO_ADDRESS,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: getOracleTimeout(chainId).toString(),
    targetName: hre.ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.05').toString(), // 5%
    delayUntilDefault: bn('86400').toString(), // 24h
    oracleLib: phase1Deployment.oracleLib,
  })

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

  assetCollDeployments.collateral.DAI = daiCollateral
  deployedCollateral.push(daiCollateral.toString())

  /********  Deploy Fiat Collateral - USDC  **************************/
  const { collateral: usdcCollateral } = await hre.run('deploy-fiat-collateral', {
    fallbackPrice: (await getCurrentPrice(networkConfig[chainId].chainlinkFeeds.USDC)).toString(),
    priceFeed: networkConfig[chainId].chainlinkFeeds.USDC,
    tokenAddress: networkConfig[chainId].tokens.USDC,
    rewardToken: ZERO_ADDRESS,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: getOracleTimeout(chainId).toString(),
    targetName: hre.ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.05').toString(), // 5%
    delayUntilDefault: bn('86400').toString(), // 24h
    oracleLib: phase1Deployment.oracleLib,
  })

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

  assetCollDeployments.collateral.USDC = usdcCollateral
  deployedCollateral.push(usdcCollateral.toString())

  /********  Deploy Fiat Collateral - USDT  **************************/
  const { collateral: usdtCollateral } = await hre.run('deploy-fiat-collateral', {
    fallbackPrice: (await getCurrentPrice(networkConfig[chainId].chainlinkFeeds.USDT)).toString(),
    priceFeed: networkConfig[chainId].chainlinkFeeds.USDT,
    tokenAddress: networkConfig[chainId].tokens.USDT,
    rewardToken: ZERO_ADDRESS,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: getOracleTimeout(chainId).toString(),
    targetName: hre.ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.05').toString(), // 5%
    delayUntilDefault: bn('86400').toString(), // 24h
    oracleLib: phase1Deployment.oracleLib,
  })

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

  assetCollDeployments.collateral.USDT = usdtCollateral
  deployedCollateral.push(usdtCollateral.toString())

  /********  Deploy Fiat Collateral - USDP  **************************/
  const { collateral: usdpCollateral } = await hre.run('deploy-fiat-collateral', {
    fallbackPrice: (await getCurrentPrice(networkConfig[chainId].chainlinkFeeds.USDP)).toString(),
    priceFeed: networkConfig[chainId].chainlinkFeeds.USDP,
    tokenAddress: networkConfig[chainId].tokens.USDP,
    rewardToken: ZERO_ADDRESS,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: getOracleTimeout(chainId).toString(),
    targetName: hre.ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.05').toString(), // 5%
    delayUntilDefault: bn('86400').toString(), // 24h
    oracleLib: phase1Deployment.oracleLib,
  })

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

  assetCollDeployments.collateral.USDP = usdpCollateral
  deployedCollateral.push(usdpCollateral.toString())

  /********  Deploy Fiat Collateral - TUSD  **************************/
  const { collateral: tusdCollateral } = await hre.run('deploy-fiat-collateral', {
    fallbackPrice: (await getCurrentPrice(networkConfig[chainId].chainlinkFeeds.TUSD)).toString(),
    priceFeed: networkConfig[chainId].chainlinkFeeds.TUSD,
    tokenAddress: networkConfig[chainId].tokens.TUSD,
    rewardToken: ZERO_ADDRESS,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: getOracleTimeout(chainId).toString(),
    targetName: hre.ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.05').toString(), // 5%
    delayUntilDefault: bn('86400').toString(), // 24h
    oracleLib: phase1Deployment.oracleLib,
  })

  assetCollDeployments.collateral.TUSD = tusdCollateral
  deployedCollateral.push(tusdCollateral.toString())

  /********  Deploy Fiat Collateral - BUSD  **************************/
  const { collateral: busdCollateral } = await hre.run('deploy-fiat-collateral', {
    fallbackPrice: (await getCurrentPrice(networkConfig[chainId].chainlinkFeeds.BUSD)).toString(),
    priceFeed: networkConfig[chainId].chainlinkFeeds.BUSD,
    tokenAddress: networkConfig[chainId].tokens.BUSD,
    rewardToken: ZERO_ADDRESS,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: getOracleTimeout(chainId).toString(),
    targetName: hre.ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.05').toString(), // 5%
    delayUntilDefault: bn('86400').toString(), // 24h
    oracleLib: phase1Deployment.oracleLib,
  })

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
      'stat' + (await aToken.symbol())
    )
  )
  await adaiStaticToken.deployed()

  // Sleep 20s to allow sync
  await new Promise((r) => setTimeout(r, 20000))

  console.log(
    `Deployed StaticAToken for aDAI on ${hre.network.name} (${chainId}): ${adaiStaticToken.address} `
  )

  const { collateral: aDaiCollateral } = await hre.run('deploy-atoken-fiat-collateral', {
    fallbackPrice: (await getCurrentPrice(networkConfig[chainId].chainlinkFeeds.DAI)).toString(),
    priceFeed: networkConfig[chainId].chainlinkFeeds.DAI,
    staticAToken: adaiStaticToken.address,
    rewardToken: networkConfig[chainId].tokens.stkAAVE,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: getOracleTimeout(chainId).toString(),
    targetName: hre.ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.05').toString(), // 5%
    delayUntilDefault: bn('86400').toString(), // 24h
    oracleLib: phase1Deployment.oracleLib,
  })

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
      'stat' + (await aToken.symbol())
    )
  )
  await ausdcStaticToken.deployed()

  // Sleep 20s to allow sync
  await new Promise((r) => setTimeout(r, 20000))

  console.log(
    `Deployed StaticAToken for aUSDC on ${hre.network.name} (${chainId}): ${ausdcStaticToken.address} `
  )

  const { collateral: aUsdcCollateral } = await hre.run('deploy-atoken-fiat-collateral', {
    fallbackPrice: (await getCurrentPrice(networkConfig[chainId].chainlinkFeeds.USDC)).toString(),
    priceFeed: networkConfig[chainId].chainlinkFeeds.USDC,
    staticAToken: ausdcStaticToken.address,
    rewardToken: networkConfig[chainId].tokens.stkAAVE,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: getOracleTimeout(chainId).toString(),
    targetName: hre.ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.05').toString(), // 5%
    delayUntilDefault: bn('86400').toString(), // 24h
    oracleLib: phase1Deployment.oracleLib,
  })

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
      'stat' + (await aToken.symbol())
    )
  )
  await ausdtStaticToken.deployed()

  // Sleep 20s to allow sync
  await new Promise((r) => setTimeout(r, 20000))

  console.log(
    `Deployed StaticAToken for aUSDT on ${hre.network.name} (${chainId}): ${ausdtStaticToken.address} `
  )

  const { collateral: aUsdtCollateral } = await hre.run('deploy-atoken-fiat-collateral', {
    fallbackPrice: (await getCurrentPrice(networkConfig[chainId].chainlinkFeeds.USDT)).toString(), // close enougth
    priceFeed: networkConfig[chainId].chainlinkFeeds.USDT,
    staticAToken: ausdtStaticToken.address,
    rewardToken: networkConfig[chainId].tokens.stkAAVE,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: getOracleTimeout(chainId).toString(),
    targetName: hre.ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.05').toString(), // 5%
    delayUntilDefault: bn('86400').toString(), // 24h
    oracleLib: phase1Deployment.oracleLib,
  })

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
      'stat' + (await aToken.symbol())
    )
  )
  await abusdStaticToken.deployed()

  // Sleep 20s to allow sync
  await new Promise((r) => setTimeout(r, 20000))

  console.log(
    `Deployed StaticAToken for aBUSD on ${hre.network.name} (${chainId}): ${abusdStaticToken.address} `
  )

  const { collateral: aBusdCollateral } = await hre.run('deploy-atoken-fiat-collateral', {
    fallbackPrice: (await getCurrentPrice(networkConfig[chainId].chainlinkFeeds.BUSD)).toString(),
    priceFeed: networkConfig[chainId].chainlinkFeeds.BUSD,
    staticAToken: abusdStaticToken.address,
    rewardToken: networkConfig[chainId].tokens.stkAAVE,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: getOracleTimeout(chainId).toString(),
    targetName: hre.ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.05').toString(), // 5%
    delayUntilDefault: bn('86400').toString(), // 24h
    oracleLib: phase1Deployment.oracleLib,
  })

  assetCollDeployments.collateral.aBUSD = aBusdCollateral
  deployedCollateral.push(aBusdCollateral.toString())

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

  /********  Deploy CToken Fiat Collateral - cDAI  **************************/

  const { collateral: cDaiCollateral } = await hre.run('deploy-ctoken-fiat-collateral', {
    fallbackPrice: (await getCurrentPrice(networkConfig[chainId].chainlinkFeeds.DAI))
      .div(50)
      .toString(),
    priceFeed: networkConfig[chainId].chainlinkFeeds.DAI,
    cToken: networkConfig[chainId].tokens.cDAI,
    rewardToken: networkConfig[chainId].tokens.COMP,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: getOracleTimeout(chainId).toString(),
    targetName: hre.ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.05').toString(), // 5%
    delayUntilDefault: bn('86400').toString(), // 24h
    comptroller: networkConfig[chainId].COMPTROLLER,
    oracleLib: phase1Deployment.oracleLib,
  })

  assetCollDeployments.collateral.cDAI = cDaiCollateral
  deployedCollateral.push(cDaiCollateral.toString())

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

  /********  Deploy CToken Fiat Collateral - cUSDC  **************************/

  const { collateral: cUsdcCollateral } = await hre.run('deploy-ctoken-fiat-collateral', {
    fallbackPrice: (await getCurrentPrice(networkConfig[chainId].chainlinkFeeds.USDC))
      .div(50)
      .toString(),
    priceFeed: networkConfig[chainId].chainlinkFeeds.USDC,
    cToken: networkConfig[chainId].tokens.cUSDC,
    rewardToken: networkConfig[chainId].tokens.COMP,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: getOracleTimeout(chainId).toString(),
    targetName: hre.ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.05').toString(), // 5%
    delayUntilDefault: bn('86400').toString(), // 24h
    comptroller: networkConfig[chainId].COMPTROLLER,
    oracleLib: phase1Deployment.oracleLib,
  })

  assetCollDeployments.collateral.cUSDC = cUsdcCollateral
  deployedCollateral.push(cUsdcCollateral.toString())

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

  /********  Deploy CToken Fiat Collateral - cUSDT  **************************/

  const { collateral: cUsdtCollateral } = await hre.run('deploy-ctoken-fiat-collateral', {
    fallbackPrice: (await getCurrentPrice(networkConfig[chainId].chainlinkFeeds.USDT))
      .div(50)
      .toString(),
    priceFeed: networkConfig[chainId].chainlinkFeeds.USDT,
    cToken: networkConfig[chainId].tokens.cUSDT,
    rewardToken: networkConfig[chainId].tokens.COMP,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: getOracleTimeout(chainId).toString(),
    targetName: hre.ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.05').toString(), // 5%
    delayUntilDefault: bn('86400').toString(), // 24h
    comptroller: networkConfig[chainId].COMPTROLLER,
    oracleLib: phase1Deployment.oracleLib,
  })

  assetCollDeployments.collateral.cUSDT = cUsdtCollateral
  deployedCollateral.push(cUsdtCollateral.toString())

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

  /********  Deploy CToken Non-Fiat Collateral - cWBTC  **************************/

  const { collateral: cWBTCCollateral } = await hre.run('deploy-ctoken-nonfiat-collateral', {
    fallbackPrice: (await getCurrentPrice(networkConfig[chainId].chainlinkFeeds.BTC))
      .div(50)
      .toString(),
    referenceUnitFeed: networkConfig[chainId].chainlinkFeeds.WBTC,
    targetUnitFeed: networkConfig[chainId].chainlinkFeeds.BTC,
    cToken: networkConfig[chainId].tokens.cWBTC,
    rewardToken: networkConfig[chainId].tokens.COMP,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: getOracleTimeout(chainId).toString(),
    targetName: hre.ethers.utils.formatBytes32String('BTC'),
    defaultThreshold: fp('0.05').toString(), // 5%
    delayUntilDefault: bn('86400').toString(), // 24h
    comptroller: networkConfig[chainId].COMPTROLLER,
    oracleLib: phase1Deployment.oracleLib,
  })

  assetCollDeployments.collateral.cWBTC = cWBTCCollateral
  deployedCollateral.push(cWBTCCollateral.toString())

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

  /********  Deploy CToken Self-Referential Collateral - cETH  **************************/

  const { collateral: cETHCollateral } = await hre.run('deploy-ctoken-selfreferential-collateral', {
    fallbackPrice: (await getCurrentPrice(networkConfig[chainId].chainlinkFeeds.ETH))
      .div(50)
      .toString(),
    priceFeed: networkConfig[chainId].chainlinkFeeds.ETH,
    cToken: networkConfig[chainId].tokens.cETH,
    rewardToken: networkConfig[chainId].tokens.COMP,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: getOracleTimeout(chainId).toString(),
    targetName: hre.ethers.utils.formatBytes32String('ETH'),
    delayUntilDefault: bn('86400').toString(), // 24h
    decimals: bn(18).toString(),
    comptroller: networkConfig[chainId].COMPTROLLER,
    oracleLib: phase1Deployment.oracleLib,
  })

  assetCollDeployments.collateral.cETH = cETHCollateral
  deployedCollateral.push(cETHCollateral.toString())

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

  /********  Deploy Non-Fiat Collateral  - wBTC **************************/
  const { collateral: wBTCCollateral } = await hre.run('deploy-nonfiat-collateral', {
    fallbackPrice: (await getCurrentPrice(networkConfig[chainId].chainlinkFeeds.BTC)).toString(),
    referenceUnitFeed: networkConfig[chainId].chainlinkFeeds.WBTC,
    targetUnitFeed: networkConfig[chainId].chainlinkFeeds.BTC,
    tokenAddress: networkConfig[chainId].tokens.WBTC,
    rewardToken: ZERO_ADDRESS,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: getOracleTimeout(chainId).toString(),
    targetName: ethers.utils.formatBytes32String('BTC'),
    defaultThreshold: fp('0.05').toString(), // 5%
    delayUntilDefault: bn('86400').toString(), // 24h
    oracleLib: phase1Deployment.oracleLib,
  })

  assetCollDeployments.collateral.WBTC = wBTCCollateral
  deployedCollateral.push(wBTCCollateral.toString())

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

  /********  Deploy Self Referential Collateral - wETH  **************************/

  const { collateral: wETHCollateral } = await hre.run('deploy-selfreferential-collateral', {
    fallbackPrice: (await getCurrentPrice(networkConfig[chainId].chainlinkFeeds.ETH)).toString(),
    priceFeed: networkConfig[chainId].chainlinkFeeds.ETH,
    tokenAddress: networkConfig[chainId].tokens.WETH,
    rewardToken: ZERO_ADDRESS,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: getOracleTimeout(chainId).toString(),
    targetName: hre.ethers.utils.formatBytes32String('ETH'),
    delayUntilDefault: bn('86400').toString(), // 24h
    oracleLib: phase1Deployment.oracleLib,
  })

  assetCollDeployments.collateral.WETH = wETHCollateral
  deployedCollateral.push(wETHCollateral.toString())

  fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))

  /********  Deploy EURO Fiat Collateral  - EURT **************************/
  const { collateral: eurtCollateral } = await hre.run('deploy-eurfiat-collateral', {
    fallbackPrice: (await getCurrentPrice(networkConfig[chainId].chainlinkFeeds.EUR)).toString(),
    referenceUnitFeed: networkConfig[chainId].chainlinkFeeds.EURT,
    targetUnitFeed: networkConfig[chainId].chainlinkFeeds.EUR,
    tokenAddress: networkConfig[chainId].tokens.EURT,
    rewardToken: ZERO_ADDRESS,
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: getOracleTimeout(chainId).toString(),
    targetName: ethers.utils.formatBytes32String('EURO'),
    defaultThreshold: fp('0.05').toString(), // 5%
    delayUntilDefault: bn('86400').toString(), // 24h
    oracleLib: phase1Deployment.oracleLib,
  })

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
