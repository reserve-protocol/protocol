import hre, { ethers } from 'hardhat'

import { getChainId } from '../../common/blockchain-utils'
import { developmentChains, networkConfig } from '../../common/configuration'
import { ZERO_ADDRESS } from '../../common/constants'
import { fp, bn } from '../../common/numbers'
import {
  getDeploymentFile,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
  IDeployments,
  getOracleTimeout,
  getDeploymentFilename,
  verifyContract,
} from '../deployment/deployment_utils'
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

  const phase1Deployments = <IDeployments>getDeploymentFile(getDeploymentFilename(chainId))

  const assetCollDeploymentFilename = getAssetCollDeploymentFilename(chainId)
  deployments = <IAssetCollDeployments>getDeploymentFile(assetCollDeploymentFilename)

  /********  Verify Fiat Collateral - DAI  **************************/
  await verifyContract(
    chainId,
    deployments.collateral.DAI,
    [
      networkConfig[chainId].chainlinkFeeds.DAI,
      networkConfig[chainId].tokens.DAI,
      ZERO_ADDRESS,
      {
        minVal: fp(chainId == 1 ? '1e4' : '0').toString(), // $10k,
        maxVal: fp(chainId == 1 ? '1e6' : '0').toString(), // $1m,
        minAmt: fp(chainId == 1 ? '1e3' : '1').toString(), // 1k DAI
        maxAmt: fp(chainId == 1 ? '1e6' : '1e9').toString(), // 1M DAI
      },
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
  await verifyContract(
    chainId,
    aTokenCollateral.address,
    [
      networkConfig[chainId].chainlinkFeeds.DAI,
      await aTokenCollateral.erc20(),
      networkConfig[chainId].tokens.stkAAVE,
      {
        minVal: fp(chainId == 1 ? '1e4' : '0').toString(), // $10k,
        maxVal: fp(chainId == 1 ? '1e6' : '0').toString(), // $1m,
        minAmt: fp(chainId == 1 ? '1e3' : '1').toString(), // 1k DAI
        maxAmt: fp(chainId == 1 ? '1e6' : '1e9').toString(), // 1M DAI
      },
      getOracleTimeout(chainId).toString(),
      hre.ethers.utils.formatBytes32String('USD'),
      fp('0.05').toString(), // 5%
      bn('86400').toString(), // 24h
    ],
    'contracts/plugins/assets/ATokenFiatCollateral.sol:ATokenFiatCollateral'
  )
  /********************** Verify CTokenFiatCollateral - cDAI  ****************************************/
  await verifyContract(
    chainId,
    deployments.collateral.cDAI,
    [
      networkConfig[chainId].chainlinkFeeds.DAI,
      networkConfig[chainId].tokens.cDAI,
      networkConfig[chainId].tokens.COMP,
      {
        minVal: fp(chainId == 1 ? '1e4' : '0').toString(), // $10k,
        maxVal: fp(chainId == 1 ? '1e6' : '0').toString(), // $1m,
        minAmt: fp(chainId == 1 ? '50e3' : '1').toString(), // 50k cDAI
        maxAmt: fp(chainId == 1 ? '50e6' : '1e9').toString(), // 50M cDAI
      },
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
  await verifyContract(
    chainId,
    deployments.collateral.cWBTC,
    [
      networkConfig[chainId].chainlinkFeeds.WBTC,
      networkConfig[chainId].chainlinkFeeds.BTC,
      networkConfig[chainId].tokens.cWBTC,
      networkConfig[chainId].tokens.COMP,
      {
        minVal: fp(chainId == 1 ? '1e4' : '0').toString(), // $10k,
        maxVal: fp(chainId == 1 ? '1e6' : '0').toString(), // $1m,
        minAmt: fp(chainId == 1 ? '12.5' : '1').toString(), // 12.5 cWBTC or 0.25 BTC
        maxAmt: fp(chainId == 1 ? '12500' : '1e9').toString(), // 12500 cWBTC or 250 BTC
      },
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
  await verifyContract(
    chainId,
    deployments.collateral.cETH,
    [
      networkConfig[chainId].chainlinkFeeds.ETH,
      networkConfig[chainId].tokens.cETH,
      networkConfig[chainId].tokens.COMP,
      {
        minVal: fp(chainId == 1 ? '1e4' : '0').toString(), // $10k,
        maxVal: fp(chainId == 1 ? '1e6' : '0').toString(), // $1m,
        minAmt: fp(chainId == 1 ? '25' : '1').toString(), // 25 cETH or 0.5 ETH
        maxAmt: fp(chainId == 1 ? '25e3' : '1e9').toString(), // 25,000 cETH or 500 ETH
      },
      getOracleTimeout(chainId).toString(),
      hre.ethers.utils.formatBytes32String('ETH'),
      bn(18).toString(),
      networkConfig[chainId].COMPTROLLER,
    ],
    'contracts/plugins/assets/CTokenSelfReferentialCollateral.sol:CTokenSelfReferentialCollateral'
  )
  /********************** Verify NonFiatCollateral - wBTC  ****************************************/
  await verifyContract(
    chainId,
    deployments.collateral.WBTC,
    [
      networkConfig[chainId].chainlinkFeeds.WBTC,
      networkConfig[chainId].chainlinkFeeds.BTC,
      networkConfig[chainId].tokens.WBTC,
      ZERO_ADDRESS,
      {
        minVal: fp(chainId == 1 ? '1e4' : '0').toString(), // $10k,
        maxVal: fp(chainId == 1 ? '1e6' : '0').toString(), // $1m,
        minAmt: fp(chainId == 1 ? '0.25' : '1').toString(), // 0.25 BTC
        maxAmt: fp(chainId == 1 ? '250' : '1e9').toString(), // 250 BTC
      },
      getOracleTimeout(chainId).toString(),
      ethers.utils.formatBytes32String('BTC'),
      fp('0.05').toString(), // 5%
      bn('86400').toString(), // 24h
    ],
    'contracts/plugins/assets/NonFiatCollateral.sol:NonFiatCollateral'
  )
  /********************** Verify SelfReferentialCollateral - cETH  ****************************************/
  await verifyContract(
    chainId,
    deployments.collateral.WETH,
    [
      networkConfig[chainId].chainlinkFeeds.ETH,
      networkConfig[chainId].tokens.WETH,
      ZERO_ADDRESS,
      {
        minVal: fp(chainId == 1 ? '1e4' : '0').toString(), // $10k,
        maxVal: fp(chainId == 1 ? '1e6' : '0').toString(), // $1m,
        minAmt: fp(chainId == 1 ? '0.5' : '1').toString(), // 0.5 ETH
        maxAmt: fp(chainId == 1 ? '500' : '1e9').toString(), // 500 ETH
      },
      getOracleTimeout(chainId).toString(),
      hre.ethers.utils.formatBytes32String('ETH'),
    ],
    'contracts/plugins/assets/SelfReferentialCollateral.sol:SelfReferentialCollateral'
  )

  /********************** Verify EURFiatCollateral - EURT  ****************************************/
  await verifyContract(
    chainId,
    deployments.collateral.EURT,
    [
      networkConfig[chainId].chainlinkFeeds.EURT,
      networkConfig[chainId].chainlinkFeeds.EUR,
      networkConfig[chainId].tokens.EURT,
      ZERO_ADDRESS,
      {
        minVal: fp(chainId == 1 ? '1e4' : '0').toString(), // $10k,
        maxVal: fp(chainId == 1 ? '1e6' : '0').toString(), // $1m,
        minAmt: fp(chainId == 1 ? '1e3' : '1').toString(), // 1k EURO
        maxAmt: fp(chainId == 1 ? '1e6' : '1e9').toString(), // 1M EURO
      },
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
