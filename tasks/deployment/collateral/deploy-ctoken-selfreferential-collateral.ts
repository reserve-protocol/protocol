import { getChainId } from '../../../common/blockchain-utils'
import { task } from 'hardhat/config'
import { CTokenSelfReferentialCollateral } from '../../../typechain'

task('deploy-ctoken-selfreferential-collateral', 'Deploys a CToken Self-referential Collateral')
  .addParam('fallbackPrice', 'A fallback price (in UoA)')
  .addParam('priceFeed', 'Price Feed address')
  .addParam('oracleError', 'The % error in the price feed as a fix')
  .addParam('cToken', 'CToken address')
  .addParam('maxTradeVolume', 'Max Trade Volume (in UoA)')
  .addParam('oracleTimeout', 'Max oracle timeout')
  .addParam('targetName', 'Target Name')
  .addParam('comptroller', 'Comptroller address')
  .setAction(async (params, hre) => {
    const [deployer] = await hre.ethers.getSigners()

    const chainId = await getChainId(hre)

    const CTokenSelfReferentialCollateralFactory = await hre.ethers.getContractFactory(
      'CTokenSelfReferentialCollateral'
    )

    const collateral = <CTokenSelfReferentialCollateral>(
      await CTokenSelfReferentialCollateralFactory.connect(deployer).deploy(
        {
          fallbackPrice: params.fallbackPrice,
          chainlinkFeed: params.priceFeed,
          oracleError: params.oracleError,
          erc20: params.cToken,
          maxTradeVolume: params.maxTradeVolume,
          oracleTimeout: params.oracleTimeout,
          targetName: params.targetName,
          defaultThreshold: 0,
          delayUntilDefault: 0,
        },
        18,
        params.comptroller
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
