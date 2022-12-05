import { getChainId } from '../../../common/blockchain-utils'
import { task } from 'hardhat/config'
import { ContractFactory } from 'ethers'
import { EURFiatCollateral } from '../../../typechain'

task('deploy-eurfiat-collateral', 'Deploys an EURO fiat Collateral')
  .addParam('lotPrice', 'A lot price (in UoA)')
  .addParam('referenceUnitFeed', 'Reference Price Feed address')
  .addParam('targetUnitFeed', 'Target Unit Price Feed address')
  .addParam('combinedOracleError', 'The combined % error from both oracle sources')
  .addParam('tokenAddress', 'ERC20 token address')
  .addParam('maxTradeVolume', 'Max Trade Volume (in UoA)')
  .addParam('oracleTimeout', 'Max oracle timeout')
  .addParam('targetName', 'Target Name')
  .addParam('defaultThreshold', 'Default Threshold')
  .addParam('delayUntilDefault', 'Delay until default')
  .setAction(async (params, hre) => {
    const [deployer] = await hre.ethers.getSigners()

    const chainId = await getChainId(hre)

    const EURFiatCollateralFactory: ContractFactory = await hre.ethers.getContractFactory(
      'EURFiatCollateral'
    )

    const collateral = <EURFiatCollateral>await EURFiatCollateralFactory.connect(deployer).deploy(
      {
        lotPrice: params.lotPrice,
        chainlinkFeed: params.referenceUnitFeed,
        oracleError: params.combinedOracleError,
        erc20: params.tokenAddress,
        maxTradeVolume: params.maxTradeVolume,
        oracleTimeout: params.oracleTimeout,
        targetName: params.targetName,
        defaultThreshold: params.defaultThreshold,
        delayUntilDefault: params.delayUntilDefault,
      },
      params.targetUnitFeed
    )
    await collateral.deployed()

    if (!params.noOutput) {
      console.log(
        `Deployed EURO Fiat Collateral to ${hre.network.name} (${chainId}): ${collateral.address}`
      )
    }
    return { collateral: collateral.address }
  })
