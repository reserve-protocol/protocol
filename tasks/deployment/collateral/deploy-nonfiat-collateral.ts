import { getChainId } from '../../../common/blockchain-utils'
import { task } from 'hardhat/config'
import { ContractFactory } from 'ethers'
import { Collateral } from '../../../typechain'

task('deploy-nonfiat-collateral', 'Deploys a non-fiat Collateral')
  .addParam('fallbackPrice', 'A fallback price (in UoA)')
  .addParam('referenceUnitFeed', 'Reference Price Feed address')
  .addParam('targetUnitFeed', 'Target Unit Price Feed address')
  .addParam('tokenAddress', 'ERC20 token address')
  .addParam('maxTradeVolume', 'Max Trade Volume (in UoA)')
  .addParam('oracleTimeout', 'Max oracle timeout')
  .addParam('targetName', 'Target Name')
  .addParam('defaultThreshold', 'Default Threshold')
  .addParam('delayUntilDefault', 'Delay until default')
  .addParam('oracleLib', 'Oracle library address')
  .setAction(async (params, hre) => {
    const [deployer] = await hre.ethers.getSigners()

    const chainId = await getChainId(hre)

    const NonFiatCollateralFactory: ContractFactory = await hre.ethers.getContractFactory(
      'NonFiatCollateral',
      {
        libraries: { OracleLib: params.oracleLib },
      }
    )

    const collateral = <Collateral>(
      await NonFiatCollateralFactory.connect(deployer).deploy(
        params.fallbackPrice,
        params.referenceUnitFeed,
        params.targetUnitFeed,
        params.tokenAddress,
        params.maxTradeVolume,
        params.oracleTimeout,
        params.targetName,
        params.defaultThreshold,
        params.delayUntilDefault
      )
    )
    await collateral.deployed()

    if (!params.noOutput) {
      console.log(
        `Deployed Non-Fiat Collateral to ${hre.network.name} (${chainId}): ${collateral.address}`
      )
    }

    return { collateral: collateral.address }
  })
