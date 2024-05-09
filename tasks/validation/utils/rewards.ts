import { TradeKind } from '#/common/constants'
import { advanceBlocks, advanceTime } from '#/utils/time'
import { IRewardable } from '@typechain/IRewardable'
import { formatEther } from 'ethers/lib/utils'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { runBatchTrade } from './trades'

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

// Expects RToken was transferred into RSRTrader beforehand
export const processRevenue = async (hre: HardhatRuntimeEnvironment, rtokenAddress: string) => {
  console.log(`\n* * * * * Claiming RSR rewards...`)
  const rToken = await hre.ethers.getContractAt('RTokenP1', rtokenAddress)
  const main = await hre.ethers.getContractAt('IMain', await rToken.main())
  const assetRegistry = await hre.ethers.getContractAt(
    'AssetRegistryP1',
    await main.assetRegistry()
  )
  const backingManager = await hre.ethers.getContractAt(
    'BackingManagerP1',
    await main.backingManager()
  )
  const rsrTrader = await hre.ethers.getContractAt('RevenueTraderP1', await main.rsrTrader())
  const rsr = await hre.ethers.getContractAt('ERC20Mock', await main.rsr())
  const strsr = await hre.ethers.getContractAt('StRSRP1', await main.stRSR())
  const rsrRatePre = await strsr.exchangeRate()

  const [rewards, assets] = await assetRegistry.getRegistry()
  let successCount = 0
  for (let i = 0; i < rewards.length; i++) {
    try {
      await backingManager.claimRewardsSingle(rewards[i])
      successCount++
    } catch (e) {
      console.log(
        `❌ failed to claim rewards for asset ${assets[i]} - review, may be a false positive`
      )
    }
  }
  const emoji = successCount == rewards.length ? '✅' : '❌'
  console.log(
    `${emoji} claimRewardsSingle() was successful for ${successCount}/${rewards.length} assets`
  )
  // await claimRewards(backingManager)

  await backingManager.forwardRevenue(rewards)

  await rsrTrader.manageTokens([rToken.address], [TradeKind.BATCH_AUCTION])
  await runBatchTrade(hre, rsrTrader, rToken.address, false)

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
