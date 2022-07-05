import { getChainId } from '../../../common/blockchain-utils'
import { task } from 'hardhat/config'
import { ATokenFiatCollateral, ATokenMock, StaticATokenLM } from '../../../typechain'

task('deploy-atoken-collateral', 'Deploys an AToken Collateral')
  .addParam('staticAToken', 'Static AToken address')
  .addParam('maxTradeVolume', 'Max trade volume')
  .addParam('defaultThreshold', 'Default Threshold')
  .addParam('delayUntilDefault', 'Delay until default')
  .addParam('comptroller', 'Comptroller address')
  .addParam('aaveLendingPool', 'Aave Lending Pool address')
  .addParam('stkAAVE', 'stkAAVE token address')
  .setAction(async (params, hre) => {
    const [deployer] = await hre.ethers.getSigners()

    const chainId = await getChainId(hre)

    const ATokenCollateralFactory = await hre.ethers.getContractFactory('ATokenFiatCollateral')

    // Get StaticAToken
    const staticAToken: StaticATokenLM = <StaticATokenLM>(
        await hre.ethers.getContractAt('StaticATokenLM', params.staticAToken)
    )

    // Get AToken to retrieve underlying
    const aToken: ATokenMock = <ATokenMock>(
      await hre.ethers.getContractAt('ATokenMock', await staticAToken.ATOKEN())
    )

    const aTokenCollateral = <ATokenFiatCollateral>(
      await ATokenCollateralFactory.connect(deployer).deploy(
        params.staticAToken,
        params.maxTradeVolume,
        params.defaultThreshold,
        params.delayUntilDefault,
        await aToken.UNDERLYING_ASSET_ADDRESS(),
        params.comptroller,
        params.aaveLendingPool,
        params.stkAAVE
      )
    )

    await aTokenCollateral.deployed()

    console.log(
      `Deployed AToken Collateral to ${hre.network.name} (${chainId}): ${aTokenCollateral.address}`
    )

    return { aTokenCollateral: aTokenCollateral.address }
  })
