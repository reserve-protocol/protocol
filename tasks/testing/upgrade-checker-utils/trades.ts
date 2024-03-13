import { QUEUE_START, TradeKind, TradeStatus } from '#/common/constants'
import { bn, fp } from '#/common/numbers'
import { whileImpersonating } from '#/utils/impersonation'
import { networkConfig } from '../../../common/configuration'
import {
  advanceBlocks,
  advanceTime,
  getLatestBlockNumber,
  getLatestBlockTimestamp,
} from '#/utils/time'
import { DutchTrade } from '@typechain/DutchTrade'
import { GnosisTrade } from '@typechain/GnosisTrade'
import { TestITrading } from '@typechain/TestITrading'
import { BigNumber, ContractTransaction } from 'ethers'
import { Interface, LogDescription } from 'ethers/lib/utils'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { collateralToUnderlying, whales } from './constants'
import { logToken } from './logs'

export const runBatchTrade = async (
  hre: HardhatRuntimeEnvironment,
  trader: TestITrading,
  tradeToken: string,
  bidExact: boolean
) => {
  // NOTE:
  // buy & sell are from the perspective of the auction-starter
  // placeSellOrders() flips it to be from the perspective of the trader

  const tradeAddr = await trader.trades(tradeToken)
  const trade = <GnosisTrade>await hre.ethers.getContractAt('GnosisTrade', tradeAddr)

  // Only works for Batch trades
  if ((await trade.KIND()) != TradeKind.BATCH_AUCTION) {
    throw new Error(`Invalid Trade Type`)
  }

  const buyTokenAddress = await trade.buy()
  console.log(`Running trade: sell ${logToken(tradeToken)} for ${logToken(buyTokenAddress)}...`)
  const endTime = await trade.endTime()
  const worstPrice = await trade.worstCasePrice() // trade.buy() per trade.sell()
  const auctionId = await trade.auctionId()
  const sellAmount = await trade.initBal()

  const sellToken = await hre.ethers.getContractAt('ERC20Mock', await trade.sell())
  const sellDecimals = await sellToken.decimals()
  const buytoken = await hre.ethers.getContractAt('ERC20Mock', await buyTokenAddress)
  const buyDecimals = await buytoken.decimals()
  let buyAmount = bidExact ? sellAmount : sellAmount.mul(worstPrice).div(fp('1'))
  if (buyDecimals > sellDecimals) {
    buyAmount = buyAmount.mul(bn(10 ** (buyDecimals - sellDecimals)))
  } else if (sellDecimals > buyDecimals) {
    buyAmount = buyAmount.div(bn(10 ** (sellDecimals - buyDecimals)))
  }
  buyAmount = buyAmount.add(fp('1').div(bn(10 ** (18 - buyDecimals))))

  const gnosis = await hre.ethers.getContractAt('EasyAuction', await trade.gnosis())
  const whaleAddr = whales[buyTokenAddress.toLowerCase()]

  // For newly wrapped tokens we need to feed the whale
  await getTokens(hre, buyTokenAddress, buyAmount, whaleAddr)

  await whileImpersonating(hre, whaleAddr, async (whale) => {
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
  await trader.settleTrade(tradeToken)

  console.log(`Settled trade for ${logToken(buyTokenAddress)}.`)
}

export const runDutchTrade = async (
  hre: HardhatRuntimeEnvironment,
  trader: TestITrading,
  tradeToken: string
): Promise<[boolean, string]> => {
  const router = await (await hre.ethers.getContractFactory('DutchTradeRouter')).deploy()
  // NOTE:
  // buy & sell are from the perspective of the auction-starter
  // bid() flips it to be from the perspective of the trader

  let tradesRemain: boolean = false
  let newSellToken: string = ''

  const tradeAddr = await trader.trades(tradeToken)
  const trade = <DutchTrade>await hre.ethers.getContractAt('DutchTrade', tradeAddr)

  // Only works for Dutch trades
  if ((await trade.KIND()) != TradeKind.DUTCH_AUCTION) {
    throw new Error(`Invalid Trade Type`)
  }

  const buyTokenAddress = await trade.buy()
  console.log(`Running trade: sell ${logToken(tradeToken)} for ${logToken(buyTokenAddress)}...`)

  const endBlock = await trade.endBlock()
  const [tester] = await hre.ethers.getSigners()

  // Bid close to end block
  await advanceBlocks(hre, endBlock.sub(await getLatestBlockNumber(hre)).sub(5))
  const buyAmount = await trade.bidAmount(await getLatestBlockNumber(hre))

  // Ensure funds available
  await getTokens(hre, buyTokenAddress, buyAmount, tester.address)

  // Bid
  ;[tradesRemain, newSellToken] = await callAndGetNextTrade(
    router.bid(trade.address, await router.signer.getAddress()),
    trader
  )

  if (
    (await trade.canSettle()) ||
    (await trade.status()) != TradeStatus.CLOSED ||
    (await trade.bidder()) != tester.address
  ) {
    throw new Error(`Error settling Dutch Trade`)
  }

  console.log(`Settled trade for ${logToken(buyTokenAddress)}.`)

  // Return new trade (if exists)
  return [tradesRemain, newSellToken]
}

export const callAndGetNextTrade = async (
  tx: Promise<ContractTransaction>,
  trader: TestITrading
): Promise<[boolean, string]> => {
  let tradesRemain = false
  let newSellToken = ''

  // Process transaction and get next trade
  const r = await tx
  const resp = await r.wait()
  const iface: Interface = trader.interface
  for (const event of resp.events!) {
    let parsedLog: LogDescription | undefined
    try {
      parsedLog = iface.parseLog(event)
    } catch {}
    if (parsedLog && parsedLog.name == 'TradeStarted') {
      console.log(
        `\n====== Trade Started: sell ${logToken(parsedLog.args.sell)} / buy ${logToken(
          parsedLog.args.buy
        )} ======\n\tmbuyAmount: ${parsedLog.args.minBuyAmount}\n\tsellAmount: ${
          parsedLog.args.sellAmount
        }`
      )
      tradesRemain = true
      newSellToken = parsedLog.args.sell
    }
  }

  return [tradesRemain, newSellToken]
}
// impersonate the whale to provide the required tokens to recipient
export const getTokens = async (
  hre: HardhatRuntimeEnvironment,
  tokenAddress: string,
  amount: BigNumber,
  recipient: string
) => {
  switch (tokenAddress) {
    case '0x60C384e226b120d93f3e0F4C502957b2B9C32B15': // saUSDC
    case '0x21fe646D1Ed0733336F2D4d9b2FE67790a6099D9': // saUSDT
      await getStaticAToken(hre, tokenAddress, amount, recipient)
      break
    case '0xf579F9885f1AEa0d3F8bE0F18AfED28c92a43022': // cUSDCVault
    case '0x4Be33630F92661afD646081BC29079A38b879aA0': // cUSDTVault
      await getCTokenVault(hre, tokenAddress, amount, recipient)
      break
    default:
      await getERC20Tokens(hre, tokenAddress, amount, recipient)
      return
  }
}

// mint regular cTokens  for an amount of `underlying`
const mintCToken = async (
  hre: HardhatRuntimeEnvironment,
  tokenAddress: string,
  amount: BigNumber,
  recipient: string
) => {
  const collateral = await hre.ethers.getContractAt('ICToken', tokenAddress)
  const underlying = await hre.ethers.getContractAt(
    'ERC20Mock',
    collateralToUnderlying[tokenAddress.toLowerCase()]
  )
  await whileImpersonating(hre, whales[tokenAddress.toLowerCase()], async (whaleSigner) => {
    await underlying.connect(whaleSigner).approve(collateral.address, amount)
    await collateral.connect(whaleSigner).mint(amount)
    const bal = await collateral.balanceOf(whaleSigner.address)
    await collateral.connect(whaleSigner).transfer(recipient, bal)
  })
}

// mints staticAToken for an amount of `underlying`
const mintStaticAToken = async (
  hre: HardhatRuntimeEnvironment,
  tokenAddress: string,
  amount: BigNumber,
  recipient: string
) => {
  const collateral = await hre.ethers.getContractAt('StaticATokenLM', tokenAddress)
  const underlying = await hre.ethers.getContractAt(
    'ERC20Mock',
    collateralToUnderlying[tokenAddress.toLowerCase()]
  )
  await whileImpersonating(hre, whales[tokenAddress.toLowerCase()], async (whaleSigner) => {
    await underlying.connect(whaleSigner).approve(collateral.address, amount)
    await collateral.connect(whaleSigner).deposit(recipient, amount, 0, true)
  })
}

// get a specific amount of wrapped cTokens
const getCTokenVault = async (
  hre: HardhatRuntimeEnvironment,
  tokenAddress: string,
  amount: BigNumber,
  recipient: string
) => {
  const collateral = await hre.ethers.getContractAt('CTokenWrapper', tokenAddress)
  const cToken = await hre.ethers.getContractAt('ICToken', await collateral.underlying())

  await whileImpersonating(hre, whales[cToken.address.toLowerCase()], async (whaleSigner) => {
    await cToken.connect(whaleSigner).transfer(recipient, amount)
  })

  await whileImpersonating(hre, recipient, async (recipientSigner) => {
    await cToken.connect(recipientSigner).approve(collateral.address, amount)
    await collateral.connect(recipientSigner).deposit(amount, recipient)
  })
}

// get a specific amount of static aTokens
const getStaticAToken = async (
  hre: HardhatRuntimeEnvironment,
  tokenAddress: string,
  amount: BigNumber,
  recipient: string
) => {
  const collateral = await hre.ethers.getContractAt('StaticATokenLM', tokenAddress)
  const aTokensNeeded = await collateral.staticToDynamicAmount(amount)
  const aToken = await hre.ethers.getContractAt(
    '@aave/protocol-v2/contracts/interfaces/IAToken.sol:IAToken',
    await collateral.ATOKEN()
  )

  await whileImpersonating(hre, whales[aToken.address.toLowerCase()], async (whaleSigner) => {
    await aToken.connect(whaleSigner).transfer(recipient, aTokensNeeded.mul(101).div(100)) // buffer to ensure enough balance
  })

  await whileImpersonating(hre, recipient, async (recipientSigner) => {
    const bal = await aToken.balanceOf(recipientSigner.address)
    await aToken.connect(recipientSigner).approve(collateral.address, bal)
    await collateral.connect(recipientSigner).deposit(recipient, bal, 0, false)
  })
}

// get a specific amount of erc20 plain token
const getERC20Tokens = async (
  hre: HardhatRuntimeEnvironment,
  tokenAddress: string,
  amount: BigNumber,
  recipient: string
) => {
  const token = await hre.ethers.getContractAt('ERC20Mock', tokenAddress)

  // special-cases for wrappers with 0 supply
  const wcUSDCv3 = await hre.ethers.getContractAt(
    'CusdcV3Wrapper',
    '0xfBD1a538f5707C0D67a16ca4e3Fc711B80BD931A'
  )
  const saEthUSDC = await hre.ethers.getContractAt(
    'IStaticATokenV3LM',
    networkConfig['1'].tokens.saEthUSDC!
  )

  if (tokenAddress == wcUSDCv3.address) {
    await whileImpersonating(
      hre,
      whales[networkConfig['1'].tokens.cUSDCv3!.toLowerCase()],
      async (whaleSigner) => {
        const cUSDCv3 = await hre.ethers.getContractAt(
          'ERC20Mock',
          networkConfig['1'].tokens.cUSDCv3!
        )
        console.log('1a', cUSDCv3.address, whaleSigner.address, wcUSDCv3.address, amount)
        await cUSDCv3.connect(whaleSigner).approve(wcUSDCv3.address, 0)
        console.log('1.5a', cUSDCv3.address, whaleSigner.address, wcUSDCv3.address, amount)
        // TODO why is this failing...
        await cUSDCv3.connect(whaleSigner).approve(wcUSDCv3.address, amount)
        console.log('2a')
        await wcUSDCv3.connect(whaleSigner).deposit(amount)
        console.log('3a')
        await wcUSDCv3.connect(whaleSigner).transfer(recipient, amount)
      }
    )
  } else if (tokenAddress == saEthUSDC.address) {
    await whileImpersonating(
      hre,
      whales[networkConfig['1'].tokens.USDC!.toLowerCase()],
      async (whaleSigner) => {
        const USDC = await hre.ethers.getContractAt('ERC20Mock', networkConfig['1'].tokens.USDC!)
        console.log('1b')
        await USDC.connect(whaleSigner).approve(saEthUSDC.address, amount.mul(2))
        console.log('2b')
        await saEthUSDC.connect(whaleSigner).deposit(amount.mul(2), whaleSigner.address, 0, true)
        console.log('3b', amount, await token.balanceOf(whaleSigner.address), recipient)
        // TODO why is this failing...
        await token.connect(whaleSigner).transfer(recipient, amount) // saEthUSDC transfer
      }
    )
  } else {
    const addr = whales[token.address.toLowerCase()]
    if (!addr) throw new Error('missing whale for ' + tokenAddress)
    await whileImpersonating(hre, whales[token.address.toLowerCase()], async (whaleSigner) => {
      await token.connect(whaleSigner).transfer(recipient, amount)
    })
  }
}
