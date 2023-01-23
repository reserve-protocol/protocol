import hre, { ethers } from 'hardhat'

import { getChainId } from '../../common/blockchain-utils'
import { developmentChains, networkConfig } from '../../common/configuration'
import { fp, bn } from '../../common/numbers'
import {
  getDeploymentFile,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
} from '../deployment/common'
import { combinedError, priceTimeout, getOracleTimeout, verifyContract } from '../deployment/utils'
import { ATokenMock, ATokenFiatCollateral } from '../../typechain'

let deployments: IAssetCollDeployments

async function main() {
  // ********** Read config **********
  const chainId = await getChainId(hre)
  if (!networkConfig[chainId]) {
    throw new Error(`Missing network configuration for ${hre.network.name}`)
  }

  if (developmentChains.includes(hre.network.name)) {
    throw new Error(`Cannot verify contracts for development chain ${hre.network.name}`)
  }

  const assetCollDeploymentFilename = getAssetCollDeploymentFilename(chainId)
  deployments = <IAssetCollDeployments>getDeploymentFile(assetCollDeploymentFilename)

  /********  Verify Fiat Collateral - DAI  **************************/
  await verifyContract(
    chainId,
    deployments.collateral.DAI,
    [
      {
        priceTimeout: priceTimeout.toString(),
        chainlinkFeed: networkConfig[chainId].chainlinkFeeds.DAI,
        oracleError: fp('0.0025').toString(), // 0.25%
        erc20: networkConfig[chainId].tokens.DAI,
        maxTradeVolume: fp('1e6').toString(), // $1m,
        oracleTimeout: getOracleTimeout(chainId).toString(),
        targetName: hre.ethers.utils.formatBytes32String('USD'),
        defaultThreshold: fp('0.0125').toString(), // 1.25%
        delayUntilDefault: bn('86400').toString(), // 24h
      },
    ],
    'contracts/plugins/assets/FiatCollateral.sol:FiatCollateral'
  )
  /********  Verify StaticATokenLM - aDAI  **************************/
  // Get AToken to retrieve name and symbol
  const aToken: ATokenMock = <ATokenMock>(
    await ethers.getContractAt('ATokenMock', networkConfig[chainId].tokens.aDAI as string)
  )
  const aTokenCollateral: ATokenFiatCollateral = <ATokenFiatCollateral>(
    await ethers.getContractAt('ATokenFiatCollateral', deployments.collateral.aDAI as string)
  )

  await verifyContract(
    chainId,
    await aTokenCollateral.erc20(),
    [
      networkConfig[chainId].AAVE_LENDING_POOL as string,
      aToken.address,
      'Static ' + (await aToken.name()),
      'stat' + (await aToken.symbol()),
    ],
    'contracts/plugins/aave/StaticATokenLM.sol:StaticATokenLM'
  )
  /********  Verify ATokenFiatCollateral - aDAI  **************************/
  await verifyContract(
    chainId,
    aTokenCollateral.address,
    [
      {
        priceTimeout: priceTimeout.toString(),
        chainlinkFeed: networkConfig[chainId].chainlinkFeeds.DAI,
        oracleError: fp('0.0025').toString(), // 0.25%
        erc20: await aTokenCollateral.erc20(),
        maxTradeVolume: fp('1e6').toString(), // $1m,
        oracleTimeout: getOracleTimeout(chainId).toString(),
        targetName: hre.ethers.utils.formatBytes32String('USD'),
        defaultThreshold: fp('0.0125').toString(), // 1.25%
        delayUntilDefault: bn('86400').toString(), // 24h
      },
    ],
    'contracts/plugins/assets/ATokenFiatCollateral.sol:ATokenFiatCollateral'
  )
  /********************** Verify CTokenFiatCollateral - cDAI  ****************************************/
  await verifyContract(
    chainId,
    deployments.collateral.cDAI,
    [
      {
        priceTimeout: priceTimeout.toString(),
        chainlinkFeed: networkConfig[chainId].chainlinkFeeds.DAI,
        oracleError: fp('0.0025').toString(), // 0.25%
        erc20: networkConfig[chainId].tokens.cDAI,
        maxTradeVolume: fp('1e6').toString(), // $1m,
        oracleTimeout: getOracleTimeout(chainId).toString(),
        targetName: hre.ethers.utils.formatBytes32String('USD'),
        defaultThreshold: fp('0.0125').toString(), // 1.25%
        delayUntilDefault: bn('86400').toString(), // 24h
      },
      networkConfig[chainId].COMPTROLLER,
    ],
    'contracts/plugins/assets/CTokenFiatCollateral.sol:CTokenFiatCollateral'
  )
  /********************** Verify CTokenNonFiatCollateral - cWBTC  ****************************************/

  const wbtcOracleError = fp('0.02') // 2%
  const btcOracleError = fp('0.005') // 0.5%
  const combinedBTCWBTCError = combinedError(wbtcOracleError, btcOracleError)

  await verifyContract(
    chainId,
    deployments.collateral.cWBTC,
    [
      {
        priceTimeout: priceTimeout.toString(),
        chainlinkFeed: networkConfig[chainId].chainlinkFeeds.WBTC,
        oracleError: combinedBTCWBTCError.toString(),
        cToken: networkConfig[chainId].tokens.cWBTC,
        maxTradeVolume: fp('1e6').toString(), // $1m,
        oracleTimeout: getOracleTimeout(chainId).toString(),
        targetName: hre.ethers.utils.formatBytes32String('BTC'),
        defaultThreshold: fp('0.01').add(combinedBTCWBTCError).toString(), // ~3.5%
        delayUntilDefault: bn('86400').toString(), // 24h
      },
      networkConfig[chainId].chainlinkFeeds.BTC,
      networkConfig[chainId].COMPTROLLER,
    ],
    'contracts/plugins/assets/CTokenNonFiatCollateral.sol:CTokenNonFiatCollateral'
  )
  /********************** Verify CTokenSelfReferentialFiatCollateral - cETH  ****************************************/
  await verifyContract(
    chainId,
    deployments.collateral.cETH,
    [
      {
        priceTimeout: priceTimeout.toString(),
        chainlinkFeed: networkConfig[chainId].chainlinkFeeds.ETH,
        oracleError: fp('0.005').toString(), // 0.5%
        erc20: networkConfig[chainId].tokens.cETH,
        maxTradeVolume: fp('1e6').toString(), // $1m,
        oracleTimeout: getOracleTimeout(chainId).toString(),
        targetName: hre.ethers.utils.formatBytes32String('ETH'),
        defaultThreshold: '0',
        delayUntilDefault: '0',
      },
      '18',
      networkConfig[chainId].COMPTROLLER,
    ],
    'contracts/plugins/assets/CTokenSelfReferentialCollateral.sol:CTokenSelfReferentialCollateral'
  )
  /********************** Verify NonFiatCollateral - wBTC  ****************************************/
  await verifyContract(
    chainId,
    deployments.collateral.WBTC,
    [
      {
        priceTimeout: priceTimeout.toString(),
        chainlinkFeed: networkConfig[chainId].chainlinkFeeds.WBTC,
        oracleError: combinedBTCWBTCError.toString(),
        erc20: networkConfig[chainId].tokens.WBTC,
        maxTradeVolume: fp('1e6').toString(), // $1m,
        oracleTimeout: getOracleTimeout(chainId).toString(),
        targetName: ethers.utils.formatBytes32String('BTC'),
        defaultThreshold: fp('0.01').add(combinedBTCWBTCError).toString(), // ~3.5%
        delayUntilDefault: bn('86400').toString(), // 24h
      },
      networkConfig[chainId].chainlinkFeeds.BTC,
    ],
    'contracts/plugins/assets/NonFiatCollateral.sol:NonFiatCollateral'
  )
  /********************** Verify SelfReferentialCollateral - WETH  ****************************************/
  await verifyContract(
    chainId,
    deployments.collateral.WETH,
    [
      {
        priceTimeout: priceTimeout.toString(),
        chainlinkFeed: networkConfig[chainId].chainlinkFeeds.ETH,
        oracleError: fp('0.005').toString(), // 0.5%
        erc20: networkConfig[chainId].tokens.WETH,
        maxTradeVolume: fp('1e6').toString(), // $1m,
        oracleTimeout: getOracleTimeout(chainId).toString(),
        targetName: hre.ethers.utils.formatBytes32String('ETH'),
        defaultThreshold: '0',
        delayUntilDefault: '0',
      },
    ],
    'contracts/plugins/assets/SelfReferentialCollateral.sol:SelfReferentialCollateral'
  )

  /********************** Verify EURFiatCollateral - EURT  ****************************************/
  await verifyContract(
    chainId,
    deployments.collateral.EURT,
    [
      {
        priceTimeout: priceTimeout.toString(),
        chainlinkFeed: networkConfig[chainId].chainlinkFeeds.EURT,
        oracleError: fp('0.02').toString(), // 2%
        erc20: networkConfig[chainId].tokens.EURT,
        maxTradeVolume: fp('1e6').toString(), // $1m,
        oracleTimeout: getOracleTimeout(chainId).toString(),
        targetName: ethers.utils.formatBytes32String('EURO'),
        defaultThreshold: fp('0.03').toString(), // 3%
        delayUntilDefault: bn('86400').toString(), // 24h
      },
      networkConfig[chainId].chainlinkFeeds.EUR,
    ],
    'contracts/plugins/assets/EURFiatCollateral.sol:EURFiatCollateral'
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
