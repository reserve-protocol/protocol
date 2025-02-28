import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers'
import { expect } from 'chai'
import { BigNumber, Contract } from 'ethers'
import { parseUnits } from 'ethers/lib/utils'

import { DELAY_UNTIL_DEFAULT, FORK_BLOCK, ORACLE_ERROR, MIDAS_ORACLE_TIMEOUT } from './constants'
import { deployMTBILLCollateralFixture, MTBILLFixtureContext } from './mtbill.fixture'

import { getResetFork } from '../helpers'

import { fp } from '#/common/numbers'
import { whileImpersonating } from '#/test/utils/impersonation'
import { MidasCollateral, IMToken, AccessControlUpgradeable } from '#/typechain'

before(getResetFork(FORK_BLOCK))

describe('MidasCollateral (mTBILL)', () => {
  let mToken: IMToken
  let accessControl: AccessControlUpgradeable
  let mtbillCollateral: MidasCollateral
  let midasAggregator: Contract
  let MTOKEN_ADMIN_ADDRESS: string

  beforeEach(async () => {
    const ctx: MTBILLFixtureContext = await loadFixture(deployMTBILLCollateralFixture)

    mToken = ctx.mToken
    accessControl = ctx.accessControl
    mtbillCollateral = ctx.mtbillCollateral
    midasAggregator = ctx.midasAggregator
    MTOKEN_ADMIN_ADDRESS = ctx.MTOKEN_ADMIN_ADDRESS

    await mtbillCollateral.refresh()
  })

  it('initially SOUND and transitions to IFFY/DISABLED when Midas data feed is stale', async () => {
    // Since {UoA/target}=1, we do not rely on chainlink updates.
    // Collateral is initially SOUND
    expect(await mtbillCollateral.status()).to.equal(0) // SOUND

    // Wait just before Midas feed times out (30 days)
    // 30 days = MIDAS_ORACLE_TIMEOUT = 2592000 seconds
    // We'll go close to that but not past it
    // We don't use ORACLE_BUFFER here because we're not relying on chainlink
    await time.increase(MIDAS_ORACLE_TIMEOUT.sub(BigNumber.from(5)))
    await mtbillCollateral.refresh()
    // Still SOUND since we haven't fully crossed the stale threshold
    expect(await mtbillCollateral.status()).to.equal(0)

    // Advance time slightly to cross the Midas stale threshold
    await time.increase(BigNumber.from(10))
    await mtbillCollateral.refresh()

    // Now the Midas feed is considered stale: status is IFFY
    expect(await mtbillCollateral.status()).to.equal(1) // IFFY

    // After waiting longer than delayUntilDefault without a feed update, status becomes DISABLED
    await time.increase(DELAY_UNTIL_DEFAULT.add(BigNumber.from(10)))
    await mtbillCollateral.refresh()
    expect(await mtbillCollateral.status()).to.equal(2) // DISABLED
  })

  it('IFFY due to Midas staleness and then recovers after Midas update', async () => {
    // Keep waiting until Midas feed goes stale
    await time.increase(MIDAS_ORACLE_TIMEOUT.add(BigNumber.from(10)))
    await mtbillCollateral.refresh()
    expect(await mtbillCollateral.status()).to.equal(1) // IFFY

    // Now update Midas feed
    await whileImpersonating(MTOKEN_ADMIN_ADDRESS, async (adminSigner) => {
      const newPrice = parseUnits('1.0001', 8)
      await midasAggregator.connect(adminSigner).setRoundData(newPrice)
    })

    await mtbillCollateral.refresh()
    // After update, should be SOUND again
    expect(await mtbillCollateral.status()).to.equal(0) // SOUND
  })

  it('becomes IFFY due to Midas staleness and eventually DISABLED without update', async () => {
    // Let the Midas feed become stale
    await time.increase(MIDAS_ORACLE_TIMEOUT.add(BigNumber.from(10)))
    await mtbillCollateral.refresh()
    expect(await mtbillCollateral.status()).to.equal(1) // IFFY

    // Approaching delayUntilDefault - still IFFY
    await time.increase(DELAY_UNTIL_DEFAULT.sub(5))
    expect(await mtbillCollateral.status()).to.equal(1)

    // Do nothing (no Midas update)
    await time.increase(10)
    await mtbillCollateral.refresh()

    // Should now be DISABLED
    expect(await mtbillCollateral.status()).to.equal(2) // DISABLED
  })

  it('price changes if refPerTok (Midas feed) updates', async () => {
    // Initially 1 USD per token
    const targetMtbillPrice = 1.5 // USDC/mTBILL
    const parsedTargetMtbillPrice = parseUnits(targetMtbillPrice.toString(), 8)

    // Update Midas aggregator to reflect higher refPerTok
    await whileImpersonating(MTOKEN_ADMIN_ADDRESS, async (adminSigner) => {
      await midasAggregator.connect(adminSigner).setRoundData(parsedTargetMtbillPrice)
    })

    await mtbillCollateral.refresh()

    const ONE = fp('1') // 1e18
    // {UoA/target}=1, {target/ref}=1, so price(UoA/tok)=refPerTok
    // scale {ref/tok} from 8 decimals to 18 decimals
    const DECIMAL_ADJ = BigNumber.from('10').pow(10) // 10^(18-8)=10^10
    const scaledMtbillPrice = parsedTargetMtbillPrice.mul(DECIMAL_ADJ)

    const p = scaledMtbillPrice // {UoA/tok}
    const err = p.mul(ORACLE_ERROR).div(ONE)
    const predictedLow = p.sub(err)
    const predictedHigh = p.add(err)

    const [low, high] = await mtbillCollateral.price()

    expect(low).to.equal(predictedLow)
    expect(high).to.equal(predictedHigh)
  })

  it('collateral becomes IFFY and eventually DISABLED if Midas feed returns zero price', async () => {
    // 0 price indicates no value
    await whileImpersonating(MTOKEN_ADMIN_ADDRESS, async (adminSigner) => {
      await midasAggregator.connect(adminSigner).setRoundData(parseUnits('0', 8))
    })
    await mtbillCollateral.refresh()
    expect(await mtbillCollateral.status()).to.equal(1) // IFFY

    await time.increase(DELAY_UNTIL_DEFAULT.add(BigNumber.from(1)))
    await mtbillCollateral.refresh()
    expect(await mtbillCollateral.status()).to.equal(2) // DISABLED
  })

  it('if token is paused => IFFY => DISABLED after delay. Unpausing does not restore collateral', async () => {
    // Pause token
    await whileImpersonating(MTOKEN_ADMIN_ADDRESS, async (adminSigner) => {
      const role = await mToken.M_TBILL_PAUSE_OPERATOR_ROLE()
      await accessControl.connect(adminSigner).grantRole(role, adminSigner.address)
      await mToken.connect(adminSigner).pause()
    })

    await mtbillCollateral.refresh()
    expect(await mtbillCollateral.status()).to.equal(1) // IFFY

    await time.increase(DELAY_UNTIL_DEFAULT.add(BigNumber.from(1)))
    await mtbillCollateral.refresh()
    expect(await mtbillCollateral.status()).to.equal(2) // DISABLED

    // Unpause
    await whileImpersonating(MTOKEN_ADMIN_ADDRESS, async (adminSigner) => {
      await mToken.connect(adminSigner).unpause()
    })
    await mtbillCollateral.refresh()
    // Still DISABLED
    expect(await mtbillCollateral.status()).to.equal(2)
  })

  it('refPerTok decreases => immediate DISABLED', async () => {
    // Initially set refPerTok slightly above 1
    await whileImpersonating(MTOKEN_ADMIN_ADDRESS, async (adminSigner) => {
      await midasAggregator.connect(adminSigner).setRoundData(parseUnits('1.0001', 8))
    })
    await mtbillCollateral.refresh()
    const oldRef = await mtbillCollateral.refPerTok()
    expect(oldRef).to.be.closeTo(fp('1.0'), fp('0.0001'))

    await whileImpersonating(MTOKEN_ADMIN_ADDRESS, async (adminSigner) => {
      await midasAggregator.connect(adminSigner).setRoundData(parseUnits('0.9999', 8))
    })
    await mtbillCollateral.refresh()
    // Any drop triggers DISABLED
    expect(await mtbillCollateral.status()).to.equal(2)
  })
})
