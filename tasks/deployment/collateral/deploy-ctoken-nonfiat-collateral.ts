import { getChainId } from '../../../common/blockchain-utils'
import { task } from 'hardhat/config'
import { CTokenNonFiatCollateral } from '../../../typechain'

task('deploy-ctoken-nonfiat-collateral', 'Deploys a CToken Non-Fiat Collateral')
  .addParam('fallbackPrice', 'A fallback price (in UoA)')
  .addParam('referenceUnitFeed', 'Reference Price Feed address')
  .addParam('referenceUnitOracleError', 'The % error in the ref unit price feed as a fix')
  .addParam('targetUnitFeed', 'Target Unit Price Feed address')
  .addParam('targetUnitOracleError', 'The % error in the target unit price feed as a fix')
  .addParam('cToken', 'CToken address')
  .addParam('maxTradeVolume', 'Max Trade Volume (in UoA)')
  .addParam('oracleTimeout', 'Max oracle timeout')
  .addParam('targetName', 'Target Name')
  .addParam('defaultThreshold', 'Default Threshold')
  .addParam('delayUntilDefault', 'Delay until default')
  .addParam('oracleLib', 'Oracle library address')
  .setAction(async (params, hre) => {
    const [deployer] = await hre.ethers.getSigners()

    const chainId = await getChainId(hre)

    const CTokenNonFiatCollateralFactory = await hre.ethers.getContractFactory(
      'CTokenNonFiatCollateral',
      {
        libraries: { OracleLib: params.oracleLib },
      }
    )

    const collateral = <CTokenNonFiatCollateral>(
      await CTokenNonFiatCollateralFactory.connect(deployer).deploy(
        params.fallbackPrice,
        params.referenceUnitFeed,
        params.referenceUnitOracleError,
        params.targetUnitFeed,
        params.targetUnitOracleError,
        params.cToken,
        params.maxTradeVolume,
        params.oracleTimeout,
        params.targetName,
        params.defaultThreshold,
        params.delayUntilDefault,
        params.comptroller
      )
    )
    await collateral.deployed()

    if (!params.noOutput) {
      console.log(
        `Deployed CToken Non-Fiat Collateral to ${hre.network.name} (${chainId}): ${collateral.address}`
      )
    }
    return { collateral: collateral.address }
  })
