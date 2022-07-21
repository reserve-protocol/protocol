import { getChainId } from '../../../common/blockchain-utils'
import { task } from 'hardhat/config'
import { ContractFactory } from 'ethers'
import { Collateral } from '../../../typechain'

task('deploy-eurfiat-collateral', 'Deploys an EURO fiat Collateral')
  .addParam('referenceUnitFeed', 'Reference Price Feed address')
  .addParam('targetUnitFeed', 'Target Unit Price Feed address')
  .addParam('tokenAddress', 'ERC20 token address')
  .addParam('rewardToken', 'Reward token address')
  .addParam('maxTradeVolume', 'Max trade volume')
  .addParam('maxOracleTimeout', 'Max oracle timeout')
  .addParam('targetName', 'Target Name')
  .addParam('defaultThreshold', 'Default Threshold')
  .addParam('delayUntilDefault', 'Delay until default')
  .addParam('oracleLibrary', 'Oracle library address')
  .setAction(async (params, hre) => {
    const [deployer] = await hre.ethers.getSigners()

    const chainId = await getChainId(hre)

    const EURFiatCollateralFactory: ContractFactory = await hre.ethers.getContractFactory(
      'EURFiatCollateral',
      {
        libraries: { OracleLib: params.oracleLibrary },
      }
    )

    const collateral = <Collateral>(
      await EURFiatCollateralFactory.connect(deployer).deploy(
        params.referenceUnitFeed,
        params.targetUnitFeed,
        params.tokenAddress,
        params.rewardToken,
        params.maxTradeVolume,
        params.maxOracleTimeout,
        params.targetName,
        params.defaultThreshold,
        params.delayUntilDefault
      )
    )
    await collateral.deployed()

    console.log(
      `Deployed EURO Fiat Collateral to ${hre.network.name} (${chainId}): ${collateral.address}`
    )

    return { collateral: collateral.address }
  })
