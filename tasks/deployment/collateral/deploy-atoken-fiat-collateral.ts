import { getChainId } from '../../../common/blockchain-utils'
import { task } from 'hardhat/config'
import { ContractFactory } from 'ethers'
import { ATokenFiatCollateral } from '../../../typechain'

task('deploy-atoken-fiat-collateral', 'Deploys an AToken Fiat Collateral')
  .addParam('priceTimeout', 'The amount of time before a price decays to 0')
  .addParam('priceFeed', 'Price Feed address')
  .addParam('oracleError', 'The % error in the price feed as a fix')
  .addParam('staticAToken', 'Static AToken address')
  .addParam('maxTradeVolume', 'Max Trade Volume (in UoA)')
  .addParam('oracleTimeout', 'Max oracle timeout')
  .addParam('targetName', 'Target Name')
  .addParam('defaultThreshold', 'Default Threshold')
  .addParam('delayUntilDefault', 'Delay until default')
  .addParam('revenueHiding', 'Revenue Hiding')
  .setAction(async (params, hre) => {
    const [deployer] = await hre.ethers.getSigners()

    const chainId = await getChainId(hre)

    const ATokenCollateralFactory: ContractFactory = await hre.ethers.getContractFactory(
      'ATokenFiatCollateral'
    )

    const collateral = <ATokenFiatCollateral>await ATokenCollateralFactory.connect(deployer).deploy(
      {
        priceTimeout: params.priceTimeout,
        chainlinkFeed: params.priceFeed,
        oracleError: params.oracleError,
        erc20: params.staticAToken,
        maxTradeVolume: params.maxTradeVolume,
        oracleTimeout: params.oracleTimeout,
        targetName: params.targetName,
        defaultThreshold: params.defaultThreshold,
        delayUntilDefault: params.delayUntilDefault,
      },
      params.revenueHiding
    )
    await collateral.deployed()

    if (!params.noOutput) {
      console.log(
        `Deployed AToken Fiat Collateral to ${hre.network.name} (${chainId}): ${collateral.address}`
      )
    }

    return { collateral: collateral.address }
  })
