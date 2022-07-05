import { getChainId } from '../../../common/blockchain-utils'
import { task } from 'hardhat/config'
import { CTokenFiatCollateral, CTokenMock } from '../../../typechain'

task('deploy-ctoken-collateral', 'Deploys a CToken Collateral')
  .addParam('cToken', 'CToken address')
  .addParam('maxTradeVolume', 'Max trade volume')
  .addParam('defaultThreshold', 'Default Threshold')
  .addParam('delayUntilDefault', 'Delay until default')
  .addParam('comptroller', 'Comptroller address')
  .addParam('comp', 'Comp token address')
  .setAction(async (params, hre) => {
    const [deployer] = await hre.ethers.getSigners()

    const chainId = await getChainId(hre)

    // Get CToken to retrieve underlying
    const cToken: CTokenMock = <CTokenMock>(
      await hre.ethers.getContractAt('CTokenMock', params.cToken)
    )

    const CTokenCollateralFactory = await hre.ethers.getContractFactory('CTokenFiatCollateral')
    const cTokenCollateral = <CTokenFiatCollateral>(
      await CTokenCollateralFactory.connect(deployer).deploy(
        cToken.address,
        params.maxTradeVolume,
        params.defaultThreshold,
        params.delayUntilDefault,
        await cToken.underlying(),
        params.comptroller,
        params.comp
      )
    )
    await cTokenCollateral.deployed()

    console.log(
      `Deployed CToken Collateral to ${hre.network.name} (${chainId}): ${cTokenCollateral.address}`
    )

    return { cTokenCollateral: cTokenCollateral.address }
  })
