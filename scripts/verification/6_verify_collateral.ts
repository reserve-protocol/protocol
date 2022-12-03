import hre, { ethers } from 'hardhat'

import { getChainId } from '../../common/blockchain-utils'
import { developmentChains, networkConfig } from '../../common/configuration'
import { fp, bn } from '../../common/numbers'
import {
  getDeploymentFile,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
} from '../deployment/common'
import { getOracleTimeout, verifyContract } from '../deployment/utils'
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

  let asset = await ethers.getContractAt('Asset', deployments.collateral.DAI as string)
  /********  Verify Fiat Collateral - DAI  **************************/
  await verifyContract(
    chainId,
    deployments.collateral.DAI,
    [
      (await asset.fallbackPrice()).toString(),
      networkConfig[chainId].chainlinkFeeds.DAI,
      networkConfig[chainId].tokens.DAI,
      fp('1e6').toString(),
      getOracleTimeout(chainId).toString(),
      hre.ethers.utils.formatBytes32String('USD'),
      fp('0.05').toString(), // 5%
      bn('86400').toString(), // 24h
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
  asset = await ethers.getContractAt('Asset', aTokenCollateral.address as string)
  await verifyContract(
    chainId,
    aTokenCollateral.address,
    [
      (await asset.fallbackPrice()).toString(),
      networkConfig[chainId].chainlinkFeeds.DAI,
      await aTokenCollateral.erc20(),
      fp('1e6').toString(), // $1m
      getOracleTimeout(chainId).toString(),
      hre.ethers.utils.formatBytes32String('USD'),
      fp('0.05').toString(), // 5%
      bn('86400').toString(), // 24h
    ],
    'contracts/plugins/assets/ATokenFiatCollateral.sol:ATokenFiatCollateral'
  )
  /********************** Verify CTokenFiatCollateral - cDAI  ****************************************/
  asset = await ethers.getContractAt('Asset', deployments.collateral.cDAI as string)
  await verifyContract(
    chainId,
    deployments.collateral.cDAI,
    [
      (await asset.fallbackPrice()).toString(),
      networkConfig[chainId].chainlinkFeeds.DAI,
      networkConfig[chainId].tokens.cDAI,
      fp('1e6').toString(), // $1m
      getOracleTimeout(chainId).toString(),
      hre.ethers.utils.formatBytes32String('USD'),
      fp('0.05').toString(), // 5%
      bn('86400').toString(), // 24h
      bn(18).toString(),
      networkConfig[chainId].COMPTROLLER,
    ],
    'contracts/plugins/assets/CTokenFiatCollateral.sol:CTokenFiatCollateral'
  )
  /********************** Verify CTokenNonFiatCollateral - cWBTC  ****************************************/
  asset = await ethers.getContractAt('Asset', deployments.collateral.cWBTC as string)
  await verifyContract(
    chainId,
    deployments.collateral.cWBTC,
    [
      (await asset.fallbackPrice()).toString(),
      networkConfig[chainId].chainlinkFeeds.WBTC,
      networkConfig[chainId].chainlinkFeeds.BTC,
      networkConfig[chainId].tokens.cWBTC,
      fp('1e6').toString(), // $1m
      getOracleTimeout(chainId).toString(),
      hre.ethers.utils.formatBytes32String('BTC'),
      fp('0.05').toString(), // 5%
      bn('86400').toString(), // 24h
      bn(8).toString(),
      networkConfig[chainId].COMPTROLLER,
    ],
    'contracts/plugins/assets/CTokenNonFiatCollateral.sol:CTokenNonFiatCollateral'
  )
  /********************** Verify CTokenSelfReferentialFiatCollateral - cETH  ****************************************/
  asset = await ethers.getContractAt('Asset', deployments.collateral.cETH as string)
  await verifyContract(
    chainId,
    deployments.collateral.cETH,
    [
      (await asset.fallbackPrice()).toString(),
      networkConfig[chainId].chainlinkFeeds.ETH,
      networkConfig[chainId].tokens.cETH,
      fp('1e6').toString(), // $1m
      getOracleTimeout(chainId).toString(),
      hre.ethers.utils.formatBytes32String('ETH'),
      bn('86400').toString(), // 24h
      bn(18).toString(),
      networkConfig[chainId].COMPTROLLER,
    ],
    'contracts/plugins/assets/CTokenSelfReferentialCollateral.sol:CTokenSelfReferentialCollateral'
  )
  /********************** Verify NonFiatCollateral - wBTC  ****************************************/
  asset = await ethers.getContractAt('Asset', deployments.collateral.WBTC as string)
  await verifyContract(
    chainId,
    deployments.collateral.WBTC,
    [
      (await asset.fallbackPrice()).toString(),
      networkConfig[chainId].chainlinkFeeds.WBTC,
      networkConfig[chainId].chainlinkFeeds.BTC,
      networkConfig[chainId].tokens.WBTC,
      fp('1e6').toString(), // $1m
      getOracleTimeout(chainId).toString(),
      ethers.utils.formatBytes32String('BTC'),
      fp('0.05').toString(), // 5%
      bn('86400').toString(), // 24h
    ],
    'contracts/plugins/assets/NonFiatCollateral.sol:NonFiatCollateral'
  )
  /********************** Verify SelfReferentialCollateral - cETH  ****************************************/
  asset = await ethers.getContractAt('Asset', deployments.collateral.WETH as string)
  await verifyContract(
    chainId,
    deployments.collateral.WETH,
    [
      (await asset.fallbackPrice()).toString(),
      networkConfig[chainId].chainlinkFeeds.ETH,
      networkConfig[chainId].tokens.WETH,
      fp('1e6').toString(), // $1m
      getOracleTimeout(chainId).toString(),
      hre.ethers.utils.formatBytes32String('ETH'),
      bn('86400').toString(), // 24h
    ],
    'contracts/plugins/assets/SelfReferentialCollateral.sol:SelfReferentialCollateral'
  )

  /********************** Verify EURFiatCollateral - EURT  ****************************************/
  asset = await ethers.getContractAt('Asset', deployments.collateral.EURT as string)
  await verifyContract(
    chainId,
    deployments.collateral.EURT,
    [
      (await asset.fallbackPrice()).toString(),
      networkConfig[chainId].chainlinkFeeds.EURT,
      networkConfig[chainId].chainlinkFeeds.EUR,
      networkConfig[chainId].tokens.EURT,
      fp('1e6').toString(), // $1m
      getOracleTimeout(chainId).toString(),
      ethers.utils.formatBytes32String('EURO'),
      fp('0.05').toString(), // 5%
      bn('86400').toString(), // 24h
    ],
    'contracts/plugins/assets/EURFiatCollateral.sol:EURFiatCollateral'
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
