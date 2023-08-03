import { whileImpersonating } from '#/utils/impersonation'
import { advanceTime, getLatestBlockTimestamp } from '#/utils/time'
import { getTrade } from '#/utils/trades'
import { TestITrading } from '@typechain/TestITrading'
import { BigNumber } from 'ethers'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { QUEUE_START, TradeKind } from '#/common/constants'
import { collateralToUnderlying, whales } from './constants'
import { bn, fp } from '#/common/numbers'
import { logToken } from './logs'

// Run trade based on Trade Kind
export const runTrade = async (
  hre: HardhatRuntimeEnvironment,
  trader: TestITrading,
  tradeToken: string,
  bidExact: boolean
) => {
  const trade = await getTrade(hre, trader, tradeToken)
  const kind = await trade.KIND()

  if (kind == TradeKind.BATCH_AUCTION) {
    await runBatchTrade(hre, trader, tradeToken, bidExact)
  } // else if (kind == TradeKind.DUTCH_AUCTION) {
  //   await runDutchTrade(hre, trader, tradeToken, bidExact)
  // }
}

const runBatchTrade = async (
  hre: HardhatRuntimeEnvironment,
  trader: TestITrading,
  tradeToken: string,
  bidExact: boolean
) => {
  // NOTE:
  // buy & sell are from the perspective of the auction-starter
  // placeSellOrders() flips it to be from the perspective of the trader

  const trade = await getTrade(hre, trader, tradeToken)
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

// impersonate the whale to provide the required tokens to recipient
const getTokens = async (
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
    //  TODO: Replace with real addresses
    case '0xf201fFeA8447AB3d43c98Da3349e0749813C9009': // cUSDCVault
    case '0x840748F7Fd3EA956E5f4c88001da5CC1ABCBc038': // cUSDTVault
      await getCTokenVault(hre, tokenAddress, amount, recipient)
      break
    default:
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
