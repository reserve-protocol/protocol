import hre, { ethers } from 'hardhat'

import { getChainId } from '../../../common/blockchain-utils'
import { developmentChains, networkConfig } from '../../../common/configuration'
import { ZERO_ADDRESS } from '../../../common/constants'
import { fp, bn } from '../../../common/numbers'
import {
  getDeploymentFile,
  getAssetCollDeploymentFilename,
  IAssetCollDeployments,
  IDeployments,
  getDeploymentFilename,
  getOracleTimeout,
  fileExists,
} from '../deployment_utils'
import { ATokenMock, ATokenFiatCollateral } from '../../../typechain'

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

  // Get phase1 deployment
  const phase1File = getDeploymentFilename(chainId)
  if (!fileExists(phase1File)) {
    throw new Error(`${phase1File} doesn't exist yet. Run phase 1`)
  }
  const phase1Deployment = <IDeployments>getDeploymentFile(phase1File)

  const assetCollDeploymentFilename = getAssetCollDeploymentFilename(chainId)
  deployments = <IAssetCollDeployments>getDeploymentFile(assetCollDeploymentFilename)

  /********************** Verify stkAAVE asset  ****************************************/
  console.time('Verifying Asset')
  await hre.run('verify:verify', {
    address: deployments.assets.stkAAVE,
    constructorArguments: [
      networkConfig[chainId].chainlinkFeeds.AAVE,
      networkConfig[chainId].tokens.stkAAVE,
      ZERO_ADDRESS,
      fp(chainId == 1 ? '1e4' : '0').toString(), // $10k,
      fp(chainId == 1 ? '1e6' : '0').toString(), // $1m,
      fp(chainId == 1 ? '10' : '1').toString(), // 10 StkAAVE
      fp(chainId == 1 ? '1e4' : '1e9').toString(), // 10,000 StkAAVE
      getOracleTimeout(chainId).toString(),
      phase1Deployment.oracleLib,
    ],
    contract: 'contracts/plugins/assets/Asset.sol:Asset',
  })
  console.timeEnd('Verifying Asset')

  /********  Verify Fiat Collateral - DAI  **************************/
  console.time('Verifying FiatCollateral')
  await hre.run('verify:verify', {
    address: deployments.collateral.DAI,
    constructorArguments: [
      networkConfig[chainId].chainlinkFeeds.DAI,
      networkConfig[chainId].tokens.DAI,
      ZERO_ADDRESS,
      fp(chainId == 1 ? '1e4' : '0').toString(), // $10k,
      fp(chainId == 1 ? '1e6' : '0').toString(), // $1m,
      fp(chainId == 1 ? '1e3' : '1').toString(), // 1k DAI
      fp(chainId == 1 ? '1e6' : '1e9').toString(), // 1M DAI
      getOracleTimeout(chainId).toString(),
      hre.ethers.utils.formatBytes32String('USD'),
      fp('0.05').toString(), // 5%
      bn('86400').toString(), // 24h
      phase1Deployment.oracleLib,
    ],
    contract: 'contracts/plugins/assets/FiatCollateral.sol:FiatCollateral',
  })
  console.timeEnd('Verifying FiatCollateral')

  /********  Verify StaticATokenLM - aDAI  **************************/
  console.time('Verifying StaticATokenLM')

  // Get AToken to retrieve name and symbol
  const aToken: ATokenMock = <ATokenMock>(
    await ethers.getContractAt('ATokenMock', networkConfig[chainId].tokens.aDAI as string)
  )
  const aTokenCollateral: ATokenFiatCollateral = <ATokenFiatCollateral>(
    await ethers.getContractAt('ATokenFiatCollateral', deployments.collateral.aDAI as string)
  )
  await hre.run('verify:verify', {
    address: await aTokenCollateral.erc20(),
    constructorArguments: [
      networkConfig[chainId].AAVE_LENDING_POOL as string,
      aToken.address,
      'Static ' + (await aToken.name()),
      'stat' + (await aToken.symbol()),
    ],
    contract: 'contracts/plugins/aave/StaticATokenLM.sol:StaticATokenLM',
  })
  console.timeEnd('Verifying StaticATokenLM')

  /********  Verify ATokenFiatCollateral - aDAI  **************************/
  console.time('Verifying ATokenFiatCollateral')
  await hre.run('verify:verify', {
    address: deployments.collateral.aDAI,
    constructorArguments: [
      networkConfig[chainId].chainlinkFeeds.DAI,
      networkConfig[chainId].tokens.DAI,
      ZERO_ADDRESS,
      fp(chainId == 1 ? '1e4' : '0').toString(), // $10k,
      fp(chainId == 1 ? '1e6' : '0').toString(), // $1m,
      fp(chainId == 1 ? '1e3' : '1').toString(), // 1k DAI
      fp(chainId == 1 ? '1e6' : '1e9').toString(), // 1M DAI
      getOracleTimeout(chainId).toString(),
      hre.ethers.utils.formatBytes32String('USD'),
      fp('0.05').toString(), // 5%
      bn('86400').toString(), // 24h
      phase1Deployment.oracleLib,
    ],
    contract: 'contracts/plugins/assets/ATokenFiatCollateral.sol:ATokenFiatCollateral',
  })
  console.timeEnd('Verifying ATokenFiatCollateral')

  /********************** Verify CTokenFiatCollateral - cDAI  ****************************************/
  console.time('Verifying CTokenFiatCollateral')
  await hre.run('verify:verify', {
    address: deployments.collateral.cDAI,
    constructorArguments: [
      networkConfig[chainId].chainlinkFeeds.DAI,
      networkConfig[chainId].tokens.cDAI,
      networkConfig[chainId].tokens.COMP,
      fp(chainId == 1 ? '1e4' : '0').toString(), // $10k,
      fp(chainId == 1 ? '1e6' : '0').toString(), // $1m,
      fp(chainId == 1 ? '50e3' : '1').toString(), // 50k cDAI
      fp(chainId == 1 ? '50e6' : '1e9').toString(), // 50M cDAI
      getOracleTimeout(chainId).toString(),
      hre.ethers.utils.formatBytes32String('USD'),
      fp('0.05').toString(), // 5%
      bn('86400').toString(), // 24h
      networkConfig[chainId].COMPTROLLER,
      phase1Deployment.oracleLib,
    ],
    contract: 'contracts/plugins/assets/CTokenFiatCollateral.sol:CTokenFiatCollateral',
  })
  console.timeEnd('Verifying CTokenFiatCollateral')

  /********************** Verify CTokenNonFiatCollateral - cWBTC  ****************************************/
  console.time('Verifying CTokenNonFiatCollateral')
  await hre.run('verify:verify', {
    address: deployments.collateral.cWBTC,
    constructorArguments: [
      networkConfig[chainId].chainlinkFeeds.WBTC,
      networkConfig[chainId].chainlinkFeeds.BTC,
      networkConfig[chainId].tokens.cWBTC,
      networkConfig[chainId].tokens.COMP,
      fp(chainId == 1 ? '1e4' : '0').toString(), // $10k,
      fp(chainId == 1 ? '1e6' : '0').toString(), // $1m,
      fp(chainId == 1 ? '12.5' : '1').toString(), // 12.5 cWBTC or 0.25 BTC
      fp(chainId == 1 ? '12500' : '1e9').toString(), // 12500 cWBTC or 250 BTC
      getOracleTimeout(chainId).toString(),
      hre.ethers.utils.formatBytes32String('BTC'),
      fp('0.05').toString(), // 5%
      bn('86400').toString(), // 24h
      networkConfig[chainId].COMPTROLLER,
      phase1Deployment.oracleLib,
    ],
    contract: 'contracts/plugins/assets/CTokenNonFiatCollateral.sol:CTokenNonFiatCollateral',
  })
  console.timeEnd('Verifying CTokenNonFiatCollateral')

  /********************** Verify CTokenSelfReferentialFiatCollateral - cETH  ****************************************/
  console.time('Verifying CTokenSelfReferentialCollateral')
  await hre.run('verify:verify', {
    address: deployments.collateral.cETH,
    constructorArguments: [
      networkConfig[chainId].chainlinkFeeds.ETH,
      networkConfig[chainId].tokens.cETH,
      networkConfig[chainId].tokens.COMP,
      fp(chainId == 1 ? '1e4' : '0').toString(), // $10k,
      fp(chainId == 1 ? '1e6' : '0').toString(), // $1m,
      fp(chainId == 1 ? '25' : '1').toString(), // 25 cETH or 0.5 ETH
      fp(chainId == 1 ? '25e3' : '1e9').toString(), // 25,000 cETH or 500 ETH
      getOracleTimeout(chainId).toString(),
      hre.ethers.utils.formatBytes32String('ETH'),
      bn(18).toString(),
      networkConfig[chainId].COMPTROLLER,
      phase1Deployment.oracleLib,
    ],
    contract:
      'contracts/plugins/assets/CTokenSelfReferentialCollateral.sol:CTokenSelfReferentialCollateral',
  })
  console.timeEnd('Verifying CTokenSelfReferentialCollateral')

  /********************** Verify NonFiatCollateral - wBTC  ****************************************/
  console.time('Verifying NonFiatCollateral')
  await hre.run('verify:verify', {
    address: deployments.collateral.WBTC,
    constructorArguments: [
      networkConfig[chainId].chainlinkFeeds.WBTC,
      networkConfig[chainId].chainlinkFeeds.BTC,
      networkConfig[chainId].tokens.WBTC,
      ZERO_ADDRESS,
      fp(chainId == 1 ? '1e4' : '0').toString(), // $10k,
      fp(chainId == 1 ? '1e6' : '0').toString(), // $1m,
      fp(chainId == 1 ? '0.25' : '1').toString(), // 0.25 BTC
      fp(chainId == 1 ? '250' : '1e9').toString(), // 250 BTC
      getOracleTimeout(chainId).toString(),
      ethers.utils.formatBytes32String('BTC'),
      fp('0.05').toString(), // 5%
      bn('86400').toString(), // 24h
      phase1Deployment.oracleLib,
    ],
    contract: 'contracts/plugins/assets/NonFiatCollateral.sol:NonFiatCollateral',
  })
  console.timeEnd('Verifying NonFiatCollateral')

  /********************** Verify SelfReferentialCollateral - wBTC  ****************************************/
  console.time('Verifying SelfReferentialCollateral')
  await hre.run('verify:verify', {
    address: deployments.collateral.WETH,
    constructorArguments: [
      networkConfig[chainId].chainlinkFeeds.ETH,
      networkConfig[chainId].tokens.WETH,
      ZERO_ADDRESS,
      fp(chainId == 1 ? '1e4' : '0').toString(), // $10k,
      fp(chainId == 1 ? '1e6' : '0').toString(), // $1m,
      fp(chainId == 1 ? '0.5' : '1').toString(), // 0.5 ETH
      fp(chainId == 1 ? '500' : '1e9').toString(), // 500 ETH
      getOracleTimeout(chainId).toString(),
      hre.ethers.utils.formatBytes32String('ETH'),
      phase1Deployment.oracleLib,
    ],
    contract: 'contracts/plugins/assets/SelfReferentialCollateral.sol:SelfReferentialCollateral',
  })
  console.timeEnd('Verifying SelfReferentialCollateral')

  /********************** Verify EURFiatCollateral - EURT  ****************************************/
  console.time('Verifying EURFiatCollateral')
  await hre.run('verify:verify', {
    address: deployments.collateral.EURT,
    constructorArguments: [
      networkConfig[chainId].chainlinkFeeds.EURT,
      networkConfig[chainId].chainlinkFeeds.EUR,
      networkConfig[chainId].tokens.EURT,
      ZERO_ADDRESS,
      fp(chainId == 1 ? '1e4' : '0').toString(), // $10k,
      fp(chainId == 1 ? '1e6' : '0').toString(), // $1m,
      fp(chainId == 1 ? '1e3' : '1').toString(), // 1k EURO
      fp(chainId == 1 ? '1e6' : '1e9').toString(), // 1M EURO
      getOracleTimeout(chainId).toString(),
      ethers.utils.formatBytes32String('EURO'),
      fp('0.05').toString(), // 5%
      bn('86400').toString(), // 24h
      phase1Deployment.oracleLib,
    ],
    contract: 'contracts/plugins/assets/EURFiatCollateral.sol:EURFiatCollateral',
  })
  console.timeEnd('Verifying EURFiatCollateral')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
