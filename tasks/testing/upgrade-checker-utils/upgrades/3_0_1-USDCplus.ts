import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { expect } from 'chai'
import { ProposalBuilder, buildProposal, proposeUpgrade } from '../governance'
import { Proposal } from '#/utils/subgraph'
import { networkConfig } from '#/common/configuration'
import { bn, fp, toBNDecimals } from '#/common/numbers'
import { CollateralStatus, TradeKind, ZERO_ADDRESS } from '#/common/constants'
import { pushOraclesForward, setOraclePrice } from '../oracles'
import { whileImpersonating } from '#/utils/impersonation'
import { whales } from '../constants'
import { getTokens, runDutchTrade } from '../trades'
import { EURFiatCollateral, MockV3Aggregator } from '../../../../typechain'
import {
  advanceTime,
  advanceToTimestamp,
  getLatestBlockTimestamp,
  setNextBlockTimestamp,
} from '#/utils/time'
import { useEnv } from '#/utils/env'
import { resetFork } from '#/utils/chain'

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

  // Step 1 - Update implementations
  const txs = [
    await backingManager.populateTransaction.upgradeTo(bckMgrImplAddr),
    await rsrTrader.populateTransaction.upgradeTo(rsrTraderImplAddr),
    await rTokenTrader.populateTransaction.upgradeTo(rTokenTraderImplAddr),
    await broker.populateTransaction.setBatchTradeImplementation(batchTradeImplAddr),
    await assetRegistry.populateTransaction.register(fUSDC),
  ]

  // Step 2 - Basket change
  txs.push(
    await basketHandler.populateTransaction.setPrimeBasket(
        ['0x7e1e077b289c0153b5ceAD9F264d66215341c9Ab', '0x465a5a630482f3abD6d3b84B39B29b07214d19e5', '0x7f7B77e49d5b30445f222764a794AFE14af062eB'],
        [bn('333329999999999960'), bn('333329999999999960'), bn('333340000000000025')]
      ),
    await basketHandler.populateTransaction.refreshBasket()
  )

  const description =
    'Upgrade to 3.0.1, update basket to use fUSDC instead of fUSDC-Vault'

  return buildProposal(txs, description)
}

task('upgrade-usdc-plus', 'Mints all the tokens to an address')
  .addParam('rtoken', 'the address of the RToken being upgraded')
  .setAction(async (params, hre) => {
    await resetFork(hre, Number(useEnv('FORK_BLOCK')))
    const [tester] = await hre.ethers.getSigners()

    await proposeUpgrade(hre, params.rtoken, params.governor, proposal_3_0_1)
    console.log('proposal submitted')
})