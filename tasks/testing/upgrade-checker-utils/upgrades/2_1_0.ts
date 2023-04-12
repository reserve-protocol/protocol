import { whileImpersonating } from "#/utils/impersonation"
import { HardhatRuntimeEnvironment } from "hardhat/types"
import { ProposalBuilder, buildProposal } from "../governance"
import { Proposal } from "#/utils/subgraph"
import { overrideOracle, pushOracleForward, pushOraclesForward } from "../oracles"
import { networkConfig } from "#/common/configuration"
import { recollateralize } from "../rtokens"
import { bn, fp } from "#/common/numbers"
import { advanceBlocks, advanceTime, getLatestBlockTimestamp } from "#/utils/time"
import { LogDescription, Interface } from "ethers/lib/utils"
import { logToken } from "../logs"
import { runTrade } from "../trades"
import { CollateralStatus, QUEUE_START } from "#/common/constants"
import { getTrade } from "#/utils/trades"
import { whales } from "../constants"
import { BigNumber } from "ethers"

export default async (hre: HardhatRuntimeEnvironment, rTokenAddress: string, governorAddress: string) => {
  console.log('\n* * * * * Run checks for release 2.1.0...')
  const rToken = await hre.ethers.getContractAt('RTokenP1', rTokenAddress)
  const main = await hre.ethers.getContractAt('IMain', await rToken.main())
  const governor = await hre.ethers.getContractAt('Governance', governorAddress)
  const timelock = await hre.ethers.getContractAt('TimelockController', await governor.timelock())
  const stRSR = await hre.ethers.getContractAt('StRSRP1Votes', await main.stRSR())
  const basketHandler = await hre.ethers.getContractAt('BasketHandlerP1', await main.basketHandler())

  // check Broker updates
  const broker = await hre.ethers.getContractAt('BrokerP1', await main.broker())
  const preGnosis = await broker.gnosis()
  const preTrade = await broker.tradeImplementation()

  const gnosisFactory = await hre.ethers.getContractFactory('EasyAuction')
  const newGnosis = await gnosisFactory.deploy()
  const tradeFactory = await hre.ethers.getContractFactory('GnosisTrade')
  const newTrade = await tradeFactory.deploy()

  await whileImpersonating(hre, timelock.address, async (govSigner) => {
    await broker.connect(govSigner).setGnosis(newGnosis.address)
    await broker.connect(govSigner).setTradeImplementation(newTrade.address)
  })

  const postGnosis = await broker.gnosis()
  const postTrade = await broker.tradeImplementation()

  if (postGnosis != newGnosis.address) {
    throw new Error(`setGnosis() failure: received: ${postGnosis} / expected: ${newGnosis.address}`)
  }

  if (postTrade != newTrade.address) {
    throw new Error(`setTradeImplementation() failure: received: ${postTrade} / expected: ${newTrade.address}`)
  }

  await whileImpersonating(hre, timelock.address, async (govSigner) => {
    await broker.connect(govSigner).setGnosis(preGnosis)
    await broker.connect(govSigner).setTradeImplementation(preTrade)
  })

  // check stRSR updates
  // if these calls succeed, then the functions exist
  await stRSR.getDraftRSR()
  await stRSR.getStakeRSR()
  await stRSR.getTotalDrafts()

  /*
    Verify broker disable bug is gone
  */
  await whileImpersonating(hre, timelock.address, async (govSigner) => {
    await basketHandler
      .connect(govSigner)
      .setBackupConfig(hre.ethers.utils.formatBytes32String('USD'), bn(1), [networkConfig['1'].tokens.USDT!])
  })

  const ar = await hre.ethers.getContractAt('AssetRegistryP1', await main.assetRegistry())
  const backingManager = await hre.ethers.getContractAt('BackingManagerP1', await main.backingManager())
  const usdcCollat = await ar.toColl(networkConfig['1'].tokens.USDC!)
  const usdc = await hre.ethers.getContractAt('FiatCollateral', usdcCollat)
  const oracle = await overrideOracle(hre, await usdc.chainlinkFeed())
  const lastPrice = await oracle.latestAnswer()
  await oracle.updateAnswer(lastPrice.mul(90).div(100))
  await ar.refresh()

  // default
  await advanceTime(hre, 60*60*25)
  await advanceBlocks(hre, 5*60*25)

  // push other oracles forward
  console.log(`\nPushing some oracles forward for RToken ${rTokenAddress}...`)
  const registry = await ar.getRegistry()
  for (const asset of registry.assets) {
    const assetContract = await hre.ethers.getContractAt('TestIAsset', asset)
    const erc20 = await assetContract.erc20()
    if (!logToken(erc20).includes('USDC')) {
      console.log(`pushing ${logToken(erc20)}`)
      await pushOracleForward(hre, asset)
    } else {
      console.log(`not pushing ${logToken(erc20)}`)
    }
  }

  await ar.refresh()
  await basketHandler.refreshBasket()

  const tradingDelay = await backingManager.tradingDelay()
  await advanceBlocks(hre, tradingDelay/12 + 1)
  await advanceTime(hre, tradingDelay + 1)

  const iface: Interface = backingManager.interface

  // do first trade as a bad trade
  // buy half of the auction for the absolute minimum price

  console.log('\n* * * * * Try to break broker...')
  const registeredERC20s = await ar.erc20s()
  let r = await backingManager.manageTokens(registeredERC20s)
  const resp = await r.wait()
  for (const event of resp.events!) {
    let parsedLog: LogDescription | undefined
    try { parsedLog = iface.parseLog(event) } catch {}
    if (parsedLog && parsedLog.name == 'TradeStarted') {
      console.log(`\n====== Trade Started: sell ${logToken(parsedLog.args.sell)} / buy ${logToken(parsedLog.args.buy)} ======\n\tmbuyAmount: ${parsedLog.args.minBuyAmount}\n\tsellAmount: ${parsedLog.args.sellAmount}`)
      //
      // run trade
      const tradeToken = parsedLog.args.sell
      const trade = await getTrade(hre, backingManager, tradeToken)
      const buyTokenAddress = await trade.buy()
      console.log(`Running trade: sell ${logToken(tradeToken)} for ${logToken(buyTokenAddress)}...`)
      const endTime = await trade.endTime()
      const worstPrice = await trade.worstCasePrice() // trade.buy() per trade.sell()
      const auctionId = await trade.auctionId()

      /*
        we're only placing a half bid
      */
      const sellAmount = (await trade.initBal()).div(2)
    
      const sellToken = await hre.ethers.getContractAt('ERC20Mock', await trade.sell())
      const sellDecimals = await sellToken.decimals()
      const buytoken = await hre.ethers.getContractAt('ERC20Mock', await buyTokenAddress)
      const buyDecimals = await buytoken.decimals()
      let buyAmount = sellAmount.mul(worstPrice).div(fp('1'))
      if (buyDecimals > sellDecimals) {
        buyAmount = buyAmount.mul(bn(10**(buyDecimals - sellDecimals)))
      } else if (sellDecimals > buyDecimals) {
        buyAmount = buyAmount.div(bn(10**(sellDecimals - buyDecimals)))
      }

      buyAmount = buyAmount.add(1) // need 1 wei to be at min price
    
      const gnosis = await hre.ethers.getContractAt('EasyAuction', await trade.gnosis())
      await whileImpersonating(hre, whales[buyTokenAddress.toLowerCase()], async (whale) => {
        const sellToken = await hre.ethers.getContractAt('ERC20Mock', buyTokenAddress)
        await sellToken.connect(whale).approve(gnosis.address, buyAmount)
        await gnosis
          .connect(whale)
          .placeSellOrders(
            auctionId,
            [sellAmount],
            [buyAmount],
            [QUEUE_START],
            hre.ethers.constants.HashZero
          )
      })
    
      const lastTimestamp = await getLatestBlockTimestamp(hre)
      await advanceTime(hre, BigNumber.from(endTime).sub(lastTimestamp).toString())
      await backingManager.settleTrade(tradeToken)
      console.log(`Settled trade for ${logToken(buyTokenAddress)}.`)
    }
  }

  console.log('\n* * * * * Broker did not break!')

  await recollateralize(hre, rTokenAddress)

  console.log("\n2.1.0 check succeeded!")
}

