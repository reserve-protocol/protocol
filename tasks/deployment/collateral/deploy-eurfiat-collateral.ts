import { getChainId } from '../../../common/blockchain-utils'
import { task } from 'hardhat/config'
import { ContractFactory } from 'ethers'
import { EURFiatCollateral } from '../../../typechain'

task('deploy-eurfiat-collateral', 'Deploys an EUR fiat Collateral')
  .addParam('priceTimeout', 'The amount of time before a price decays to 0')
  .addParam('referenceUnitFeed', 'Reference Price Feed address')
  .addParam('targetUnitFeed', 'Target Unit Price Feed address')
  .addParam('oracleError', 'The oracle error in the reference unit feed')
  .addParam('tokenAddress', 'ERC20 token address')
  .addParam('maxTradeVolume', 'Max Trade Volume (in UoA)')
  .addParam('oracleTimeout', 'Max oracle timeout to use for the reference feed')
  .addParam('targetUnitOracleTimeout', 'Max oracle timeout for the target unit feed')
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
        priceTimeout: params.priceTimeout,
        chainlinkFeed: params.referenceUnitFeed,
        oracleError: params.oracleError,
        erc20: params.tokenAddress,
        maxTradeVolume: params.maxTradeVolume,
        oracleTimeout: params.oracleTimeout,
        targetName: params.targetName,
        defaultThreshold: params.defaultThreshold,
        delayUntilDefault: params.delayUntilDefault,
      },
      params.targetUnitFeed,
      params.targetUnitOracleTimeout
    )
    await collateral.deployed()

    if (!params.noOutput) {
      console.log(
        `Deployed EUR Fiat Collateral to ${hre.network.name} (${chainId}): ${collateral.address}`
      )
    }
    return { collateral: collateral.address }
  })
