import { bn } from '#/common/numbers'
import { ONE_PERIOD, TradeKind } from '#/common/constants'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { BigNumber, ContractFactory } from 'ethers'
import { formatEther } from 'ethers/lib/utils'
import { advanceBlocks, advanceTime } from '#/utils/time'
import { fp } from '#/common/numbers'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { callAndGetNextTrade, runBatchTrade, runDutchTrade } from './trades'
import { CollateralStatus } from '#/common/constants'
import { ActFacet } from '@typechain/ActFacet'
import { ReadFacet } from '@typechain/ReadFacet'
import { pushOraclesForward } from './oracles'

type Balances = { [key: string]: BigNumber }

const getAccountBalances = async (
  hre: HardhatRuntimeEnvironment,
  account: string,
  erc20s: Array<string>
): Promise<Balances> => {
  const balances: Balances = {}
  for (const erc20 of erc20s) {
    const token = await hre.ethers.getContractAt('ERC20Mock', erc20)
    const bal = await token.balanceOf(account)
    balances[erc20] = bal
  }
  return balances
}

const closeTo = (x: BigNumber, y: BigNumber, eBps: BigNumber): boolean => {
  return x.sub(y).abs().lte(x.add(y).div(2).mul(eBps).div(10000))
}

export const redeemRTokens = async (
  hre: HardhatRuntimeEnvironment,
  user: SignerWithAddress,
  rTokenAddress: string,
  redeemAmount: BigNumber
) => {
  console.log(`\nRedeeming ${formatEther(redeemAmount)}...`)
  const rToken = await hre.ethers.getContractAt('RTokenP1', rTokenAddress)
  const main = await hre.ethers.getContractAt('IMain', await rToken.main())
  const basketHandler = await hre.ethers.getContractAt(
    'BasketHandlerP1',
    await main.basketHandler()
  )
  const assetRegistry = await hre.ethers.getContractAt(
    'AssetRegistryP1',
    await main.assetRegistry()
  )

  await assetRegistry.refresh()
  const basketsNeeded = await rToken.basketsNeeded()
  const totalSupply = await rToken.totalSupply()
  const redeemQuote = await basketHandler.quote(
    redeemAmount.mul(basketsNeeded).div(totalSupply),
    false,
    0
  )
  const expectedTokens = redeemQuote.erc20s
  const expectedBalances: Balances = {}
  let log = ''
  for (const erc20 in expectedTokens) {
    expectedBalances[expectedTokens[erc20]] = redeemQuote.quantities[erc20]
    log += `\n\t${expectedTokens[erc20]}: ${redeemQuote.quantities[erc20]}`
  }
  console.log(`Expecting to receive: ${log}`)

  const preRedeemRTokenBal = await rToken.balanceOf(user.address)
  const preRedeemErc20Bals = await getAccountBalances(hre, user.address, expectedTokens)
  await rToken.connect(user).redeem(redeemAmount)
  const postRedeemRTokenBal = await rToken.balanceOf(user.address)
  const postRedeemErc20Bals = await getAccountBalances(hre, user.address, expectedTokens)

  for (const erc20 of expectedTokens) {
    const receivedBalance = postRedeemErc20Bals[erc20].sub(preRedeemErc20Bals[erc20])
    if (!closeTo(receivedBalance, expectedBalances[erc20], bn(1))) {
      throw new Error(
        `Did not receive the correct amount of token from redemption \n token: ${erc20} \n received: ${receivedBalance} \n expected: ${expectedBalances[erc20]}`
      )
    }
  }

  if (!preRedeemRTokenBal.sub(postRedeemRTokenBal).eq(redeemAmount)) {
    throw new Error(
      `Did not redeem the correct amount of RTokens \n expected: ${redeemAmount} \n redeemed: ${postRedeemRTokenBal.sub(
        preRedeemRTokenBal
      )}`
    )
  }

  console.log(`successfully redeemed ${formatEther(redeemAmount)} RTokens`)
}

export const customRedeemRTokens = async (
  hre: HardhatRuntimeEnvironment,
  user: SignerWithAddress,
  rTokenAddress: string,
  basketNonce: number,
  redeemAmount: BigNumber
) => {
  console.log(`\nCustom Redeeming ${formatEther(redeemAmount)}...`)
  const rToken = await hre.ethers.getContractAt('RTokenP1', rTokenAddress)

  const ReadFacetFactory: ContractFactory = await hre.ethers.getContractFactory('ReadFacet')
  const readFacet = <ReadFacet>await ReadFacetFactory.deploy()
  const redeemQuote = await readFacet.callStatic.redeemCustom(
    rToken.address,
    redeemAmount,
    [basketNonce],
    [fp('1')]
  )
  const expectedTokens = redeemQuote[0]
  const expectedQuantities = redeemQuote[1]
  const expectedBalances: Balances = {}
  let log = ''
  for (const erc20 in expectedTokens) {
    expectedBalances[expectedTokens[erc20]] = expectedQuantities[erc20]
    log += `\n\t${expectedTokens[erc20]}: ${expectedQuantities[erc20]}`
  }
  console.log(`Expecting to receive: ${log}`)

  const preRedeemRTokenBal = await rToken.balanceOf(user.address)
  const preRedeemErc20Bals = await getAccountBalances(hre, user.address, expectedTokens)

  await rToken.connect(user).redeemCustom(
    user.address,
    redeemAmount,
    [basketNonce],
    [fp('1')],
    expectedTokens,
    expectedQuantities.map((q: BigNumber) => q.mul(99).div(100))
  )
  const postRedeemRTokenBal = await rToken.balanceOf(user.address)
  const postRedeemErc20Bals = await getAccountBalances(hre, user.address, expectedTokens)

  for (const erc20 of expectedTokens) {
    const receivedBalance = postRedeemErc20Bals[erc20].sub(preRedeemErc20Bals[erc20])
    if (!closeTo(receivedBalance, expectedBalances[erc20], bn(1))) {
      throw new Error(
        `Did not receive the correct amount of token from custom redemption \n token: ${erc20} \n received: ${receivedBalance} \n expected: ${expectedBalances[erc20]}`
      )
    }
  }

  if (!preRedeemRTokenBal.sub(postRedeemRTokenBal).eq(redeemAmount)) {
    throw new Error(
      `Did not custom redeem the correct amount of RTokens \n expected: ${redeemAmount} \n redeemed: ${postRedeemRTokenBal.sub(
        preRedeemRTokenBal
      )}`
    )
  }

  console.log(`successfully custom redeemed ${formatEther(redeemAmount)} RTokens`)
}

