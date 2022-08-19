import { getChainId } from '../../../common/blockchain-utils'
import { task } from 'hardhat/config'
import { ContractFactory } from 'ethers'
import { Collateral } from '../../../typechain'

task('deploy-fiat-collateral', 'Deploys a Fiat Collateral')
  .addParam('priceFeed', 'Price Feed address')
  .addParam('tokenAddress', 'ERC20 token address')
  .addParam('rewardToken', 'Reward token address')
  .addParam('tradingValMin', 'Trade Range - Min in UoA')
  .addParam('tradingValMax', 'Trade Range - Max in UoA')
  .addParam('tradingAmtMin', 'Trade Range - Min in whole toks')
  .addParam('tradingAmtMax', 'Trade Range - Max in whole toks')
  .addParam('maxOracleTimeout', 'Max oracle timeout')
  .addParam('targetName', 'Target Name')
  .addParam('defaultThreshold', 'Default Threshold')
  .addParam('delayUntilDefault', 'Delay until default')
  .addParam('oracleLibrary', 'Oracle library address')
  .setAction(async (params, hre) => {
    const [deployer] = await hre.ethers.getSigners()

    const chainId = await getChainId(hre)

    const FiatCollateralFactory: ContractFactory = await hre.ethers.getContractFactory(
      'FiatCollateral',
      {
        libraries: { OracleLib: params.oracleLibrary },
      }
    )

    const collateral = <Collateral>await FiatCollateralFactory.connect(deployer).deploy(
      params.priceFeed,
      params.tokenAddress,
      params.rewardToken,
      {
        minVal: params.tradingValMin,
        maxVal: params.tradingValMax,
        minAmt: params.tradingAmtMin,
        maxAmt: params.tradingAmtMax,
      },
      params.maxOracleTimeout,
      params.targetName,
      params.defaultThreshold,
      params.delayUntilDefault
    )
    await collateral.deployed()

    if (!params.noOutput) {
      console.log(
        `Deployed Fiat Collateral to ${hre.network.name} (${chainId}): ${collateral.address}`
      )
    }

    return { collateral: collateral.address }
  })
