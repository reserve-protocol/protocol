import { whileImpersonating } from "#/utils/impersonation"
import { advanceTime, getLatestBlockTimestamp } from "#/utils/time"
import { getTrade } from "#/utils/trades"
import { TestITrading } from "@typechain/TestITrading"
import { BigNumber } from "ethers"
import { HardhatRuntimeEnvironment } from "hardhat/types"
import { QUEUE_START } from '#/common/constants'
import { collateralToUnderlying, whales } from "./constants"
import { bn, fp } from "#/common/numbers"
import { logToken } from "./logs"
import { networkConfig } from "#/common/configuration"
import { ERC20Mock } from "@typechain/ERC20Mock"

export const runTrade = async (
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
    buyAmount = buyAmount.mul(bn(10**(buyDecimals - sellDecimals)))
  } else if (sellDecimals > buyDecimals) {
    buyAmount = buyAmount.div(bn(10**(sellDecimals - buyDecimals)))
  }
  buyAmount = buyAmount.add(fp('1').div(bn(10**(18 - buyDecimals))))

  const gnosis = await hre.ethers.getContractAt('EasyAuction', await trade.gnosis())
  console.log('impersonate', whales[buyTokenAddress.toLowerCase()], buyTokenAddress)
  await whileImpersonating(hre, whales[buyTokenAddress.toLowerCase()], async (whale) => {
    const sellToken = await hre.ethers.getContractAt('ERC20Mock', buyTokenAddress)
    // await mintTokensIfNeeded(hre, buyTokenAddress, buyAmount, whale.address)
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

// impersonate the whale to get the token
const mintTokensIfNeeded = async (hre: HardhatRuntimeEnvironment, tokenAddress: string, amount: BigNumber, recipient: string) => {
  switch (tokenAddress) {
    case networkConfig['1'].tokens.aUSDC:
    case networkConfig['1'].tokens.aUSDT:
      await mintAToken(hre, tokenAddress, amount, recipient)
    case networkConfig['1'].tokens.cUSDC:
    case networkConfig['1'].tokens.cUSDT:
      await mintCToken(hre, tokenAddress, amount, recipient)
    default:
      return
  }
}

const mintCToken = async (hre: HardhatRuntimeEnvironment, tokenAddress: string, amount: BigNumber, recipient: string) => {
  const collateral = await hre.ethers.getContractAt('ICToken', tokenAddress)
  const underlying = await hre.ethers.getContractAt('ERC20Mock', collateralToUnderlying[tokenAddress.toLowerCase()])
  await whileImpersonating(hre, whales[tokenAddress.toLowerCase()], async (whaleSigner) => {
    console.log('0', amount, recipient, collateral.address, underlying.address, whaleSigner.address)
    await underlying.connect(whaleSigner).approve(collateral.address, amount)
    console.log('1', amount, recipient)
    await collateral.connect(whaleSigner).mint(amount)
    console.log('2', amount, recipient)
    const bal = await collateral.balanceOf(whaleSigner.address)
    console.log('3', amount, recipient, bal)
    await collateral.connect(whaleSigner).transfer(recipient, bal)
  })
}

const mintAToken = async (hre: HardhatRuntimeEnvironment, tokenAddress: string, amount: BigNumber, recipient: string) => {
  const collateral = await hre.ethers.getContractAt('StaticATokenLM', tokenAddress)
  const underlying = await hre.ethers.getContractAt('ERC20Mock', collateralToUnderlying[tokenAddress.toLowerCase()])
  await whileImpersonating(hre, whales[tokenAddress.toLowerCase()], async (usdtSigner) => {
    await underlying.connect(usdtSigner).approve(collateral.address, amount)
    await collateral.connect(usdtSigner).deposit(recipient, amount, 0, true)
  })
}