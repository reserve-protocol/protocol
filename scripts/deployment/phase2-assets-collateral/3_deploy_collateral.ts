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

  // Check previous step completed
  const assetCollDeploymentFilename = getAssetCollDeploymentFilename(chainId)
  const assetCollDeployments = <IAssetCollDeployments>getDeploymentFile(assetCollDeploymentFilename)

  // Get Oracle Lib address if previously deployed (can override with arbitrary address)
  const ORACLE_LIB_ADDRESS = assetCollDeployments.oracleLib
  const ORACLE_TIMEOUT = bn('86400') // 24h
  let deployedCollateral: string[] = []

  /********  Deploy Fiat Collateral - DAI  **************************/
  const { collateral: daiCollateral } = await hre.run('deploy-fiat-collateral', {
    priceFeed: networkConfig[chainId].chainlinkFeeds.DAI,
    tokenAddress: networkConfig[chainId].tokens.DAI,
    rewardToken: ZERO_ADDRESS,
    tradingMin: fp('0.01').toString(), // min trade
    tradingMax: fp('1e6').toString(), // max trade
    maxOracleTimeout: ORACLE_TIMEOUT.toString(), // 24h
    targetName: hre.ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.05').toString(), // 5%
    delayUntilDefault: bn('86400').toString(), // 24h
    oracleLibrary: ORACLE_LIB_ADDRESS,
  })

  assetCollDeployments.collateral.DAI = daiCollateral
  deployedCollateral.push(daiCollateral.toString())

  /********  Deploy Fiat Collateral - USDC  **************************/
  const { collateral: usdcCollateral } = await hre.run('deploy-fiat-collateral', {
    priceFeed: networkConfig[chainId].chainlinkFeeds.USDC,
    tokenAddress: networkConfig[chainId].tokens.USDC,
    rewardToken: ZERO_ADDRESS,
    tradingMin: fp('0.01').toString(), // min trade
    tradingMax: fp('1e6').toString(), // max trade
    maxOracleTimeout: ORACLE_TIMEOUT.toString(), // 24h
    targetName: hre.ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.05').toString(), // 5%
    delayUntilDefault: bn('86400').toString(), // 24h
    oracleLibrary: ORACLE_LIB_ADDRESS,
  })

  assetCollDeployments.collateral.USDC = usdcCollateral
  deployedCollateral.push(usdcCollateral.toString())

  /********  Deploy Fiat Collateral - USDT  **************************/
  const { collateral: usdtCollateral } = await hre.run('deploy-fiat-collateral', {
    priceFeed: networkConfig[chainId].chainlinkFeeds.USDT,
    tokenAddress: networkConfig[chainId].tokens.USDT,
    rewardToken: ZERO_ADDRESS,
    tradingMin: fp('0.01').toString(), // min trade
    tradingMax: fp('1e6').toString(), // max trade
    maxOracleTimeout: ORACLE_TIMEOUT.toString(),
    targetName: hre.ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.05').toString(), // 5%
    delayUntilDefault: bn('86400').toString(), // 24h
    oracleLibrary: ORACLE_LIB_ADDRESS,
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
    tradingMin: fp('0.01').toString(), // min trade
    tradingMax: fp('1e6').toString(), // max trade
    maxOracleTimeout: ORACLE_TIMEOUT.toString(), // 24h
    targetName: hre.ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.05').toString(), // 5%
    delayUntilDefault: bn('86400').toString(), // 24h
    oracleLibrary: ORACLE_LIB_ADDRESS,
  })

  assetCollDeployments.collateral.aDAI = aDaiCollateral
  deployedCollateral.push(aDaiCollateral.toString())

  /********  Deploy CToken Fiat Collateral - cDAI  **************************/

  const { collateral: cDaiCollateral } = await hre.run('deploy-ctoken-fiat-collateral', {
    priceFeed: networkConfig[chainId].chainlinkFeeds.DAI,
    cToken: networkConfig[chainId].tokens.cDAI,
    rewardToken: networkConfig[chainId].tokens.COMP,
    tradingMin: fp('0.01').toString(), // min trade
    tradingMax: fp('1e6').toString(), // max trade
    maxOracleTimeout: ORACLE_TIMEOUT.toString(), // 24h
    targetName: hre.ethers.utils.formatBytes32String('USD'),
    defaultThreshold: fp('0.05').toString(), // 5%
    delayUntilDefault: bn('86400').toString(), // 24h
    comptroller: networkConfig[chainId].COMPTROLLER,
    oracleLibrary: ORACLE_LIB_ADDRESS,
  })

  assetCollDeployments.collateral.cDAI = cDaiCollateral
  deployedCollateral.push(cDaiCollateral.toString())

  /********  Deploy CToken Non-Fiat Collateral - cWBTC  **************************/

  const { collateral: cWBTCCollateral } = await hre.run('deploy-ctoken-nonfiat-collateral', {
    referenceUnitFeed: networkConfig[chainId].chainlinkFeeds.WBTC,
    targetUnitFeed: networkConfig[chainId].chainlinkFeeds.BTC,
    cToken: networkConfig[chainId].tokens.cWBTC,
    rewardToken: networkConfig[chainId].tokens.COMP,
    tradingMin: fp('0.01').toString(), // min trade
    tradingMax: fp('1e6').toString(), // max trade
    maxOracleTimeout: ORACLE_TIMEOUT.toString(), // 24h
    targetName: hre.ethers.utils.formatBytes32String('BTC'),
    defaultThreshold: fp('0.05').toString(), // 5%
    delayUntilDefault: bn('86400').toString(), // 24h
    comptroller: networkConfig[chainId].COMPTROLLER,
    oracleLibrary: ORACLE_LIB_ADDRESS,
  })

  assetCollDeployments.collateral.cWBTC = cWBTCCollateral
  deployedCollateral.push(cWBTCCollateral.toString())

  /********  Deploy CToken Self-Referential Collateral - cETH  **************************/

  const { collateral: cETHCollateral } = await hre.run('deploy-ctoken-selfreferential-collateral', {
    priceFeed: networkConfig[chainId].chainlinkFeeds.ETH,
    cToken: networkConfig[chainId].tokens.cETH,
    rewardToken: networkConfig[chainId].tokens.COMP,
    tradingMin: fp('0.01').toString(), // min trade
    tradingMax: fp('1e6').toString(), // max trade
    maxOracleTimeout: ORACLE_TIMEOUT.toString(), // 24h
    targetName: hre.ethers.utils.formatBytes32String('ETH'),
    decimals: bn(18).toString(),
    comptroller: networkConfig[chainId].COMPTROLLER,
    oracleLibrary: ORACLE_LIB_ADDRESS,
  })

  assetCollDeployments.collateral.cETH = cETHCollateral
  deployedCollateral.push(cETHCollateral.toString())

  /********  Deploy Non-Fiat Collateral  - wBTC **************************/
  const { collateral: wBTCCollateral } = await hre.run('deploy-nonfiat-collateral', {
    referenceUnitFeed: networkConfig[chainId].chainlinkFeeds.WBTC,
    targetUnitFeed: networkConfig[chainId].chainlinkFeeds.BTC,
    tokenAddress: networkConfig[chainId].tokens.WBTC,
    rewardToken: ZERO_ADDRESS,
    tradingMin: fp('0.01').toString(), // min trade
    tradingMax: fp('1e6').toString(), // max trade
    maxOracleTimeout: ORACLE_TIMEOUT.toString(), // 24h
    targetName: ethers.utils.formatBytes32String('BTC'),
    defaultThreshold: fp('0.05').toString(), // 5%
    delayUntilDefault: bn('86400').toString(), // 24h
    oracleLibrary: ORACLE_LIB_ADDRESS,
  })

  assetCollDeployments.collateral.WBTC = wBTCCollateral
  deployedCollateral.push(wBTCCollateral.toString())

  /********  Deploy Self Referential Collateral - wETH  **************************/

  const { collateral: wETHCollateral } = await hre.run('deploy-selfreferential-collateral', {
    priceFeed: networkConfig[chainId].chainlinkFeeds.ETH,
    tokenAddress: networkConfig[chainId].tokens.WETH,
    rewardToken: ZERO_ADDRESS,
    tradingMin: fp('0.01').toString(), // min trade
    tradingMax: fp('1e6').toString(), // max trade
    maxOracleTimeout: ORACLE_TIMEOUT.toString(), // 24h
    targetName: hre.ethers.utils.formatBytes32String('ETH'),
    oracleLibrary: ORACLE_LIB_ADDRESS,
  })

  assetCollDeployments.collateral.WETH = wETHCollateral
  deployedCollateral.push(wETHCollateral.toString())

  /********  Deploy EURO Fiat Collateral  - EURT **************************/
  const { collateral: eurtCollateral } = await hre.run('deploy-eurfiat-collateral', {
    referenceUnitFeed: networkConfig[chainId].chainlinkFeeds.EURT,
    targetUnitFeed: networkConfig[chainId].chainlinkFeeds.EUR,
    tokenAddress: networkConfig[chainId].tokens.EURT,
    rewardToken: ZERO_ADDRESS,
    tradingMin: fp('0.01').toString(), // min trade
    tradingMax: fp('1e6').toString(), // max trade
    maxOracleTimeout: ORACLE_TIMEOUT.toString(), // 24h
    targetName: ethers.utils.formatBytes32String('EURO'),
    defaultThreshold: fp('0.05').toString(), // 5%
    delayUntilDefault: bn('86400').toString(), // 24h
    oracleLibrary: ORACLE_LIB_ADDRESS,
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