export const recollateralize = async (
  hre: HardhatRuntimeEnvironment,
  rtokenAddress: string,
  kind: TradeKind
) => {
  if (kind == TradeKind.BATCH_AUCTION) {
    await recollateralizeBatch(hre, rtokenAddress)
  } else if (kind == TradeKind.DUTCH_AUCTION) {
    await recollateralizeDutch(hre, rtokenAddress)
  } else {
    throw new Error(`Invalid Trade Type`)
  }
}

const recollateralizeBatch = async (hre: HardhatRuntimeEnvironment, rtokenAddress: string) => {
  console.log(`* * * * * Recollateralizing (Batch) RToken ${rtokenAddress}...`)

  const rToken = await hre.ethers.getContractAt('RTokenP1', rtokenAddress)
  const main = await hre.ethers.getContractAt('IMain', await rToken.main())
  const backingManager = await hre.ethers.getContractAt(
    'BackingManagerP1',
    await main.backingManager()
  )
  const basketHandler = await hre.ethers.getContractAt(
    'BasketHandlerP1',
    await main.basketHandler()
  )

  // Deploy ActFacet
  const FacadeActFactory: ContractFactory = await hre.ethers.getContractFactory('ActFacet')
  const facadeAct = <ActFacet>await FacadeActFactory.deploy()

  // Move post trading delay
  await advanceTime(hre, (await backingManager.tradingDelay()) + 1)

  //const iface: Interface = backingManager.interface
  let tradesRemain = true
  while (tradesRemain) {
    const [newTradeCreated, newSellToken] = await callAndGetNextTrade(
      backingManager.rebalance(TradeKind.BATCH_AUCTION),
      backingManager
    )

    if (newTradeCreated) {
      await runBatchTrade(hre, backingManager, newSellToken, false)
    }

    await advanceTime(hre, ONE_PERIOD.toString())

    // Set tradesRemain
    ;[tradesRemain, , ,] = await facadeAct.callStatic.nextRecollateralizationAuction(
      backingManager.address,
      TradeKind.BATCH_AUCTION
    )
  }

  const basketStatus = await basketHandler.status()
  if (basketStatus != CollateralStatus.SOUND) {
    throw new Error(`Basket is not SOUND after recollateralizing new basket`)
  }

  if (!(await basketHandler.fullyCollateralized())) {
    throw new Error(`Basket is not fully collateralized!`)
  }

  console.log('Recollateralization complete!')
}

const recollateralizeDutch = async (hre: HardhatRuntimeEnvironment, rtokenAddress: string) => {
  console.log('*')
  console.log(`* * * * * Recollateralizing RToken (Dutch): ${rtokenAddress}...`)
  console.log('*')

  const rToken = await hre.ethers.getContractAt('RTokenP1', rtokenAddress)

  const main = await hre.ethers.getContractAt('IMain', await rToken.main())
  const backingManager = await hre.ethers.getContractAt(
    'BackingManagerP1',
    await main.backingManager()
  )
  const basketHandler = await hre.ethers.getContractAt(
    'BasketHandlerP1',
    await main.basketHandler()
  )

  let tradesRemain = false
  let sellToken = ''

  const [newTradeCreated, initialSellToken] = await callAndGetNextTrade(
    backingManager.rebalance(TradeKind.DUTCH_AUCTION),
    backingManager
  )

  if (newTradeCreated) {
    tradesRemain = true
    sellToken = initialSellToken

    for (let i = 0; tradesRemain; i++) {
      // every other trade, push oracles forward (some oracles have 3600s timeout)
      if (i % 2 == 1) await pushOraclesForward(hre, rtokenAddress, [])
      ;[tradesRemain, sellToken] = await runDutchTrade(hre, backingManager, sellToken)

      await advanceBlocks(hre, 1)
    }
  }

  const basketStatus = await basketHandler.status()
  if (basketStatus != CollateralStatus.SOUND) {
    throw new Error(`Basket is not SOUND after recollateralizing new basket`)
  }

  if (!(await basketHandler.fullyCollateralized())) {
    throw new Error(`Basket is not fully collateralized!`)
  }

  console.log('Recollateralization complete!')
}
