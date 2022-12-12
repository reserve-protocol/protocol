import { getChainId } from '../../../common/blockchain-utils'
import { task } from 'hardhat/config'
import {
  TFLendingCollateral,
  ERC20Mock,
  TFLendingCollateral,
  TrueFiPoolMock,
} from '../../../typechain'

task('deploy-truefi-lending-collateral', 'Deploys a Truefi Lending Collateral')
  .addParam('fallbackPrice', 'A fallback price (in UoA)')
  .addParam('priceFeed', 'Price Feed address')
  .addParam('erc20', 'Truefi Lending Token address')
  .addParam('maxTradeVolume', 'Max Trade Volume (in UoA)')
  .addParam('oracleTimeout', 'Max oracle timeout')
  .addParam('targetName', 'Target Name')
  .addParam('defaultThreshold', 'Default Threshold')
  .addParam('delayUntilDefault', 'Delay until default')
  .addParam('loanDefaultThreshold', 'Loan Default Threshold')
  .setAction(async (params, hre) => {
    const [deployer] = await hre.ethers.getSigners()

    const chainId = await getChainId(hre)

    const tfToken: TrueFiPoolMock = <TrueFiPoolMock>(
      await hre.ethers.getContractAt('TrueFiPoolMock', params.erc20)
    )

    // Get Underlying
    const erc20: ERC20Mock = <ERC20Mock>(
      await hre.ethers.getContractAt('ERC20Mock', await tfToken.underlying())
    )

    const TrueFiLendingCollateralFactory = await hre.ethers.getContractFactory(
      'TFLendingCollateral',
      {
        libraries: { OracleLib: params.oracleLib },
      }
    )

    const collateral = <TFLendingCollateral>(
      await TrueFiLendingCollateralFactory.connect(deployer).deploy(
        params.fallbackPrice,
        params.priceFeed,
        params.erc20,
        params.maxTradeVolume,
        params.oracleTimeout,
        params.targetName,
        params.defaultThreshold,
        params.delayUntilDefault,
        params.loanDefaultThreshold
      )
    )
    await collateral.deployed()

    if (!params.noOutput) {
      console.log(
        `Deployed Truefi Lending Collateral to ${hre.network.name} (${chainId}): ${collateral.address}`
      )
    }
    return { collateral: collateral.address }
  })
