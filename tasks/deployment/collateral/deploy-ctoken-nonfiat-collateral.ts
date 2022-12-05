import { getChainId } from '../../../common/blockchain-utils'
import { task } from 'hardhat/config'
import { CTokenNonFiatCollateral } from '../../../typechain'

task('deploy-ctoken-nonfiat-collateral', 'Deploys a CToken Non-Fiat Collateral')
  .addParam('lotPrice', 'A lot price (in UoA)')
  .addParam('referenceUnitFeed', 'Reference Price Feed address')
  .addParam('targetUnitFeed', 'Target Unit Price Feed address')
  .addParam('combinedOracleError', 'The combined % error from both oracle sources')
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

    const CTokenNonFiatCollateralFactory = await hre.ethers.getContractFactory(
      'CTokenNonFiatCollateral'
    )

    const collateral = <CTokenNonFiatCollateral>await CTokenNonFiatCollateralFactory.connect(
      deployer
    ).deploy(
      {
        lotPrice: params.lotPrice,
        chainlinkFeed: params.referenceUnitFeed,
        oracleError: params.combinedOracleError,
        erc20: params.cToken,
        maxTradeVolume: params.maxTradeVolume,
        oracleTimeout: params.oracleTimeout,
        targetName: params.targetName,
        defaultThreshold: params.defaultThreshold,
        delayUntilDefault: params.delayUntilDefault,
      },
      params.targetUnitFeed,
      params.comptroller
    )
    await collateral.deployed()

    if (!params.noOutput) {
      console.log(
        `Deployed CToken Non-Fiat Collateral to ${hre.network.name} (${chainId}): ${collateral.address}`
      )
    }
    return { collateral: collateral.address }
  })
