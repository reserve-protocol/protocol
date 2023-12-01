import { bn } from '#/common/numbers'
import { Proposal } from '#/utils/subgraph'
import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { ProposalBuilder, buildProposal, proposeUpgrade } from '../governance'

export const proposal_3_0_1: ProposalBuilder = async (
  hre: HardhatRuntimeEnvironment,
  rTokenAddress: string,
  governorAddress: string
): Promise<Proposal> => {
  const rToken = await hre.ethers.getContractAt('RTokenP1', rTokenAddress)
  const main = await hre.ethers.getContractAt('MainP1', await rToken.main())
  const assetRegistry = await hre.ethers.getContractAt(
    'AssetRegistryP1',
    await main.assetRegistry()
  )
  const backingManager = await hre.ethers.getContractAt(
    'BackingManagerP1',
    await main.backingManager()
  )
  const basketHandler = await hre.ethers.getContractAt(
    'BasketHandlerP1',
    await main.basketHandler()
  )
  const broker = await hre.ethers.getContractAt('BrokerP1', await main.broker())
  const rsrTrader = await hre.ethers.getContractAt('RevenueTraderP1', await main.rsrTrader())
  const rTokenTrader = await hre.ethers.getContractAt('RevenueTraderP1', await main.rTokenTrader())

  const batchTradeImplAddr = '0x4e9B97957a0d1F4c25E42Ccc69E4d2665433FEA3'
  const bckMgrImplAddr = '0xBbC532A80DD141449330c1232C953Da6801Aed01'
  const rsrTraderImplAddr = '0x5e3e13d3d2a0adfe16f8EF5E7a2992A88E9e65AF'
  const rTokenTraderImplAddr = '0x5e3e13d3d2a0adfe16f8EF5E7a2992A88E9e65AF'
  const fUSDC = '0x3C0a9143063Fc306F7D3cBB923ff4879d70Cf1EA'
  const cusdcv3 = '0x7Dee4DbeF75f93cCA06823Ac915Df990be3F1538'
  

  // Step 1 - Update implementations
  const txs = [
    await backingManager.populateTransaction.upgradeTo(bckMgrImplAddr),
    await rsrTrader.populateTransaction.upgradeTo(rsrTraderImplAddr),
    await rTokenTrader.populateTransaction.upgradeTo(rTokenTraderImplAddr),
    await broker.populateTransaction.setBatchTradeImplementation(batchTradeImplAddr),
    await assetRegistry.populateTransaction.register(fUSDC),
    await assetRegistry.populateTransaction.register(cusdcv3),
  ]

  // Step 2 - Basket change
  txs.push(
    await basketHandler.populateTransaction.setPrimeBasket(
      [
        '0x093c07787920eB34A0A0c7a09823510725Aee4Af',
        '0x465a5a630482f3abD6d3b84B39B29b07214d19e5',
        '0x7f7B77e49d5b30445f222764a794AFE14af062eB',
      ],
      [bn('333329999999999960'), bn('333329999999999960'), bn('333340000000000025')]
    ),
    await basketHandler.populateTransaction.refreshBasket()
  )

  const description = 'Upgrade to 3.0.1, update basket to use fUSDC instead of fUSDC-Vault'

  return buildProposal(txs, description)
}

task('upgrade-usdc-plus', 'Mints all the tokens to an address')
  .addParam('rtoken', 'the address of the RToken being upgraded')
  .setAction(async (params, hre) => {
    // await resetFork(hre, Number(useEnv('FORK_BLOCK')))
    const [tester] = await hre.ethers.getSigners()
    console.log(tester.address)
    
    await proposeUpgrade(hre, params.rtoken, "0xc837C557071D604bCb1058c8c4891ddBe8FDD630", proposal_3_0_1)
    console.log('proposal submitted')
  })
