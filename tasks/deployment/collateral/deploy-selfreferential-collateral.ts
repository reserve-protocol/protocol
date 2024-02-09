import { getChainId } from '../../../common/blockchain-utils'
import { task } from 'hardhat/config'
import { ContractFactory } from 'ethers'
import { SelfReferentialCollateral } from '../../../typechain'

task('deploy-selfreferential-collateral', 'Deploys a Self-referential Collateral')
  .addParam('priceTimeout', 'The amount of time before a price decays to 0')
  .addParam('priceFeed', 'Price Feed address')
  .addParam('oracleError', 'The % error in the price feed as a fix')
  .addParam('tokenAddress', 'ERC20 token address')
  .addParam('maxTradeVolume', 'Max Trade Volume (in UoA)')
  .addParam('oracleTimeout', 'Max oracle timeout')
  .addParam('targetName', 'Target Name')
  .setAction(async (params, hre) => {
    const [deployer] = await hre.ethers.getSigners()

    const chainId = await getChainId(hre)

    const CollateralFactory: ContractFactory = await hre.ethers.getContractFactory(
      'SelfReferentialCollateral'
    )

    const collateral = <SelfReferentialCollateral>await CollateralFactory.connect(deployer).deploy({
      priceTimeout: params.priceTimeout,
      chainlinkFeed: params.priceFeed,
      oracleError: params.oracleError,
      erc20: params.tokenAddress,
      maxTradeVolume: params.maxTradeVolume,
      oracleTimeout: params.oracleTimeout,
      targetName: params.targetName,
      defaultThreshold: 0,
      delayUntilDefault: 0,
    })
    await collateral.deployed()

    if (!params.noOutput) {
      console.log(
        `Deployed Self Referential Collateral to ${hre.network.name} (${chainId}): ${collateral.address}`
      )
    }
    return { collateral: collateral.address }
  })
