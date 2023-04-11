import { fp } from "#/common/numbers"
import { whileImpersonating } from "#/utils/impersonation"
import { advanceBlocks, advanceTime } from "#/utils/time"
import { IRewardable } from "@typechain/IRewardable"
import { formatEther } from "ethers/lib/utils"
import { HardhatRuntimeEnvironment } from "hardhat/types"
import { runTrade } from "../upgrade-checker-utils/trades"

const claimRewards = async (claimer: IRewardable) => {
  const resp = await claimer.claimRewards()
  const r = await resp.wait()
  const rewards = []
  for (const event of r.events!) {
    if (event.event == 'RewardsClaimed' && event.args!.amount.gt(0)) {
      rewards.push(event.args!.erc20)
    }
  }
  return rewards
}

export const claimRsrRewards = async (hre: HardhatRuntimeEnvironment, rtokenAddress: string) => {
  console.log(`Claiming RSR rewards...`)
  const rToken = await hre.ethers.getContractAt('RTokenP1', rtokenAddress)
  const main = await hre.ethers.getContractAt('IMain', await rToken.main())
  const backingManager = await hre.ethers.getContractAt(
    'BackingManagerP1',
    await main.backingManager()
  )
  const rsrTrader = await hre.ethers.getContractAt('RevenueTraderP1', await main.rsrTrader())
  const rsr = await hre.ethers.getContractAt('ERC20Mock', await main.rsr())
  const strsr = await hre.ethers.getContractAt('StRSRP1', await main.stRSR())
  const rsrRatePre = await strsr.exchangeRate()

  const rewards = await claimRewards(backingManager)
  console.log(rewards)
  await backingManager.manageTokens(rewards)
  // for (const reward of rewards) {

  // }
  const comp = '0xc00e94Cb662C3520282E6f5717214004A7f26888'
  const compContract = await hre.ethers.getContractAt('ERC20Mock', comp)

  // fake enough rewards to trade
  await whileImpersonating(hre, '0x2775b1c75658Be0F640272CCb8c72ac986009e38', async (compWhale) => {
    await compContract.connect(compWhale).transfer(rsrTrader.address, fp('1e5'))
  })

  await rsrTrader.manageToken(comp)
  await runTrade(hre, rsrTrader, comp, false)
  await rsrTrader.manageToken(rsr.address)
  await strsr.payoutRewards()
  await advanceBlocks(hre, 100)
  await advanceTime(hre, 1200)
  await strsr.payoutRewards()

  const rsrRatePost = await strsr.exchangeRate()
  if (!rsrRatePost.gt(rsrRatePre)) {
    throw new Error(
      `stRSR rate should have increased. pre: ${formatEther(rsrRatePre)}   post ${formatEther(
        rsrRatePost
      )}`
    )
  }

  console.log('Successfully claimed and distributed RSR rewards')
}