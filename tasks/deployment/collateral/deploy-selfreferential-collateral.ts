import { getChainId } from '../../../common/blockchain-utils'
import { task } from 'hardhat/config'
import { ContractFactory } from 'ethers'
import { Collateral } from '../../../typechain'

task('deploy-selfreferential-collateral', 'Deploys a Self-referential Collateral')
  .addParam('fallbackPrice', 'A fallback price (in UoA)')
  .addParam('priceFeed', 'Price Feed address')
  .addParam('tokenAddress', 'ERC20 token address')
  .addParam('maxTradeVolume', 'Max Trade Volume (in UoA)')
  .addParam('oracleTimeout', 'Max oracle timeout')
  .addParam('targetName', 'Target Name')
  .addParam('delayUntilDefault', 'Seconds until default')
  .addParam('oracleLib', 'Oracle library address')
  .setAction(async (params, hre) => {
    const [deployer] = await hre.ethers.getSigners()

    const chainId = await getChainId(hre)

    const SelfReferentialCollateralFactory: ContractFactory = await hre.ethers.getContractFactory(
      'SelfReferentialCollateral'
    )

    const collateral = <Collateral>(
      await SelfReferentialCollateralFactory.connect(deployer).deploy(
        params.fallbackPrice,
        params.priceFeed,
        params.tokenAddress,
        params.maxTradeVolume,
        params.oracleTimeout,
        params.targetName,
        params.delayUntilDefault
      )
    )
    await collateral.deployed()

    if (!params.noOutput) {
      console.log(
        `Deployed Self Referential Collateral to ${hre.network.name} (${chainId}): ${collateral.address}`
      )
    }
    return { collateral: collateral.address }
  })
