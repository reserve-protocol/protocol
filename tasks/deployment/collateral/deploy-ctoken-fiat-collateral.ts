import { getChainId } from '../../../common/blockchain-utils'
import { task } from 'hardhat/config'
import { CTokenFiatCollateral } from '../../../typechain'

task('deploy-ctoken-fiat-collateral', 'Deploys a CToken Fiat Collateral')
  .addParam('fallbackPrice', 'A fallback price (in UoA)')
  .addParam('priceFeed', 'Price Feed address')
  .addParam('oracleError', 'The % error in the price feed as a fix')
  .addParam('cToken', 'CToken address')
  .addParam('maxTradeVolume', 'Max Trade Volume (in UoA)')
  .addParam('oracleTimeout', 'Max oracle timeout')
  .addParam('targetName', 'Target Name')
  .addParam('defaultThreshold', 'Default Threshold')
  .addParam('delayUntilDefault', 'Delay until default')
  .addParam('comptroller', 'Comptroller address')
  .setAction(async (params, hre) => {
    const [deployer] = await hre.ethers.getSigners()

    const chainId = await getChainId(hre)

    const CTokenCollateralFactory = await hre.ethers.getContractFactory('CTokenFiatCollateral')

    const collateral = <CTokenFiatCollateral>await CTokenCollateralFactory.connect(deployer).deploy(
      {
        fallbackPrice: params.fallbackPrice,
        chainlinkFeed: params.priceFeed,
        oracleError: params.oracleError,
        erc20: params.cToken,
        maxTradeVolume: params.maxTradeVolume,
        oracleTimeout: params.oracleTimeout,
        targetName: params.targetName,
        defaultThreshold: params.defaultThreshold,
        delayUntilDefault: params.delayUntilDefault,
      },
      params.comptroller
    )
    await collateral.deployed()

    if (!params.noOutput) {
      console.log(
        `Deployed CToken Fiat Collateral to ${hre.network.name} (${chainId}): ${collateral.address}`
      )
    }
    return { collateral: collateral.address }
  })
