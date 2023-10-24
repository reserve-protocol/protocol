import fs from 'fs'
import hre, { ethers } from 'hardhat'
import { expect } from 'chai'
import { getChainId } from '../../../../common/blockchain-utils'
import { baseL2Chains, networkConfig } from '../../../../common/configuration'
import { bn, fp } from '../../../../common/numbers'
import { CollateralStatus } from '../../../../common/constants'
import {
  getDeploymentFile,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
  getDeploymentFilename,
  fileExists,
} from '../../common'
import { combinedError, priceTimeout, revenueHiding } from '../../utils'
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

  let collateral: ICollateral

  const wbtcOracleError = fp('0.02') // 2%
  const btcOracleError = fp('0.005') // 0.5%
  const combinedBTCWBTCError = combinedError(wbtcOracleError, btcOracleError)

  /*** Compound V2 not available in Base L2s */
  if (!baseL2Chains.includes(hre.network.name)) {
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

    console.log(
      `Deployed Vault for cDAI on ${hre.network.name} (${chainId}): ${cDaiVault.address} `
    )

    const { collateral: cDaiCollateral } = await hre.run('deploy-ctoken-fiat-collateral', {
      priceTimeout: priceTimeout.toString(),
      priceFeed: networkConfig[chainId].chainlinkFeeds.DAI,
      oracleError: fp('0.0025').toString(), // 0.25%
      cToken: cDaiVault.address,
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

    const { collateral: cWBTCCollateral } = await hre.run('deploy-ctoken-nonfiat-collateral', {
      priceTimeout: priceTimeout.toString(),
      referenceUnitFeed: networkConfig[chainId].chainlinkFeeds.WBTC,
      targetUnitFeed: networkConfig[chainId].chainlinkFeeds.BTC,
      combinedOracleError: combinedBTCWBTCError.toString(),
      cToken: cWBTCVault.address,
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

    console.log(
      `Deployed Vault for cETH on ${hre.network.name} (${chainId}): ${cETHVault.address} `
    )

    const { collateral: cETHCollateral } = await hre.run(
      'deploy-ctoken-selfreferential-collateral',
      {
        priceTimeout: priceTimeout.toString(),
        priceFeed: networkConfig[chainId].chainlinkFeeds.ETH,
        oracleError: fp('0.005').toString(), // 0.5%
        cToken: cETHVault.address,
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
    assetCollDeployments.erc20s.cETH = cETHVault.address
    deployedCollateral.push(cETHCollateral.toString())

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
