import { MAX_UINT256, QUEUE_START, TradeKind, TradeStatus } from '#/common/constants'
import { bn, fp, pow10 } from '#/common/numbers'
import { whileImpersonating } from '#/utils/impersonation'
import { networkConfig } from '../../../common/configuration'
import { advanceTime, getLatestBlockTimestamp } from '#/utils/time'
import { DutchTrade } from '@typechain/DutchTrade'
import { GnosisTrade } from '@typechain/GnosisTrade'
import { TestITrading } from '@typechain/TestITrading'
import { BigNumber, ContractTransaction } from 'ethers'
import { LogDescription } from 'ethers/lib/utils'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { logToken } from './logs'
import { getChainId } from '#/common/blockchain-utils'
import { Whales, getWhalesFile } from '#/scripts/whalesConfig'

export const runBatchTrade = async (
  hre: HardhatRuntimeEnvironment,
  trader: TestITrading,
  tradeToken: string,
  bidExact: boolean
) => {
  // NOTE:
  // buy & sell are from the perspective of the auction-starter
  // placeSellOrders() flips it to be from the perspective of the trader
  const chainId = await getChainId(hre)
  const whales: Whales = getWhalesFile(chainId).tokens

  const tradeAddr = await trader.trades(tradeToken)
  const trade = <GnosisTrade>await hre.ethers.getContractAt('GnosisTrade', tradeAddr)

  // Only works for Batch trades
  if ((await trade.KIND()) != TradeKind.BATCH_AUCTION) {
    throw new Error(`Invalid Trade Type`)
  }

  const buyTokenAddress = (await trade.buy()).toLowerCase()
  console.log(
    `Running batch trade: sell ${logToken(tradeToken)} for ${logToken(buyTokenAddress)}...`
  )
  const endTime = await trade.endTime()
  const worstPrice = await trade.worstCasePrice() // trade.buy() per trade.sell(), qTok
  const auctionId = await trade.auctionId()
  const sellAmount = await trade.initBal()

  const sellToken = await hre.ethers.getContractAt('ERC20Mock', await trade.sell())
  const sellDecimals = await sellToken.decimals()
  const buytoken = await hre.ethers.getContractAt('ERC20Mock', await buyTokenAddress)
  const buyDecimals = await buytoken.decimals()
  let buyAmount = bidExact
    ? sellAmount
    : sellAmount
        .mul(worstPrice)
        .mul(pow10(buyDecimals - sellDecimals))
        .div(fp('1'))
  if (buyDecimals > sellDecimals) {
    buyAmount = buyAmount.mul(pow10(buyDecimals - sellDecimals))
  } else if (sellDecimals > buyDecimals) {
    buyAmount = buyAmount.div(pow10(sellDecimals - buyDecimals))
  }
  buyAmount = buyAmount.add(fp('1').div(pow10(18 - buyDecimals)))

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
  const [signer] = await hre.ethers.getSigners()
  const router = await (await hre.ethers.getContractFactory('DutchTradeRouter')).deploy()
  // NOTE:
  // buy & sell are from the perspective of the auction-starter
  // bid() flips it to be from the perspective of the trader
  const chainId = await getChainId(hre)
  const whales: Whales = getWhalesFile(chainId).tokens

  let tradesRemain = false
  let newSellToken = ''

  const tradeAddr = await trader.trades(tradeToken)
  const trade = <DutchTrade>await hre.ethers.getContractAt('DutchTrade', tradeAddr)

  // Only works for Dutch trades
  if ((await trade.KIND()) != TradeKind.DUTCH_AUCTION) {
    throw new Error(`Invalid Trade Type`)
  }

  const buyTokenAddress = await trade.buy()
  console.log('=================================================================================')
  console.log(
    `Running Dutch Trade: Selling ${logToken(tradeToken)} for ${logToken(buyTokenAddress)}...`
  )

  const endTime = await trade.endTime()
  let whaleAddr = whales[buyTokenAddress.toLowerCase()]
  if (!whaleAddr) console.log('missing whale for ' + buyTokenAddress)
  whaleAddr = signer.address

  // Bid near 1:1 point, which occurs at a difficult-to-calculate time due to maxTradeSlippage
  const bestPrice = await trade.bestPrice()
  const worstPrice = await trade.worstPrice()
  const delta = bestPrice.sub(worstPrice).mul(fp('1')).div(bestPrice)
  const maxTradeSlippage = (await trader.maxTradeSlippage()).mul(fp('1')).div(delta)
  const unofficialEnd = 95 - maxTradeSlippage.div(2).div(bn('1e16')).toNumber()
  const fairMidpoint = (unofficialEnd - 45) / 2 + 45
  console.log('bidding at auction pct:', fairMidpoint)

  const toAdvance = ((endTime - (await getLatestBlockTimestamp(hre))) * fairMidpoint) / 100
  await advanceTime(hre, toAdvance)
  const buyAmount = await trade.bidAmount(await getLatestBlockTimestamp(hre))

  // Ensure funds available
  await getTokens(hre, buyTokenAddress, buyAmount, whaleAddr)

  const buyToken = await hre.ethers.getContractAt('ERC20Mock', buyTokenAddress)
  await whileImpersonating(hre, whaleAddr, async (whale) => {
    await buyToken.connect(whale).approve(router.address, MAX_UINT256)
  })

  // Bid
  ;[tradesRemain, newSellToken] = await callAndGetNextTrade(
    router.bid(trade.address, await router.signer.getAddress()),
    trader
  )

  console.log(
    'Trade State:',
    TradeStatus[await trade.status()],
    await trade.canSettle(),
    await trade.bidder(),
    whaleAddr
  )

  if (
    (await trade.canSettle()) ||
    (await trade.status()) != TradeStatus.CLOSED ||
    (await trade.bidder()) != router.address
  ) {
    throw new Error(`Error settling Dutch Trade`)
  }

  console.log(`Settled trade for ${logToken(buyTokenAddress)} in amount ${buyAmount}.`)

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
  const iface = trader.interface

  for (const event of resp.events!) {
    let parsedLog: LogDescription | undefined
    try {
      parsedLog = iface.parseLog(event)
      // eslint-disable-next-line no-empty
    } catch {}

    if (parsedLog && parsedLog.name == 'TradeStarted') {
      // TODO: Improve this to include proper token details and parsing.

      // console.log(
      //   `
      //  ====== Trade Started: Selling ${logToken(parsedLog.args.sell)} / Buying ${logToken(
      //     parsedLog.args.buy
      //   )} ======
      //  minBuyAmount: ${parsedLog.args.minBuyAmount}
      //  sellAmount: ${parsedLog.args.sellAmount}
      // `.trim()
      // )

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
  console.log(`Acquiring tokens... ${logToken(tokenAddress)}: ${tokenAddress}`)
  switch (tokenAddress.toLowerCase()) {
    case '0x60C384e226b120d93f3e0F4C502957b2B9C32B15'.toLowerCase(): // <3.4.0 saUSDC mainnet
    case '0xa8157BF67Fd7BcDCC139CB9Bf1bd7Eb921A779D3'.toLowerCase(): // >=3.4.0 saUSDC mainnet
    case '0x21fe646D1Ed0733336F2D4d9b2FE67790a6099D9'.toLowerCase(): // <3.4.0 saUSDT mainnet
    case '0x684AA4faf9b07d5091B88c6e0a8160aCa5e6d17b'.toLowerCase(): // >=3.4.0 saUSDT mainnet
      await getStaticAToken(hre, tokenAddress, amount, recipient)
      break
    case '0x6f6f81e5e66f503184f2202d83a79650c3285759'.toLocaleLowerCase(): // >= 3.4.0 saBasUSDC base
      await getStaticATokenV3(hre, tokenAddress, amount, recipient)
      break
    case '0xf579F9885f1AEa0d3F8bE0F18AfED28c92a43022'.toLowerCase(): // cUSDCVault mainnet
    case '0x4Be33630F92661afD646081BC29079A38b879aA0'.toLowerCase(): // cUSDTVault mainnet
      await getCTokenVault(hre, tokenAddress, amount, recipient)
      break
    case '0x24CDc6b4Edd3E496b7283D94D93119983A61056a'.toLowerCase(): // cvx3Pool mainnet
    case '0x5ale11daB8150966aFfE15F0a5bFfBa7F4d2b62DEd4'.toLowerCase(): // cvxPayPool mainnet
    case '0x8e33D5aC344f9F2fc1f2670D45194C280d4fBcF1'.toLowerCase(): // <3.4.0 cvxeUSDFRAXBP mainnet
    case '0x5cD176b58a6FdBAa1aEFD0921935a730C62f03Ac'.toLowerCase(): // <3.4.0 cvxeUSDFRAXBP mainnet
    case '0x3e8f7EDc03E0133b95EcB4dD2f72B5027E695413'.toLowerCase(): // cvxMIM3Pool mainnet
    case '0xDbC0cE2321B76D3956412B36e9c0FA9B0fD176E7'.toLowerCase(): // cvxETHPlusETH mainnet
    case '0x6ad24C0B8fD4B594C6009A7F7F48450d9F56c6b8'.toLowerCase(): // cvxCrvUSDUSDC mainnet
    case '0x5d1B749bA7f689ef9f260EDC54326C48919cA88b'.toLowerCase(): // cvxCrvUSDUSDT mainnet
      await getCvxVault(hre, tokenAddress, amount, recipient)
      break
    default:
      await getERC20Tokens(hre, tokenAddress, amount, recipient)
      return
  }
}

const getCvxVault = async (
  hre: HardhatRuntimeEnvironment,
  tokenAddress: string,
  amount: BigNumber,
  recipient: string
) => {
  const chainId = await getChainId(hre)
  const whales: Whales = getWhalesFile(chainId).tokens

  const cvxWrapper = await hre.ethers.getContractAt('ConvexStakingWrapper', tokenAddress)
  const curveTokenAddy = await cvxWrapper.curveToken()
  const curvePool = await hre.ethers.getContractAt(
    '@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20',
    curveTokenAddy
  )
  await whileImpersonating(hre, whales[curveTokenAddy.toLowerCase()], async (whaleSigner) => {
    await curvePool.connect(whaleSigner).transfer(recipient, amount)
  })

  await whileImpersonating(hre, recipient, async (recipientSigner) => {
    await curvePool.connect(recipientSigner).approve(cvxWrapper.address, amount)
    await cvxWrapper.connect(recipientSigner).deposit(amount, recipient)
  })
}

// get a specific amount of wrapped cTokens
const getCTokenVault = async (
  hre: HardhatRuntimeEnvironment,
  tokenAddress: string,
  amount: BigNumber,
  recipient: string
) => {
  const chainId = await getChainId(hre)
  const whales: Whales = getWhalesFile(chainId).tokens

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
  const chainId = await getChainId(hre)
  const whales: Whales = getWhalesFile(chainId).tokens

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

// get a specific amount of static aTokens V3
const getStaticATokenV3 = async (
  hre: HardhatRuntimeEnvironment,
  tokenAddress: string,
  amount: BigNumber,
  recipient: string
) => {
  const chainId = await getChainId(hre)
  const whales: Whales = getWhalesFile(chainId).tokens

  const collateral = await hre.ethers.getContractAt('StaticATokenV3LM', tokenAddress)
  const requiredAmt = await collateral.previewMint(amount)

  const aToken = await hre.ethers.getContractAt(
    'contracts/plugins/assets/aave-v3/vendor/interfaces/IAToken.sol:IAToken',
    await collateral.aToken()
  )

  const baseToken = await hre.ethers.getContractAt(
    '@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20',
    await aToken.UNDERLYING_ASSET_ADDRESS()
  )

  // Impersonate holder
  await whileImpersonating(hre, whales[baseToken.address.toLowerCase()], async (whaleSigner) => {
    await baseToken
      .connect(whaleSigner)
      .approve(collateral.address, hre.ethers.constants.MaxUint256)
    await collateral
      .connect(whaleSigner)
      ['deposit(uint256,address,uint16,bool)'](requiredAmt, recipient, 0, true)
  })
}

// get a specific amount of erc20 plain token
const getERC20Tokens = async (
  hre: HardhatRuntimeEnvironment,
  tokenAddress: string,
  amount: BigNumber,
  recipient: string
) => {
  const chainId = await getChainId(hre)
  const whales: Whales = getWhalesFile(chainId).tokens

  const token = await hre.ethers.getContractAt('ERC20Mock', tokenAddress)

  // special-cases for wrappers with 0 supply
  if (chainId == '1' || chainId == '31337') {
    const wcUSDCv3Address = networkConfig[chainId].tokens.wcUSDCv3!.toLowerCase()
    const wcUSDCv3AddressOld = '0xfBD1a538f5707C0D67a16ca4e3Fc711B80BD931A'.toLowerCase()
    const aUSDCv3Address = networkConfig[chainId].tokens.saEthUSDC!.toLowerCase()
    const aUSDCv3AddressOld = '0x093cB4f405924a0C468b43209d5E466F1dd0aC7d'.toLowerCase()
    const aPyUSDv3Address = networkConfig[chainId].tokens.saEthPyUSD!.toLowerCase()
    const aPyUSDv3AddressOld = '0xe176A5ebFB873D5b3cf1909d0EdaE4FE095F5bc7'.toLowerCase()
    const stkcvxeUSDFRAXBPAddress = '0x81697e25DFf8564d9E0bC6D27edb40006b34ea2A'.toLowerCase()
    const stkcvxeUSDFRAXBPAddressOld = '0x8e33D5aC344f9F2fc1f2670D45194C280d4fBcF1'.toLowerCase()
    const stkcvxeUSDFRAXBPAddressOld2 = '0x5cD176b58a6FdBAa1aEFD0921935a730C62f03Ac'.toLowerCase()

    const tokAddress = tokenAddress.toLowerCase()

    // Solutions for wrappers without whales
    if (tokAddress == wcUSDCv3Address || tokAddress == wcUSDCv3AddressOld) {
      const wcUSDCv3 = await hre.ethers.getContractAt('CusdcV3Wrapper', tokAddress)
      await whileImpersonating(
        hre,
        whales[networkConfig['1'].tokens.cUSDCv3!.toLowerCase()],
        async (whaleSigner) => {
          const cUSDCv3 = await hre.ethers.getContractAt(
            'ERC20Mock',
            networkConfig['1'].tokens.cUSDCv3!
          )
          await cUSDCv3.connect(whaleSigner).approve(wcUSDCv3.address, 0)
          await cUSDCv3.connect(whaleSigner).approve(wcUSDCv3.address, MAX_UINT256)
          await wcUSDCv3.connect(whaleSigner).deposit(amount.mul(2))
          const bal = await wcUSDCv3.balanceOf(whaleSigner.address)
          await wcUSDCv3.connect(whaleSigner).transfer(recipient, bal)
        }
      )
    } else if (tokAddress == aUSDCv3Address || tokAddress == aUSDCv3AddressOld) {
      const saEthUSDC = await hre.ethers.getContractAt('IStaticATokenV3LM', tokAddress)
      await whileImpersonating(
        hre,
        whales[networkConfig['1'].tokens.USDC!.toLowerCase()],
        async (whaleSigner) => {
          const USDC = await hre.ethers.getContractAt('ERC20Mock', networkConfig['1'].tokens.USDC!)
          await USDC.connect(whaleSigner).approve(saEthUSDC.address, amount.mul(2))
          await saEthUSDC.connect(whaleSigner).deposit(amount.mul(2), whaleSigner.address, 0, true)
          await token.connect(whaleSigner).transfer(recipient, amount) // saEthUSDC transfer
        }
      )
    } else if (tokAddress == aPyUSDv3Address || tokAddress == aPyUSDv3AddressOld) {
      const saEthPyUSD = await hre.ethers.getContractAt('IStaticATokenV3LM', tokAddress)
      await whileImpersonating(
        hre,
        whales[networkConfig['1'].tokens.pyUSD!.toLowerCase()],
        async (whaleSigner) => {
          const pyUSD = await hre.ethers.getContractAt(
            'ERC20Mock',
            networkConfig['1'].tokens.pyUSD!
          )
          await pyUSD.connect(whaleSigner).approve(saEthPyUSD.address, amount.mul(2))
          await saEthPyUSD.connect(whaleSigner).deposit(amount.mul(2), whaleSigner.address, 0, true)
          await token.connect(whaleSigner).transfer(recipient, amount) // saEthPyUSD transfer
        }
      )
    } else if (
      tokAddress == stkcvxeUSDFRAXBPAddress ||
      tokAddress == stkcvxeUSDFRAXBPAddressOld ||
      tokAddress == stkcvxeUSDFRAXBPAddressOld2
    ) {
      const stkcvxeUSDFRAXBP = await hre.ethers.getContractAt('ConvexStakingWrapper', tokAddress)

      const lpTokenAddr = '0xaeda92e6a3b1028edc139a4ae56ec881f3064d4f'.toLowerCase()

      await whileImpersonating(hre, whales[lpTokenAddr], async (whaleSigner) => {
        const lpToken = await hre.ethers.getContractAt('ERC20Mock', lpTokenAddr)
        await lpToken.connect(whaleSigner).approve(stkcvxeUSDFRAXBP.address, amount.mul(2))
        await stkcvxeUSDFRAXBP.connect(whaleSigner).deposit(amount.mul(2), whaleSigner.address)
        await token.connect(whaleSigner).transfer(recipient, amount)
      })
    } else {
      // Directly get tokens from whale
      const addr = whales[token.address.toLowerCase()]
      if (!addr) throw new Error('missing whale for ' + tokenAddress)
      await whileImpersonating(hre, whales[token.address.toLowerCase()], async (whaleSigner) => {
        await token.connect(whaleSigner).transfer(recipient, amount)
      })
    }
  } else if (chainId == '8453' || chainId == '84531') {
    // Base
    const wcUSDCv3Address = networkConfig[chainId].tokens.wcUSDCv3!.toLowerCase()
    const wcUSDCv3AddressOld = '0xA694f7177C6c839C951C74C797283B35D0A486c8'.toLowerCase()

    const tokAddress = tokenAddress.toLowerCase()

    // Solutions for wrappers without whales
    if (tokAddress == wcUSDCv3Address || tokAddress == wcUSDCv3AddressOld) {
      const wcUSDCv3 = await hre.ethers.getContractAt('CusdcV3Wrapper', tokAddress)

      await whileImpersonating(
        hre,
        whales[networkConfig[chainId].tokens.cUSDCv3!.toLowerCase()],
        async (whaleSigner) => {
          const cUSDCv3 = await hre.ethers.getContractAt(
            'ERC20Mock',
            networkConfig[chainId].tokens.cUSDCv3!
          )
          await cUSDCv3.connect(whaleSigner).approve(wcUSDCv3.address, 0)
          await cUSDCv3.connect(whaleSigner).approve(wcUSDCv3.address, MAX_UINT256)
          await wcUSDCv3.connect(whaleSigner).deposit(amount.mul(120).div(100))
          const bal = await wcUSDCv3.balanceOf(whaleSigner.address)
          await wcUSDCv3.connect(whaleSigner).transfer(recipient, bal)
        }
      )
    } else {
      // Directly get tokens from whale
      const addr = whales[token.address.toLowerCase()]
      if (!addr) throw new Error('missing whale for ' + tokenAddress)
      await whileImpersonating(hre, whales[token.address.toLowerCase()], async (whaleSigner) => {
        await token.connect(whaleSigner).transfer(recipient, amount)
      })
    }
  }
}