export const proposal_2_1_0: ProposalBuilder = async (
  hre: HardhatRuntimeEnvironment,
  rTokenAddress: string,
  governorAddress: string
): Promise<Proposal> => {
  const rToken = await hre.ethers.getContractAt('RTokenP1', rTokenAddress)
  const main = await hre.ethers.getContractAt('IMain', await rToken.main())
  const broker = await hre.ethers.getContractAt(
    'BrokerP1',
    await main.broker()
  )
  const stRSR = await hre.ethers.getContractAt(
    'StRSRP1Votes',
    await main.stRSR()
  )
  const basketHandler = await hre.ethers.getContractAt(
    'BasketHandlerP1',
    await main.basketHandler()
  )

  const txs = [
    await broker.populateTransaction.upgradeTo("0x89209a52d085D975b14555F3e828F43fb7EaF3B7"),
    await stRSR.populateTransaction.upgradeTo("0xfDa8C62d86E426D5fB653B6c44a455Bb657b693f"),
    await basketHandler.populateTransaction.upgradeTo("0x5c13b3b6f40aD4bF7aa4793F844BA24E85482030"),
    await rToken.populateTransaction.upgradeTo("0x5643D5AC6b79ae8467Cf2F416da6D465d8e7D9C1"),
    await broker.populateTransaction.setTradeImplementation("0xAd4B0B11B041BB1342fEA16fc9c12Ef2a6443439")
  ]

  const description = "release 2.1.0 test"

  return buildProposal(txs, description)
}