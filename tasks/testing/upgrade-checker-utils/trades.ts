import { whileImpersonating } from "#/utils/impersonation"
import { advanceTime, getLatestBlockTimestamp } from "#/utils/time"
import { getTrade } from "#/utils/trades"
import { TestITrading } from "@typechain/TestITrading"
import { BigNumber } from "ethers"
import { HardhatRuntimeEnvironment } from "hardhat/types"
import { QUEUE_START } from '#/common/constants'
import { whales } from "./constants"
import { fp } from "#/common/numbers"

export const runTrade = async (
  hre: HardhatRuntimeEnvironment,
  trader: TestITrading,
  tradeToken: string,
  bidExact: boolean
) => {
  const trade = await getTrade(hre, trader, tradeToken)
  const sellTokenAddress = await trade.buy()
  const endTime = await trade.endTime()
  const worstPrice = await trade.worstCasePrice()
  const auctionId = await trade.auctionId()
  const buyAmount = await trade.initBal()
  const sellAmount = bidExact ? buyAmount : buyAmount.mul(worstPrice).div(fp('1')).add(fp('1'))

  const gnosis = await hre.ethers.getContractAt('EasyAuction', await trade.gnosis())
  await whileImpersonating(hre, whales[sellTokenAddress.toLowerCase()], async (whale) => {
    const sellToken = await hre.ethers.getContractAt('ERC20Mock', sellTokenAddress)
    await sellToken.connect(whale).approve(gnosis.address, sellAmount)
    await gnosis
      .connect(whale)
      .placeSellOrders(
        auctionId,
        [buyAmount],
        [sellAmount],
        [QUEUE_START],
        hre.ethers.constants.HashZero
      )
  })

  const lastTimestamp = await getLatestBlockTimestamp(hre)
  await advanceTime(hre, BigNumber.from(endTime).sub(lastTimestamp).toString())
  await trader.settleTrade(tradeToken)
}