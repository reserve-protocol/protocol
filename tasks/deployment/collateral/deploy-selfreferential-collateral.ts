import { getChainId } from '../../../common/blockchain-utils'
import { task } from 'hardhat/config'
import { ContractFactory } from 'ethers'
import { Collateral } from '../../../typechain'

task('deploy-selfreferential-collateral', 'Deploys a Self-referential Collateral')
  .addParam('priceFeed', 'Price Feed address')
  .addParam('tokenAddress', 'ERC20 token address')
  .addParam('rewardToken', 'Reward token address')
  .addParam('tradingMin', 'Trade Range - Min')
  .addParam('tradingMax', 'Trade Range - Max')
  .addParam('maxOracleTimeout', 'Max oracle timeout')
  .addParam('targetName', 'Target Name')
  .addParam('oracleLibrary', 'Oracle library address')
  .setAction(async (params, hre) => {
    const [deployer] = await hre.ethers.getSigners()

    const chainId = await getChainId(hre)

    const SelfReferentialCollateralFactory: ContractFactory = await hre.ethers.getContractFactory(
      'SelfReferentialCollateral',
      {
        libraries: { OracleLib: params.oracleLibrary },
      }
    )

    const collateral = <Collateral>(
      await SelfReferentialCollateralFactory.connect(deployer).deploy(
        params.priceFeed,
        params.tokenAddress,
        params.rewardToken,
        { min: params.tradingMin, max: params.tradingMax },
        params.maxOracleTimeout,
        params.targetName
      )
    )
    await collateral.deployed()

    console.log(
      `Deployed Self Referential Collateral to ${hre.network.name} (${chainId}): ${collateral.address}`
    )

    return { collateral: collateral.address }
  })
