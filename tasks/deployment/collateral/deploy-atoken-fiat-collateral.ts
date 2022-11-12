import { getChainId } from '../../../common/blockchain-utils'
import { task } from 'hardhat/config'
import { ContractFactory } from 'ethers'
import { ATokenFiatCollateral } from '../../../typechain'

task('deploy-atoken-fiat-collateral', 'Deploys an AToken Fiat Collateral')
  .addParam('fallbackPrice', 'A fallback price (in UoA)')
  .addParam('priceFeed', 'Price Feed address')
  .addParam('staticAToken', 'Static AToken address')
  .addParam('maxTradeVolume', 'Max Trade Volume (in UoA)')
  .addParam('oracleTimeout', 'Max oracle timeout')
  .addParam('targetName', 'Target Name')
  .addParam('defaultThreshold', 'Default Threshold')
  .addParam('delayUntilDefault', 'Delay until default')
  .addParam('oracleLib', 'Oracle library address')
  .setAction(async (params, hre) => {
    const [deployer] = await hre.ethers.getSigners()

    const chainId = await getChainId(hre)

    const ATokenCollateralFactory: ContractFactory = await hre.ethers.getContractFactory(
      'ATokenFiatCollateral',
      { libraries: { OracleLib: params.oracleLib } }
    )

    const collateral = <ATokenFiatCollateral>(
      await ATokenCollateralFactory.connect(deployer).deploy(
        params.fallbackPrice,
        params.priceFeed,
        params.staticAToken,
        params.maxTradeVolume,
        params.oracleTimeout,
        params.targetName,
        params.defaultThreshold,
        params.delayUntilDefault
      )
    )
    await collateral.deployed()

    if (!params.noOutput) {
      console.log(
        `Deployed AToken Fiat Collateral to ${hre.network.name} (${chainId}): ${collateral.address}`
      )
    }

    return { collateral: collateral.address }
  })
