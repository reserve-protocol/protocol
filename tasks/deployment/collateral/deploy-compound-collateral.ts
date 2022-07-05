import { getChainId } from '../../../common/blockchain-utils'
import { task } from 'hardhat/config'
import { Collateral } from '../../../typechain'

task('deploy-compound-collateral', 'Deploys a Compound Priced Collateral')
  .addParam('tokenAddress', 'ERC20 token address')
  .addParam('maxTradeVolume', 'Max trade volume')
  .addParam('defaultThreshold', 'Default Threshold')
  .addParam('delayUntilDefault', 'Delay until default')
  .addParam('comptroller', 'Comptroller address')
  .setAction(async (params, hre) => {
    const [deployer] = await hre.ethers.getSigners()

    const chainId = await getChainId(hre)

    const compoundCollateral = <Collateral>(
      await (await hre.ethers.getContractFactory('CompoundPricedFiatCollateral'))
        .connect(deployer)
        .deploy(
          params.tokenAddress,
          params.maxTradeVolume,
          params.defaultThreshold,
          params.delayUntilDefault,
          params.comptroller
        )
    )
    await compoundCollateral.deployed()

    console.log(
      `Deployed Compound Collateral to ${hre.network.name} (${chainId}): ${compoundCollateral.address}`
    )

    return { compoundCollateral: compoundCollateral.address }
  })
