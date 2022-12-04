import { getChainId } from '../../../common/blockchain-utils'
import { task } from 'hardhat/config'
import { WstETHCollateral } from '../../../typechain'

task('deploy-wsteth-collateral', 'Deploys a wstETH Collateral')
  .addParam('fallbackPrice', 'A fallback price (in UoA)')
  .addParam('ethPriceFeed', 'ETH Price Feed address')
  .addParam('stethPriceFeed', 'StETH Price Feed address')
  .addParam('wsteth', 'wstETH address')
  .addParam('maxTradeVolume', 'Max Trade Volume (in UoA)')
  .addParam('oracleTimeout', 'Max oracle timeout')
  .addParam('targetName', 'Target Name')
  .addParam('defaultThreshold', 'Default Threshold')
  .addParam('delayUntilDefault', 'Delay until default')
  .setAction(async (params, hre) => {
    const [deployer] = await hre.ethers.getSigners()

    const chainId = await getChainId(hre)

    const WstETHCollateralFactory = await hre.ethers.getContractFactory('WstETHCollateral')

    const collateral = <WstETHCollateral>(
      await WstETHCollateralFactory.connect(deployer).deploy(
        params.fallbackPrice,
        params.ethPriceFeed,
        params.stethPriceFeed,
        params.wsteth,
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
        `Deployed wstETH Collateral to ${hre.network.name} (${chainId}): ${collateral.address}`
      )
    }
    return { collateral: collateral.address }
  })
