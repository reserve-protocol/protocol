import { getChainId } from '../../../common/blockchain-utils'
import { task } from 'hardhat/config'
import { CTokenFiatCollateral, CTokenMock, ERC20Mock } from '../../../typechain'

task('deploy-ctoken-fiat-collateral', 'Deploys a CToken Fiat Collateral')
  .addParam('priceFeed', 'Price Feed address')
  .addParam('cToken', 'CToken address')
  .addParam('rewardToken', 'Reward token address')
  .addParam('tradingValMin', 'Trade Range - Min in UoA')
  .addParam('tradingValMax', 'Trade Range - Max in UoA')
  .addParam('tradingAmtMin', 'Trade Range - Min in whole toks')
  .addParam('tradingAmtMax', 'Trade Range - Max in whole toks')
  .addParam('oracleTimeout', 'Max oracle timeout')
  .addParam('targetName', 'Target Name')
  .addParam('defaultThreshold', 'Default Threshold')
  .addParam('delayUntilDefault', 'Delay until default')
  .addParam('comptroller', 'Comptroller address')
  .addParam('oracleLib', 'Oracle library address')
  .setAction(async (params, hre) => {
    const [deployer] = await hre.ethers.getSigners()

    const chainId = await getChainId(hre)

    // Get CToken to retrieve underlying
    const cToken: CTokenMock = <CTokenMock>(
      await hre.ethers.getContractAt('CTokenMock', params.cToken)
    )

    // Get Underlying
    const erc20: ERC20Mock = <ERC20Mock>(
      await hre.ethers.getContractAt('ERC20Mock', await cToken.underlying())
    )

    const CTokenCollateralFactory = await hre.ethers.getContractFactory('CTokenFiatCollateral', {
      libraries: { OracleLib: params.oracleLib },
    })

    const collateral = <CTokenFiatCollateral>await CTokenCollateralFactory.connect(deployer).deploy(
      params.priceFeed,
      params.cToken,
      params.rewardToken,
      {
        minVal: params.tradingValMin,
        maxVal: params.tradingValMax,
        minAmt: params.tradingAmtMin,
        maxAmt: params.tradingAmtMax,
      },
      params.oracleTimeout,
      params.targetName,
      params.defaultThreshold,
      params.delayUntilDefault,
      await erc20.decimals(), // Reference ERC20 decimals
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
