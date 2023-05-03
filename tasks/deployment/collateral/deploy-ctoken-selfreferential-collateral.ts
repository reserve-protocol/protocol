import { getChainId } from '../../../common/blockchain-utils'
import { task } from 'hardhat/config'
import { CTokenSelfReferentialCollateral } from '../../../typechain'

task('deploy-ctoken-selfreferential-collateral', 'Deploys a CToken Self-referential Collateral')
  .addParam('priceTimeout', 'The amount of time before a price decays to 0')
  .addParam('priceFeed', 'Price Feed address')
  .addParam('oracleError', 'The % error in the price feed as a fix')
  .addParam('cToken', 'CToken address')
  .addParam('maxTradeVolume', 'Max Trade Volume (in UoA)')
  .addParam('oracleTimeout', 'Max oracle timeout')
  .addParam('targetName', 'Target Name')
  .addParam('revenueHiding', 'Revenue Hiding')
  .addParam('referenceERC20Decimals', 'Decimals in the reference token')
  .setAction(async (params, hre) => {
    const [deployer] = await hre.ethers.getSigners()

    const chainId = await getChainId(hre)

    const CTokenSelfReferentialCollateralFactory = await hre.ethers.getContractFactory(
      'CTokenSelfReferentialCollateral'
    )

    const collateral = <CTokenSelfReferentialCollateral>(
      await CTokenSelfReferentialCollateralFactory.connect(deployer).deploy(
        {
          priceTimeout: params.priceTimeout,
          chainlinkFeed: params.priceFeed,
          oracleError: params.oracleError,
          erc20: params.cToken,
          maxTradeVolume: params.maxTradeVolume,
          oracleTimeout: params.oracleTimeout,
          targetName: params.targetName,
          defaultThreshold: 0,
          delayUntilDefault: 0,
        },
        params.revenueHiding,
        params.referenceERC20Decimals
      )
    )
    await collateral.deployed()

    if (!params.noOutput) {
      console.log(
        `Deployed CToken Self-referential Collateral to ${hre.network.name} (${chainId}): ${collateral.address}`
      )
    }
    return { collateral: collateral.address }
  })
