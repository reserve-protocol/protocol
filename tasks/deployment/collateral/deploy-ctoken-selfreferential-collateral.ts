import { getChainId } from '../../../common/blockchain-utils'
import { task } from 'hardhat/config'
import { CTokenSelfReferentialCollateral, CTokenMock, ERC20Mock } from '../../../typechain'

task('deploy-ctoken-selfreferential-collateral', 'Deploys a CToken Self-referential Collateral')
  .addParam('priceFeed', 'Price Feed address')
  .addParam('cToken', 'CToken address')
  .addParam('rewardToken', 'Reward token address')
  .addParam('tradingValMin', 'Trade Range - Min in UoA')
  .addParam('tradingValMax', 'Trade Range - Max in UoA')
  .addParam('tradingAmtMin', 'Trade Range - Min in whole toks')
  .addParam('tradingAmtMax', 'Trade Range - Max in whole toks')
  .addParam('oracleTimeout', 'Max oracle timeout')
  .addParam('targetName', 'Target Name')
  .addParam('decimals', 'Reference token decimals')
  .addParam('comptroller', 'Comptroller address')
  .addParam('oracleLib', 'Oracle library address')
  .setAction(async (params, hre) => {
    const [deployer] = await hre.ethers.getSigners()

    const chainId = await getChainId(hre)

    const CTokenSelfReferentialCollateralFactory = await hre.ethers.getContractFactory(
      'CTokenSelfReferentialCollateral',
      {
        libraries: { OracleLib: params.oracleLib },
      }
    )

    const collateral = <CTokenSelfReferentialCollateral>(
      await CTokenSelfReferentialCollateralFactory.connect(deployer).deploy(
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
        params.decimals,
        params.comptroller
      )
    )
    await collateral.deployed()

    if (!params.noOutput) {
      console.log(
        `Deployed CToken Self-referential Collateral to ${hre.network.name} (${chainId}): ${collateral.address}`
      )
    }
    return { collateral: collateral.address }
  })
