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
  getOracleTimeout,
  getDeploymentFilename,
  IDeployments,
  fileExists,
} from '../deployment_utils'
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
    priceFeed: networkConfig[chainId].chainlinkFeeds.DAI,
    tokenAddress: networkConfig[chainId].tokens.DAI,
    rewardToken: ZERO_ADDRESS,
    tradingMinVal: fp(chainId == 1 ? '1e4' : '0').toString(), // $10k,
    tradingMaxVal: fp(chainId == 1 ? '1e6' : '0').toString(), // $1m,
    tradingMinAmt: fp(chainId == 1 ? '1e3' : '1').toString(), // 1k DAI
    tradingMaxAmt: fp(chainId == 1 ? '1e6' : '1e9').toString(), // 1M DAI
    oracleTimeout: getOracleTimeout(chainId),
    targetName: hre.ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.05').toString(), // 5%
    delayUntilDefault: bn('86400').toString(), // 24h
    oracleLib: phase1Deployment.oracleLib,
  })

  assetCollDeployments.collateral.DAI = daiCollateral
  deployedCollateral.push(daiCollateral.toString())

  /********  Deploy Fiat Collateral - USDC  **************************/
  const { collateral: usdcCollateral } = await hre.run('deploy-fiat-collateral', {
    priceFeed: networkConfig[chainId].chainlinkFeeds.USDC,
    tokenAddress: networkConfig[chainId].tokens.USDC,
    rewardToken: ZERO_ADDRESS,
    tradingMinVal: fp(chainId == 1 ? '1e4' : '0').toString(), // $10k,
    tradingMaxVal: fp(chainId == 1 ? '1e6' : '0').toString(), // $1m,
    tradingMinAmt: fp(chainId == 1 ? '1e3' : '1').toString(), // 1k USDC
    tradingMaxAmt: fp(chainId == 1 ? '1e6' : '1e9').toString(), // 1M USDC
    oracleTimeout: getOracleTimeout(chainId),
    targetName: hre.ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.05').toString(), // 5%
    delayUntilDefault: bn('86400').toString(), // 24h
    oracleLib: phase1Deployment.oracleLib,
  })

  assetCollDeployments.collateral.USDC = usdcCollateral
  deployedCollateral.push(usdcCollateral.toString())

  /********  Deploy Fiat Collateral - USDT  **************************/
  const { collateral: usdtCollateral } = await hre.run('deploy-fiat-collateral', {
    priceFeed: networkConfig[chainId].chainlinkFeeds.USDT,
    tokenAddress: networkConfig[chainId].tokens.USDT,
    rewardToken: ZERO_ADDRESS,
    tradingMinVal: fp(chainId == 1 ? '1e4' : '0').toString(), // $10k,
    tradingMaxVal: fp(chainId == 1 ? '1e6' : '0').toString(), // $1m,
    tradingMinAmt: fp(chainId == 1 ? '1e3' : '1').toString(), // 1k USDT
    tradingMaxAmt: fp(chainId == 1 ? '1e6' : '1e9').toString(), // 1M USDT
    oracleTimeout: getOracleTimeout(chainId),
    targetName: hre.ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.05').toString(), // 5%
    delayUntilDefault: bn('86400').toString(), // 24h
    oracleLib: phase1Deployment.oracleLib,
  })

  assetCollDeployments.collateral.USDT = usdtCollateral
  deployedCollateral.push(usdtCollateral.toString())

  /********  Deploy AToken Fiat Collateral - aDAI  **************************/

  // Get AToken to retrieve name and symbol
  const aToken: ATokenMock = <ATokenMock>(
    await ethers.getContractAt('ATokenMock', networkConfig[chainId].tokens.aDAI as string)
  )

  // Wrap in StaticAToken
  const StaticATokenFactory = await ethers.getContractFactory('StaticATokenLM')
  const staticAToken: StaticATokenLM = <StaticATokenLM>(
    await StaticATokenFactory.connect(burner).deploy(
      networkConfig[chainId].AAVE_LENDING_POOL as string,
      aToken.address,
      'Static ' + (await aToken.name()),
      'stat' + (await aToken.symbol())
    )
  )
  await staticAToken.deployed()

  console.log(
    `Deployed StaticAToken for aDAI on ${hre.network.name} (${chainId}): ${staticAToken.address} `
  )

  const { collateral: aDaiCollateral } = await hre.run('deploy-atoken-fiat-collateral', {
    priceFeed: networkConfig[chainId].chainlinkFeeds.DAI,
    staticAToken: staticAToken.address,
    rewardToken: networkConfig[chainId].tokens.stkAAVE,
    tradingMinVal: fp(chainId == 1 ? '1e4' : '0').toString(), // $10k,
    tradingMaxVal: fp(chainId == 1 ? '1e6' : '0').toString(), // $1m,
    tradingMinAmt: fp(chainId == 1 ? '1e3' : '1').toString(), // 1k aDAI
    tradingMaxAmt: fp(chainId == 1 ? '1e6' : '1e9').toString(), // 1M aDAI
    oracleTimeout: getOracleTimeout(chainId),
    targetName: hre.ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.05').toString(), // 5%
    delayUntilDefault: bn('86400').toString(), // 24h
    oracleLib: phase1Deployment.oracleLib,
  })

  assetCollDeployments.collateral.aDAI = aDaiCollateral
  deployedCollateral.push(aDaiCollateral.toString())

  /********  Deploy CToken Fiat Collateral - cDAI  **************************/

  const { collateral: cDaiCollateral } = await hre.run('deploy-ctoken-fiat-collateral', {
    priceFeed: networkConfig[chainId].chainlinkFeeds.DAI,
    cToken: networkConfig[chainId].tokens.cDAI,
    rewardToken: networkConfig[chainId].tokens.COMP,
    tradingMinVal: fp(chainId == 1 ? '1e4' : '0').toString(), // $10k,
    tradingMaxVal: fp(chainId == 1 ? '1e6' : '0').toString(), // $1m,
    tradingMinAmt: fp(chainId == 1 ? '50e3' : '1').toString(), // 50k cDAI
    tradingMaxAmt: fp(chainId == 1 ? '50e6' : '1e9').toString(), // 50M cDAI
    oracleTimeout: getOracleTimeout(chainId),
    targetName: hre.ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.05').toString(), // 5%
    delayUntilDefault: bn('86400').toString(), // 24h
    comptroller: networkConfig[chainId].COMPTROLLER,
    oracleLib: phase1Deployment.oracleLib,
  })

  assetCollDeployments.collateral.cDAI = cDaiCollateral
  deployedCollateral.push(cDaiCollateral.toString())

  /********  Deploy CToken Non-Fiat Collateral - cWBTC  **************************/

  const { collateral: cWBTCCollateral } = await hre.run('deploy-ctoken-nonfiat-collateral', {
    referenceUnitFeed: networkConfig[chainId].chainlinkFeeds.WBTC,
    targetUnitFeed: networkConfig[chainId].chainlinkFeeds.BTC,
    cToken: networkConfig[chainId].tokens.cWBTC,
    rewardToken: networkConfig[chainId].tokens.COMP,
    tradingMinVal: fp(chainId == 1 ? '1e4' : '0').toString(), // $10k,
    tradingMaxVal: fp(chainId == 1 ? '1e6' : '0').toString(), // $1m,
    tradingMinAmt: fp(chainId == 1 ? '12.5' : '1').toString(), // 12.5 cWBTC or 0.25 BTC
    tradingMaxAmt: fp(chainId == 1 ? '12500' : '1e9').toString(), // 12500 cWBTC or 250 BTC
    oracleTimeout: getOracleTimeout(chainId),
    targetName: hre.ethers.utils.formatBytes32String('BTC'),
    defaultThreshold: fp('0.05').toString(), // 5%
    delayUntilDefault: bn('86400').toString(), // 24h
    comptroller: networkConfig[chainId].COMPTROLLER,
    oracleLib: phase1Deployment.oracleLib,
  })

  assetCollDeployments.collateral.cWBTC = cWBTCCollateral
  deployedCollateral.push(cWBTCCollateral.toString())

  /********  Deploy CToken Self-Referential Collateral - cETH  **************************/

  const { collateral: cETHCollateral } = await hre.run('deploy-ctoken-selfreferential-collateral', {
    priceFeed: networkConfig[chainId].chainlinkFeeds.ETH,
    cToken: networkConfig[chainId].tokens.cETH,
    rewardToken: networkConfig[chainId].tokens.COMP,
    tradingMinVal: fp(chainId == 1 ? '1e4' : '0').toString(), // $10k,
    tradingMaxVal: fp(chainId == 1 ? '1e6' : '0').toString(), // $1m,
    tradingMinAmt: fp(chainId == 1 ? '25' : '1').toString(), // 25 cETH or 0.5 ETH
    tradingMaxAmt: fp(chainId == 1 ? '25e3' : '1e9').toString(), // 25,000 cETH or 500 ETH
    oracleTimeout: getOracleTimeout(chainId),
    targetName: hre.ethers.utils.formatBytes32String('ETH'),
    decimals: bn(18).toString(),
    comptroller: networkConfig[chainId].COMPTROLLER,
    oracleLib: phase1Deployment.oracleLib,
  })

  assetCollDeployments.collateral.cETH = cETHCollateral
  deployedCollateral.push(cETHCollateral.toString())

  /********  Deploy Non-Fiat Collateral  - wBTC **************************/
  const { collateral: wBTCCollateral } = await hre.run('deploy-nonfiat-collateral', {
    referenceUnitFeed: networkConfig[chainId].chainlinkFeeds.WBTC,
    targetUnitFeed: networkConfig[chainId].chainlinkFeeds.BTC,
    tokenAddress: networkConfig[chainId].tokens.WBTC,
    rewardToken: ZERO_ADDRESS,
    tradingMinVal: fp(chainId == 1 ? '1e4' : '0').toString(), // $10k,
    tradingMaxVal: fp(chainId == 1 ? '1e6' : '0').toString(), // $1m,
    tradingMinAmt: fp(chainId == 1 ? '0.25' : '1').toString(), // 0.25 BTC
    tradingMaxAmt: fp(chainId == 1 ? '250' : '1e9').toString(), // 250 BTC
    oracleTimeout: getOracleTimeout(chainId),
    targetName: ethers.utils.formatBytes32String('BTC'),
    defaultThreshold: fp('0.05').toString(), // 5%
    delayUntilDefault: bn('86400').toString(), // 24h
    oracleLib: phase1Deployment.oracleLib,
  })

  assetCollDeployments.collateral.WBTC = wBTCCollateral
  deployedCollateral.push(wBTCCollateral.toString())

  /********  Deploy Self Referential Collateral - wETH  **************************/

  const { collateral: wETHCollateral } = await hre.run('deploy-selfreferential-collateral', {
    priceFeed: networkConfig[chainId].chainlinkFeeds.ETH,
    tokenAddress: networkConfig[chainId].tokens.WETH,
    rewardToken: ZERO_ADDRESS,
    tradingMinVal: fp(chainId == 1 ? '1e4' : '0').toString(), // $10k,
    tradingMaxVal: fp(chainId == 1 ? '1e6' : '0').toString(), // $1m,
    tradingMinAmt: fp(chainId == 1 ? '0.5' : '1').toString(), // 0.5 ETH
    tradingMaxAmt: fp(chainId == 1 ? '500' : '1e9').toString(), // 500 ETH
    oracleTimeout: getOracleTimeout(chainId),
    targetName: hre.ethers.utils.formatBytes32String('ETH'),
    oracleLib: phase1Deployment.oracleLib,
  })

  assetCollDeployments.collateral.WETH = wETHCollateral
  deployedCollateral.push(wETHCollateral.toString())

  /********  Deploy EURO Fiat Collateral  - EURT **************************/
  const { collateral: eurtCollateral } = await hre.run('deploy-eurfiat-collateral', {
    referenceUnitFeed: networkConfig[chainId].chainlinkFeeds.EURT,
    targetUnitFeed: networkConfig[chainId].chainlinkFeeds.EUR,
    tokenAddress: networkConfig[chainId].tokens.EURT,
    rewardToken: ZERO_ADDRESS,
    tradingMinVal: fp(chainId == 1 ? '1e4' : '0').toString(), // $10k,
    tradingMaxVal: fp(chainId == 1 ? '1e6' : '0').toString(), // $1m,
    tradingMinAmt: fp(chainId == 1 ? '1e3' : '1').toString(), // 1k EURO
    tradingMaxAmt: fp(chainId == 1 ? '1e6' : '1e9').toString(), // 1M EURO
    oracleTimeout: getOracleTimeout(chainId),
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
