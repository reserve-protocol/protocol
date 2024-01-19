import fs from 'fs'
import hre from 'hardhat'
import { getChainId } from '../../../../common/blockchain-utils'
import { networkConfig } from '../../../../common/configuration'
import { bn, fp } from '../../../../common/numbers'
import { ethers } from 'hardhat'
import {
  getDeploymentFile,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
  getDeploymentFilename,
  fileExists,
} from '../../common'
import { priceTimeout, combinedError } from '../../utils'

async function main() {
  // ==== Read Configuration ====
  const [deployer] = await hre.ethers.getSigners()

  const chainId = await getChainId(hre)

  console.log(`Deploying Collateral to network ${hre.network.name} (${chainId})
    with burner account: ${deployer.address}`)

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

  const deployedCollateral: string[] = []
  const revenueHiding = fp('1e-6') // revenueHiding = 0.0001%

  /******** Deploy Morpho - AaveV2 **************************/

  /******** Morpho token vaults **************************/
  console.log(`Deploying morpho token vaults to network ${hre.network.name} (${chainId})
    with burner account: ${deployer.address}`)
  const MorphoTokenisedDepositFactory = await ethers.getContractFactory(
    'MorphoAaveV2TokenisedDeposit'
  )
  const maUSDT = await MorphoTokenisedDepositFactory.deploy({
    morphoController: networkConfig[chainId].MORPHO_AAVE_CONTROLLER!,
    morphoLens: networkConfig[chainId].MORPHO_AAVE_LENS!,
    underlyingERC20: networkConfig[chainId].tokens.USDT!,
    poolToken: networkConfig[chainId].tokens.aUSDT!,
    rewardToken: networkConfig[chainId].tokens.MORPHO!,
  })

  const maUSDC = await MorphoTokenisedDepositFactory.deploy({
    morphoController: networkConfig[chainId].MORPHO_AAVE_CONTROLLER!,
    morphoLens: networkConfig[chainId].MORPHO_AAVE_LENS!,
    underlyingERC20: networkConfig[chainId].tokens.USDC!,
    poolToken: networkConfig[chainId].tokens.aUSDC!,
    rewardToken: networkConfig[chainId].tokens.MORPHO!,
  })

  const maDAI = await MorphoTokenisedDepositFactory.deploy({
    morphoController: networkConfig[chainId].MORPHO_AAVE_CONTROLLER!,
    morphoLens: networkConfig[chainId].MORPHO_AAVE_LENS!,
    underlyingERC20: networkConfig[chainId].tokens.DAI!,
    poolToken: networkConfig[chainId].tokens.aDAI!,
    rewardToken: networkConfig[chainId].tokens.MORPHO!,
  })

  const maWBTC = await MorphoTokenisedDepositFactory.deploy({
    morphoController: networkConfig[chainId].MORPHO_AAVE_CONTROLLER!,
    morphoLens: networkConfig[chainId].MORPHO_AAVE_LENS!,
    underlyingERC20: networkConfig[chainId].tokens.WBTC!,
    poolToken: networkConfig[chainId].tokens.aWBTC!,
    rewardToken: networkConfig[chainId].tokens.MORPHO!,
  })

  const maWETH = await MorphoTokenisedDepositFactory.deploy({
    morphoController: networkConfig[chainId].MORPHO_AAVE_CONTROLLER!,
    morphoLens: networkConfig[chainId].MORPHO_AAVE_LENS!,
    underlyingERC20: networkConfig[chainId].tokens.WETH!,
    poolToken: networkConfig[chainId].tokens.aWETH!,
    rewardToken: networkConfig[chainId].tokens.MORPHO!,
  })

  const maStETH = await MorphoTokenisedDepositFactory.deploy({
    morphoController: networkConfig[chainId].MORPHO_AAVE_CONTROLLER!,
    morphoLens: networkConfig[chainId].MORPHO_AAVE_LENS!,
    underlyingERC20: networkConfig[chainId].tokens.stETH!,
    poolToken: networkConfig[chainId].tokens.astETH!,
    rewardToken: networkConfig[chainId].tokens.MORPHO!,
  })

  await maUSDT.deployed()
  await maUSDC.deployed()
  await maDAI.deployed()
  await maWBTC.deployed()
  await maWETH.deployed()
  await maStETH.deployed()

  assetCollDeployments.erc20s.maUSDT = maUSDT.address
  assetCollDeployments.erc20s.maUSDC = maUSDC.address
  assetCollDeployments.erc20s.maDAI = maDAI.address
  assetCollDeployments.erc20s.maWBTC = maWBTC.address
  assetCollDeployments.erc20s.maWETH = maWETH.address
  assetCollDeployments.erc20s.maStETH = maStETH.address

  /******** Morpho collateral **************************/
  const FiatCollateralFactory = await hre.ethers.getContractFactory('MorphoFiatCollateral')
  const NonFiatCollateralFactory = await hre.ethers.getContractFactory('MorphoNonFiatCollateral')
  const SelfReferentialFactory = await hre.ethers.getContractFactory(
    'MorphoSelfReferentialCollateral'
  )
  const stablesOracleError = fp('0.0025') // 0.25%

  const baseStableConfig = {
    priceTimeout: priceTimeout.toString(),
    oracleError: stablesOracleError.toString(),
    maxTradeVolume: fp('1e6').toString(), // $1m,
    oracleTimeout: '86400', // 24h
    targetName: ethers.utils.formatBytes32String('USD'),
    defaultThreshold: stablesOracleError.add(fp('0.01')), // 1.25%
    delayUntilDefault: bn('86400').toString(), // 24h
  }

  {
    const collateral = await FiatCollateralFactory.connect(deployer).deploy(
      {
        ...baseStableConfig,
        chainlinkFeed: networkConfig[chainId].chainlinkFeeds.USDT!,
        erc20: maUSDT.address,
      },
      revenueHiding
    )
    assetCollDeployments.collateral.maUSDT = collateral.address
    deployedCollateral.push(collateral.address.toString())
    fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))
    await (await collateral.refresh()).wait()
  }
  {
    const collateral = await FiatCollateralFactory.connect(deployer).deploy(
      {
        ...baseStableConfig,
        chainlinkFeed: networkConfig[chainId].chainlinkFeeds.USDC!,
        erc20: maUSDC.address,
      },
      revenueHiding
    )
    assetCollDeployments.collateral.maUSDC = collateral.address
    deployedCollateral.push(collateral.address.toString())
    fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))
    await (await collateral.refresh()).wait()
  }
  {
    const collateral = await FiatCollateralFactory.connect(deployer).deploy(
      {
        ...baseStableConfig,
        oracleTimeout: '3600', // 1 hr
        chainlinkFeed: networkConfig[chainId].chainlinkFeeds.DAI!,
        erc20: maDAI.address,
      },
      revenueHiding
    )
    assetCollDeployments.collateral.maDAI = collateral.address
    deployedCollateral.push(collateral.address.toString())
    fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))
    await (await collateral.refresh()).wait()
  }

  {
    const wbtcOracleError = fp('0.02') // 2%
    const btcOracleError = fp('0.005') // 0.5%
    const combinedBTCWBTCError = combinedError(wbtcOracleError, btcOracleError)
    const collateral = await NonFiatCollateralFactory.connect(deployer).deploy(
      {
        priceTimeout: priceTimeout,
        oracleError: combinedBTCWBTCError,
        maxTradeVolume: fp('1e6'), // $1m,
        oracleTimeout: '86400', // 24 hr
        targetName: ethers.utils.formatBytes32String('BTC'),
        defaultThreshold: fp('0.01').add(combinedBTCWBTCError), // ~3.5%
        delayUntilDefault: bn('86400'), // 24h
        chainlinkFeed: networkConfig[chainId].chainlinkFeeds.WBTC!, // {target/ref}
        erc20: maWBTC.address,
      },
      revenueHiding,
      networkConfig[chainId].chainlinkFeeds.BTC!, // {UoA/target}
      '3600' // 1 hr
    )
    assetCollDeployments.collateral.maWBTC = collateral.address
    deployedCollateral.push(collateral.address.toString())
    fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))
    await (await collateral.refresh()).wait()
  }

  {
    const collateral = await SelfReferentialFactory.connect(deployer).deploy(
      {
        priceTimeout: priceTimeout,
        oracleError: fp('0.005'),
        maxTradeVolume: fp('1e6'), // $1m,
        oracleTimeout: '3600', // 1 hr
        targetName: ethers.utils.formatBytes32String('ETH'),
        defaultThreshold: fp('0'), // 0% -- no soft default for self-referential collateral
        delayUntilDefault: bn('86400'), // 24h
        chainlinkFeed: networkConfig[chainId].chainlinkFeeds.ETH!,
        erc20: maWETH.address,
      },
      revenueHiding
    )
    assetCollDeployments.collateral.maWETH = collateral.address
    deployedCollateral.push(collateral.address.toString())
    fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))
    await (await collateral.refresh()).wait()
  }

  {
    const ethStEthOracleError = fp('0.005') // 0.5%
    const ethOracleError = fp('0.005') // 0.5%

    const combinedOracleErrors = combinedError(ethStEthOracleError, ethOracleError)

    // TAR: ETH
    // REF: stETH
    // TOK: maETH
    const collateral = await NonFiatCollateralFactory.connect(deployer).deploy(
      {
        priceTimeout: priceTimeout,
        oracleError: combinedOracleErrors,
        maxTradeVolume: fp('1e6'), // $1m,
        oracleTimeout: '86400', // 24 hr
        targetName: ethers.utils.formatBytes32String('ETH'),
        defaultThreshold: fp('0.01').add(combinedOracleErrors), // ~1.5%
        delayUntilDefault: bn('86400'), // 24h
        chainlinkFeed: networkConfig[chainId].chainlinkFeeds.stETHETH!, // {target/ref}
        erc20: maStETH.address,
      },
      revenueHiding,
      networkConfig[chainId].chainlinkFeeds.ETH!, // {UoA/target}
      '3600' // 1 hr
    )
    assetCollDeployments.collateral.maStETH = collateral.address
    deployedCollateral.push(collateral.address.toString())
    fs.writeFileSync(assetCollDeploymentFilename, JSON.stringify(assetCollDeployments, null, 2))
    await (await collateral.refresh()).wait()
  }

  console.log(`Deployed collateral to ${hre.network.name} (${chainId})
        New deployments: ${deployedCollateral}
        Deployment file: ${assetCollDeploymentFilename}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
