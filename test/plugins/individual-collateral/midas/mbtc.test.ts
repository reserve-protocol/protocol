import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers'
import { expect } from 'chai'
import { BigNumber, Contract } from 'ethers'
import { parseUnits } from 'ethers/lib/utils'

import {
  DELAY_UNTIL_DEFAULT,
  FORK_BLOCK,
  ORACLE_ERROR,
  CHAINLINK_ORACLE_TIMEOUT,
  ORACLE_TIMEOUT_BUFFER,
} from './constants'
import { deployMBTCCollateralFixture, MBTCFixtureContext } from './mbtc.fixture'

import { getResetFork } from '../helpers'

import { fp } from '#/common/numbers'
import { whileImpersonating } from '#/test/utils/impersonation'
import { MidasCollateral, MockV3Aggregator, IMToken, AccessControlUpgradeable } from '#/typechain'

before(getResetFork(FORK_BLOCK))

describe('MidasCollateral (mBTC)', () => {
  let mToken: IMToken
  let accessControl: AccessControlUpgradeable
  let mbtcCollateral: MidasCollateral
  let mockBtcAgg: MockV3Aggregator
  let midasAggregator: Contract
  let MTOKEN_ADMIN_ADDRESS: string

  beforeEach(async () => {
    const ctx: MBTCFixtureContext = await loadFixture(deployMBTCCollateralFixture)

    mToken = ctx.mToken
    accessControl = ctx.accessControl
    mbtcCollateral = ctx.mbtcCollateral
    mockBtcAgg = ctx.mockBtcAgg
    midasAggregator = ctx.midasAggregator
    MTOKEN_ADMIN_ADDRESS = ctx.MTOKEN_ADMIN_ADDRESS

    await mbtcCollateral.refresh()
  })

  it('initially SOUND and transitions to IFFY/ DISABLED when Chainlink feed is stale', async () => {
    // This test checks the baseline scenario where the Chainlink feed itself becomes outdated.
    expect(await mbtcCollateral.status()).to.equal(0) // SOUND

    // Move time close to the Chainlink oracle timeout + buffer, but not past it
    await time.increase(CHAINLINK_ORACLE_TIMEOUT.add(ORACLE_TIMEOUT_BUFFER).sub(BigNumber.from(5)))
    await mbtcCollateral.refresh()
    // Still SOUND since we haven't fully crossed the stale threshold
    expect(await mbtcCollateral.status()).to.equal(0)

    // Advance time slightly to cross the stale threshold
    await time.increase(BigNumber.from(10))
    await mbtcCollateral.refresh()

    // Now the Chainlink feed is considered stale: status is IFFY
    expect(await mbtcCollateral.status()).to.equal(1) // IFFY

    // After waiting longer than delayUntilDefault without a feed update, status becomes DISABLED
    await time.increase(DELAY_UNTIL_DEFAULT.add(BigNumber.from(10)))
    await mbtcCollateral.refresh()
    expect(await mbtcCollateral.status()).to.equal(2) // DISABLED
  })

  it('remains SOUND over multiple Chainlink updates but becomes IFFY due to Midas data feed staleness, then recovers after Midas update', async () => {
    // This scenario tests the interaction between the two oracles:
    // - The Chainlink feed (USD/BTC) is updated every 24 hours to remain fresh.
    // - The Midas feed (BTC/mBTC) is never updated, eventually becoming stale after ~30 days.
    // At that point, the collateral becomes IFFY. Once we update the Midas feed, it returns to SOUND.

    // Key insight:
    // Even if Chainlink is perfectly fresh, if Midas feed is stale, collateral cannot be SOUND.

    const NEW_PRICE = 100_100 * 1e8
    for (let i = 1; i <= 30; i++) {
      // Update Chainlink feed every 24 hours
      await time.increase(24 * 60 * 60)
      await mockBtcAgg.updateAnswer(NEW_PRICE + i)
      await mbtcCollateral.refresh()

      const status = await mbtcCollateral.status()
      if (i < 30) {
        // Midas feed not stale yet, Chainlink fresh => SOUND
        expect(status).to.equal(0)
      } else {
        // After 30 days, Midas feed stale => IFFY
        expect(status).to.equal(1)
      }
    }

    // Now update Midas feed to restore normal conditions
    await whileImpersonating(MTOKEN_ADMIN_ADDRESS, async (adminSigner) => {
      await midasAggregator.connect(adminSigner).setRoundData(1e8) // BTC/mBTC updated
    })

    // With both feeds fresh, collateral returns to SOUND
    await mbtcCollateral.refresh()
    expect(await mbtcCollateral.status()).to.equal(0)
  })

  it('remains SOUND over multiple Chainlink updates but becomes IFFY due to Midas staleness and eventually DISABLED without Midas update', async () => {
    // Similar to the previous test, but we never update the Midas feed after it becomes IFFY.
    // Without Midas data feed recovery, after delayUntilDefault passes, collateral goes DISABLED.

    const NEW_PRICE = 100_100 * 1e8
    for (let i = 1; i <= 30; i++) {
      await time.increase(24 * 60 * 60)
      await mockBtcAgg.updateAnswer(NEW_PRICE + i)
      await mbtcCollateral.refresh()

      const status = await mbtcCollateral.status()
      if (i < 30) {
        expect(status).to.equal(0) // SOUND before Midas stale
      } else {
        expect(status).to.equal(1) // IFFY at day 30
      }
    }

    // Approaching delayUntilDefault - still IFFY
    await time.increase(DELAY_UNTIL_DEFAULT.sub(5))
    expect(await mbtcCollateral.status()).to.equal(1)

    // Updating Chainlink alone does nothing if Midas is stale
    await mockBtcAgg.updateAnswer(NEW_PRICE + 31)
    await mbtcCollateral.refresh()
    expect(await mbtcCollateral.status()).to.equal(1) // Still IFFY

    // After delay passes without Midas fix, goes DISABLED
    await time.increase(10)
    expect(await mbtcCollateral.status()).to.equal(2)
  })

  it('price should change if feed updates', async () => {
    const targetBtcPrice = 250_000 // USD/BTC
    const parsedTargetBtcPrice = parseUnits(targetBtcPrice.toString(), 8)
    await mockBtcAgg.updateAnswer(parsedTargetBtcPrice)

    const targetMbtcPrice = 3 // BTC/mBTC
    const parsedTargetMbtcPrice = parseUnits(targetMbtcPrice.toString(), 8)
    await whileImpersonating(MTOKEN_ADMIN_ADDRESS, async (adminSigner) => {
      await midasAggregator.connect(adminSigner).setRoundData(parsedTargetMbtcPrice)
    })

    await mbtcCollateral.refresh()

    // Scale from 8 decimals to 18 decimals
    const DECIMAL_ADJ = BigNumber.from('10').pow(18 - 8) // 10^(18-8)=10^10
    const scaledBtcPrice = parsedTargetBtcPrice.mul(DECIMAL_ADJ) // {UoA/target} in 1e18
    const scaledMbtcPrice = parsedTargetMbtcPrice.mul(DECIMAL_ADJ) // {ref/tok} in 1e18

    const ONE = fp('1') // 1e18
    const predictedPrice = scaledBtcPrice.mul(scaledMbtcPrice).div(ONE) // (UoA/target * ref/tok) with 1e18 scale

    const err = predictedPrice.mul(ORACLE_ERROR).div(ONE)
    const predictedLow = predictedPrice.sub(err)
    const predictedHigh = predictedPrice.add(err)

    const [low, high] = await mbtcCollateral.price()

    expect(low).to.equal(predictedLow)
    expect(high).to.equal(predictedHigh)
  })

  it('collateral becomes IFFY and eventually DISABLED if chainlink returns zero price', async () => {
    // A zero price is a direct sign of malfunctioning or worthless collateral.
    // Immediately upon seeing zero, collateral is IFFY and if not rectified, it goes DISABLED.

    await mockBtcAgg.updateAnswer('0')
    await mbtcCollateral.refresh()
    expect(await mbtcCollateral.status()).to.equal(1) // IFFY

    await time.increase(DELAY_UNTIL_DEFAULT.add(BigNumber.from(1)))
    await mbtcCollateral.refresh()
    expect(await mbtcCollateral.status()).to.equal(2) // DISABLED
  })

  it('once DISABLED due to paused state, unpausing token does not restore collateral', async () => {
    // If the token is paused, collateral goes IFFY and then after delayUntilDefault becomes DISABLED.
    // Once DISABLED, nothing can restore it, not even unpausing the token.

    // Pause token
    await whileImpersonating(MTOKEN_ADMIN_ADDRESS, async (adminSigner) => {
      const role = await mToken.M_BTC_PAUSE_OPERATOR_ROLE()
      await accessControl.connect(adminSigner).grantRole(role, adminSigner.address)
      await mToken.connect(adminSigner).pause()
    })

    await mbtcCollateral.refresh()
    expect(await mbtcCollateral.status()).to.equal(1) // IFFY

    await time.increase(DELAY_UNTIL_DEFAULT.add(BigNumber.from(1)))
    await mbtcCollateral.refresh()
    expect(await mbtcCollateral.status()).to.equal(2) // DISABLED

    // Unpausing won't help once disabled
    await whileImpersonating(MTOKEN_ADMIN_ADDRESS, async (adminSigner) => {
      await mToken.connect(adminSigner).unpause()
    })
    await mbtcCollateral.refresh()
    expect(await mbtcCollateral.status()).to.equal(2) // Still DISABLED
  })

  it('refPerTok decreases below previous values => immediate DISABLED', async () => {
    // Any decrease in refPerTok() should cause immediate DISABLED status, even if small.
    // This simulates the scenario where underlying redemption value drops, indicating a clear default event.

    // Set refPerTok slightly above 1 initially
    await whileImpersonating(MTOKEN_ADMIN_ADDRESS, async (adminSigner) => {
      await midasAggregator.connect(adminSigner).setRoundData(parseUnits('1.0001', 8))
    })
    await mbtcCollateral.refresh()
    const oldRef = await mbtcCollateral.refPerTok()
    expect(oldRef).to.be.closeTo(fp('1.0'), fp('0.0001'))

    // Now set refPerTok to a lower value - immediate DISABLE
    await whileImpersonating(MTOKEN_ADMIN_ADDRESS, async (adminSigner) => {
      await midasAggregator.connect(adminSigner).setRoundData(parseUnits('0.9999', 8))
    })
    await mbtcCollateral.refresh()
    expect(await mbtcCollateral.status()).to.equal(2)
  })
})
