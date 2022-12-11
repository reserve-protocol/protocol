import { getChainId } from '../../../common/blockchain-utils'
import { task } from 'hardhat/config'
import { ContractFactory } from 'ethers'
import { Collateral } from '../../../typechain'

task('deploy-gohm-collateral', 'Deploys gOHM Collateral')
  .addParam('fallbackPrice', 'A fallback price (in UoA)')
  .addParam('ohmEthPriceFeed', 'ETH/OHM Price Feed address')
  .addParam('ethUsdPriceFeed', 'ETH/USD Price Feed address')
  .addParam('tokenAddress', 'ERC20 token address')
  .addParam('maxTradeVolume', 'Max Trade Volume (in UoA)')
  .addParam('oracleTimeout', 'Max oracle timeout')
  .addParam('targetName', 'Target Name')
  .addParam('delayUntilDefault', 'Seconds until default')
  .addParam('decimals', 'Reference token decimals')
  .setAction(async (params, hre) => {
    const [deployer] = await hre.ethers.getSigners()

    const chainId = await getChainId(hre)

    const GOhmCollateralFactory: ContractFactory = await hre.ethers.getContractFactory(
      'GOhmCollateral'
    )

    const collateral = <Collateral>(
      await GOhmCollateralFactory.connect(deployer).deploy(
        params.fallbackPrice,
        params.ohmEthPriceFeed,
        params.ethUsdPriceFeed,
        params.tokenAddress,
        params.maxTradeVolume,
        params.oracleTimeout,
        params.targetName,
        params.delayUntilDefault,
        params.decimals
      )
    )
    await collateral.deployed()

    if (!params.noOutput) {
      console.log(
        `Deployed gOHM Collateral to ${hre.network.name} (${chainId}): ${collateral.address}`
      )
    }
    return { collateral: collateral.address }
  })
