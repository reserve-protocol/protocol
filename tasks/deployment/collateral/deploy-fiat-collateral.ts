import { getChainId } from '../../../common/blockchain-utils'
import { task } from 'hardhat/config'
import { ContractFactory } from 'ethers'
import { FiatCollateral } from '../../../typechain'

task('deploy-fiat-collateral', 'Deploys a Fiat Collateral')
  .addParam('priceTimeout', 'The amount of time before a price decays to 0')
  .addParam('priceFeed', 'Price Feed address')
  .addParam('oracleError', 'The % error in the price feed as a fix')
  .addParam('tokenAddress', 'ERC20 token address')
  .addParam('maxTradeVolume', 'Max Trade Volume (in UoA)')
  .addParam('oracleTimeout', 'Max oracle timeout')
  .addParam('targetName', 'Target Name')
  .addParam('defaultThreshold', 'Default Threshold')
  .addParam('delayUntilDefault', 'Delay until default')
  .setAction(async (params, hre) => {
    const [deployer] = await hre.ethers.getSigners()

    const chainId = await getChainId(hre)

    const FiatCollateralFactory: ContractFactory = await hre.ethers.getContractFactory(
      'FiatCollateral'
    )

    const collateral = <FiatCollateral>await FiatCollateralFactory.connect(deployer).deploy({
      priceTimeout: params.priceTimeout,
      chainlinkFeed: params.priceFeed,
      oracleError: params.oracleError,
      erc20: params.tokenAddress,
      maxTradeVolume: params.maxTradeVolume,
      oracleTimeout: params.oracleTimeout,
      targetName: params.targetName,
      defaultThreshold: params.defaultThreshold,
      delayUntilDefault: params.delayUntilDefault,
    })
    await collateral.deployed()

    if (!params.noOutput) {
      console.log(
        `Deployed Fiat Collateral to ${hre.network.name} (${chainId}): ${collateral.address}`
      )
    }

    return { collateral: collateral.address }
  })
