import { getChainId } from '../../../common/blockchain-utils'
import { task } from 'hardhat/config'
import { Collateral } from '../../../typechain'

task('deploy-aave-collateral', 'Deploys an Aave Priced Collateral')
  .addParam('tokenAddress', 'ERC20 token address')
  .addParam('maxTradeVolume', 'Max trade volume')
  .addParam('defaultThreshold', 'Default Threshold')
  .addParam('delayUntilDefault', 'Delay until default')
  .addParam('comptroller', 'Comptroller address')
  .addParam('aaveLendingPool', 'Aave Lending Pool address')
  .setAction(async (params, hre) => {
    const [deployer] = await hre.ethers.getSigners()

    const chainId = await getChainId(hre)

    const aaveCollateral = <Collateral>(
      await (await hre.ethers.getContractFactory('AavePricedFiatCollateral'))
        .connect(deployer)
        .deploy(
          params.tokenAddress,
          params.maxTradeVolume,
          params.defaultThreshold,
          params.delayUntilDefault,
          params.comptroller,
          params.aaveLendingPool
        )
    )
    await aaveCollateral.deployed()

    console.log(
      `Deployed Aave Collateral to ${hre.network.name} (${chainId}): ${aaveCollateral.address}`
    )

    return { aaveCollateral: aaveCollateral.address }
  })
