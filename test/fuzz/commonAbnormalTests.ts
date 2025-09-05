import { expect } from 'chai'
import { MainP1Fuzz } from '@typechain/MainP1Fuzz'
import { Wallet, Signer } from 'ethers'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { fp } from '#/common/numbers'
import { RoundingMode, TradeStatus, CollateralStatus } from '../../common/constants'
import {
  AbnormalScenario,
  Components,
  ConAt,
  FuzzTestContext,
  FuzzTestFixture,
  PriceModelKind,
  exa,
} from './common'
import { whileImpersonating } from '../utils/impersonation'
import { advanceTime } from '../utils/time'
import { RebalancingScenario } from '@typechain/RebalancingScenario'
import { ChaosOpsScenario } from '@typechain/ChaosOpsScenario'

export default function fn<X extends FuzzTestFixture>(context: FuzzTestContext<X>) {
  describe(`${context.testType} Fuzz Tests (Abnormal Tests)`, () => {
    let scenario: AbnormalScenario
    let main: MainP1Fuzz
    let comp: Components

    let owner: Wallet
    let alice: Signer
    let bob: Signer
    let carol: Signer

    let aliceAddr: string
    let bobAddr: string
    let carolAddr: string

    let collaterals: string[]
    let rewards: string[]
    let stables: string[]

    // addrIDs: maps addresses to their address IDs. Inverse of main.someAddr.
    // for any addr the system tracks, main.someAddr(addrIDs(addr)) == addr
    let addrIDs: Map<string, number>

    // tokenIDs: maps token symbols to their token IDs.
    // for any token symbol in the system, main.someToken(tokenIDs(symbol)).symbol() == symbol
    let tokenIDs: Map<string, number>

    let warmup: () => void

    let numTokens: number

    beforeEach(async () => {
      const f = await loadFixture(context.f)
      scenario = f.scenario as RebalancingScenario | ChaosOpsScenario
      main = f.main
      comp = f.comp
      owner = f.owner
      alice = f.alice
      bob = f.bob
      carol = f.carol
      aliceAddr = f.aliceAddr
      bobAddr = f.bobAddr
      carolAddr = f.carolAddr
      addrIDs = f.addrIDs
      tokenIDs = f.tokenIDs
      warmup = f.warmup
      collaterals = f.collaterals
      rewards = f.rewards
      stables = f.stables
      numTokens = collaterals.length + rewards.length + stables.length
    })

    it('can refresh assets', async () => {
      const numTokens = await main.numTokens()

      // Check all collateral is sound - update prices - some should be marked IFFY or DISABLED
      for (let i = 0; numTokens.gt(i); i++) {
        const token = await main.someToken(i)

        const asset = await ConAt('IAsset', await comp.assetRegistry.toAsset(token))
        const isCollateral: boolean = await asset.isCollateral()

        if (isCollateral) {
          const coll = await ConAt('CollateralMock', asset.address)
          expect(await coll.status()).to.equal(CollateralStatus.SOUND)

          // Update price (force depeg)
          await scenario.updatePrice(i, 0, 0, exa, exa)
        }
      }

      // Refresh assets
      await scenario.refreshAssets()

      // Check CA1, CB1, and CC1 are IFFY
      // Check CA2, CB2, and CC2 are DISABLED
      for (let i = 0; numTokens.gt(i); i++) {
        const token = await main.someToken(i)
        const erc20 = await ConAt('ERC20Fuzz', token)
        const asset = await ConAt('IAsset', await comp.assetRegistry.toAsset(token))
        const isCollateral: boolean = await asset.isCollateral()

        if (isCollateral) {
          const coll = await ConAt('CollateralMock', asset.address)
          const sym = await erc20.symbol()
          if (['CA1', 'CB1', 'CC1'].indexOf(sym) > -1) {
            expect(await coll.status()).to.equal(CollateralStatus.IFFY)
          } else if (['CA2', 'CB2', 'CC2'].indexOf(sym) > -1) {
            expect(await coll.status()).to.equal(CollateralStatus.DISABLED)
          } else {
            expect(await coll.status()).to.equal(CollateralStatus.SOUND)
          }
        }
      }
    })

    it('can set prime basket and refresh', async () => {
      // Check current basket
      const [tokenAddrs] = await comp.basketHandler['quote(uint192,bool,uint8)'](1n * exa, true, RoundingMode.CEIL)

      expect(tokenAddrs.length).to.equal(9)

      const token0 = await ConAt('ERC20Fuzz', tokenAddrs[0])
      const token1 = await ConAt('ERC20Fuzz', tokenAddrs[1])
      const token2 = await ConAt('ERC20Fuzz', tokenAddrs[2])
      const token3 = await ConAt('ERC20Fuzz', tokenAddrs[3])
      const token4 = await ConAt('ERC20Fuzz', tokenAddrs[4])
      const token5 = await ConAt('ERC20Fuzz', tokenAddrs[5])
      const token6 = await ConAt('ERC20Fuzz', tokenAddrs[6])
      const token7 = await ConAt('ERC20Fuzz', tokenAddrs[7])
      const token8 = await ConAt('ERC20Fuzz', tokenAddrs[8])

      const expectedSyms = ['CA0', 'CA1', 'CA2', 'CB0', 'CB1', 'CB2', 'CC0', 'CC1', 'CC2']
      expect(await token0.symbol()).to.equal(expectedSyms[0])
      expect(await token1.symbol()).to.equal(expectedSyms[1])
      expect(await token2.symbol()).to.equal(expectedSyms[2])
      expect(await token3.symbol()).to.equal(expectedSyms[3])
      expect(await token4.symbol()).to.equal(expectedSyms[4])
      expect(await token5.symbol()).to.equal(expectedSyms[5])
      expect(await token6.symbol()).to.equal(expectedSyms[6])
      expect(await token7.symbol()).to.equal(expectedSyms[7])
      expect(await token8.symbol()).to.equal(expectedSyms[8])

      // Update backing for prime basket
      await scenario.pushBackingForPrimeBasket(tokenIDs.get('CA1') as number, fp('0.4').sub(1))
      await scenario.pushBackingForPrimeBasket(tokenIDs.get('CB1') as number, fp('0.3').sub(1))
      await scenario.pushBackingForPrimeBasket(tokenIDs.get('CC1') as number, fp('0.3').sub(1))

      await scenario.setPrimeBasket()

      // Refresh basket to be able to see updated config
      await comp.basketHandler.savePrev()
      await scenario.refreshBasket()

      const [newTokenAddrs, amts] = await comp.basketHandler['quote(uint192,bool,uint8)'](1n * exa, true, RoundingMode.CEIL)
      expect(await comp.basketHandler.prevEqualsCurr()).to.be.false
      expect(newTokenAddrs.length).to.equal(3)

      const tokenInBasket = await ConAt('ERC20Fuzz', newTokenAddrs[0])
      expect(await tokenInBasket.symbol()).to.equal('CA1')
      // 1/1,000,000% revenue hiding
      expect(amts[0]).to.closeTo(fp('0.4000004'), fp('0.0000001'))
      expect(amts[1]).to.closeTo(fp('0.3000003'), fp('0.0000001'))
      expect(amts[2]).to.closeTo(fp('0.3000003'), fp('0.0000001'))
    })

    it('can set backup basket and refresh', async () => {
      // Update backing for Backup basket - Both from target A (0)
      await scenario.pushBackingForBackup(tokenIDs.get('SA2') as number)
      await scenario.pushBackingForBackup(tokenIDs.get('SA1') as number)

      await scenario.pushBackingForBackup(tokenIDs.get('SB2') as number)
      await scenario.pushBackingForBackup(tokenIDs.get('SC2') as number)

      // Remove the last one added for Targer A ('SA1')
      await scenario.popBackingForBackup(0)

      // Set backup config for each target type - Just SA2, SB2, SC2
      await scenario.setBackupConfig(0)
      await scenario.setBackupConfig(1)
      await scenario.setBackupConfig(2)

      // Default token and refresh basket
      await comp.basketHandler.savePrev()

      // Default one token in prime basket of targets A, B, C
      await scenario.updatePrice(0, 0, fp(1), fp(1), fp(1))
      await scenario.updatePrice(2, 0, fp(1), fp(1), fp(1))
      await scenario.updatePrice(4, 0, fp(1), fp(1), fp(1)) // Will default CA2
      await scenario.updatePrice(12, 0, fp(1), fp(1), fp(1)) // Will default CB2
      await scenario.updatePrice(20, 0, fp(1), fp(1), fp(1)) // Will default CC2

      await scenario.refreshBasket()

      // Check new basket
      const [newTokenAddrs, amts] = await comp.basketHandler['quote(uint192,bool,uint8)'](1n * exa, true, RoundingMode.CEIL)
      expect(await comp.basketHandler.prevEqualsCurr()).to.be.false
      expect(newTokenAddrs.length).to.equal(9)

      const token0 = await ConAt('ERC20Fuzz', newTokenAddrs[0])
      const token1 = await ConAt('ERC20Fuzz', newTokenAddrs[1])
      const token2 = await ConAt('ERC20Fuzz', newTokenAddrs[2])
      const token3 = await ConAt('ERC20Fuzz', newTokenAddrs[3])
      const token4 = await ConAt('ERC20Fuzz', newTokenAddrs[4])
      const token5 = await ConAt('ERC20Fuzz', newTokenAddrs[5])
      const token6 = await ConAt('ERC20Fuzz', newTokenAddrs[6])
      const token7 = await ConAt('ERC20Fuzz', newTokenAddrs[7])
      const token8 = await ConAt('ERC20Fuzz', newTokenAddrs[8])

      // CA2 was replaced by SA2
      const expectedSyms = ['CA0', 'CA1', 'CB0', 'CB1', 'CC0', 'CC1', 'SA2', 'SB2', 'SC2']
      expect(await token0.symbol()).to.equal(expectedSyms[0])
      expect(await token1.symbol()).to.equal(expectedSyms[1])
      expect(await token2.symbol()).to.equal(expectedSyms[2])
      expect(await token3.symbol()).to.equal(expectedSyms[3])
      expect(await token4.symbol()).to.equal(expectedSyms[4])
      expect(await token5.symbol()).to.equal(expectedSyms[5])
      expect(await token6.symbol()).to.equal(expectedSyms[6])
      expect(await token7.symbol()).to.equal(expectedSyms[7])
      expect(await token8.symbol()).to.equal(expectedSyms[8])

      // Check correct weights assigned for new added tokens
      // 1/1,000,000% revenue hiding
      expect(amts[6]).to.eq(fp('0.1'))
      expect(amts[7]).to.eq(fp('0.1'))
      expect(amts[8]).to.eq(fp('0.1'))
    })

    it('can handle freezing/pausing with roles', async () => {
      await warmup()
      // Check initial status
      expect(await main.tradingPaused()).to.equal(false)
      expect(await main.issuancePaused()).to.equal(false)
      expect(await main.frozen()).to.equal(false)

      //================= Pause Trading =================
      // Attempt to pause and freeze with non-approved user
      await expect(scenario.connect(alice).pauseTrading()).to.be.reverted
      await expect(scenario.connect(bob).pauseTrading()).to.be.reverted
      await expect(scenario.connect(carol).pauseTrading()).to.be.reverted

      // Grant role PAUSER (3) to Alice
      await scenario.grantRole(3, 0)
      await scenario.connect(alice).pauseTrading()

      // Check status
      expect(await main.tradingPaused()).to.equal(true)

      // Unpause and revoke role
      await scenario.connect(alice).unpauseTrading()
      await scenario.revokeRole(3, 0)

      expect(await main.tradingPaused()).to.equal(false)

      //================= Pause Issuance =================
      // Attempt to pause and freeze with non-approved user
      await expect(scenario.connect(alice).pauseIssuance()).to.be.reverted
      await expect(scenario.connect(bob).pauseIssuance()).to.be.reverted
      await expect(scenario.connect(carol).pauseIssuance()).to.be.reverted

      // Grant role PAUSER (3) to Alice
      await scenario.grantRole(3, 0)
      await scenario.connect(alice).pauseIssuance()

      // Check status
      expect(await main.issuancePaused()).to.equal(true)

      // Unpause and revoke role
      await scenario.connect(alice).unpauseIssuance()
      await scenario.revokeRole(3, 0)

      expect(await main.issuancePaused()).to.equal(false)

      // ==========  SHORT FREEZE  =================
      expect(await main.frozen()).to.equal(false)

      // Attempt to freeze will fail
      await expect(scenario.connect(alice).freezeShort()).to.be.reverted
      await expect(scenario.connect(bob).freezeShort()).to.be.reverted
      await expect(scenario.connect(carol).freezeShort()).to.be.reverted

      // Grant role SHORT FREEZER (1) to Bob
      await scenario.grantRole(1, 1)
      await scenario.connect(bob).freezeShort()
      await scenario.revokeRole(1, 1)

      // Check status
      expect(await main.frozen()).to.equal(true)

      // Only owner can unfreeze - Call with Carol as owner
      await scenario.grantRole(0, 2)
      await scenario.connect(carol).unfreeze()
      await scenario.revokeRole(0, 2)

      expect(await main.frozen()).to.equal(false)

      // ==========  LONG FREEZE  =================
      // Attempt to freeze will fail
      await expect(scenario.connect(alice).freezeLong()).to.be.reverted
      await expect(scenario.connect(bob).freezeLong()).to.be.reverted
      await expect(scenario.connect(carol).freezeLong()).to.be.reverted

      // Grant role LONG FREEZER (2) to Carol
      await scenario.grantRole(2, 2)
      await scenario.connect(carol).freezeLong()
      await scenario.revokeRole(2, 2)

      // Check status
      expect(await main.frozen()).to.equal(true)

      // Only owner can unfreeze - Call with bob as owner
      await scenario.grantRole(0, 1)
      await scenario.connect(bob).unfreeze()
      await scenario.revokeRole(0, 1)
      expect(await main.frozen()).to.equal(false)

      // ==========  FREZE FOREVER  =================
      // Attempt to freeze will fail
      await expect(scenario.connect(alice).freezeForever()).to.be.reverted
      await expect(scenario.connect(bob).freezeForever()).to.be.reverted
      await expect(scenario.connect(carol).freezeForever()).to.be.reverted

      // Grant role OWNER (0) to Alice
      await scenario.grantRole(0, 0)
      await scenario.connect(alice).freezeForever()
      // Check status
      expect(await main.frozen()).to.equal(true)

      // Only owner can unfreeze
      await scenario.connect(alice).unfreeze()
      await scenario.revokeRole(0, 0)
      expect(await main.frozen()).to.equal(false)
    })

    it('can create Price Models', async () => {
      await scenario.pushPriceModel(0, fp('1'), fp('0.95'), fp('1.5'))
      await scenario.pushPriceModel(1, fp('1000'), fp('1'), fp('1'))
      await scenario.pushPriceModel(2, fp('500000'), fp('500000'), fp('50000'))
      await scenario.pushPriceModel(3, fp('0.5'), fp('0'), fp('0.8'))

      // Check created price models
      const p0 = await scenario.priceModels(0)
      expect(p0.kind).to.equal(PriceModelKind.CONSTANT)
      expect(p0.curr).to.equal(fp('1'))
      expect(p0.low).to.equal(fp('0.95'))
      expect(p0.high).to.equal(p0.curr.add(fp('1.5')))

      const p1 = await scenario.priceModels(1)
      expect(p1.kind).to.equal(PriceModelKind.MANUAL)
      expect(p1.curr).to.equal(fp('1000'))
      expect(p1.low).to.equal(fp('1'))
      expect(p1.high).to.equal(p1.curr.add(fp('1')))

      const p2 = await scenario.priceModels(2)
      expect(p2.kind).to.equal(PriceModelKind.BAND)
      expect(p2.curr).to.equal(fp('500000'))
      expect(p2.low).to.equal(fp('500000'))
      expect(p2.high).to.equal(p2.curr.add(fp('50000')))

      const p3 = await scenario.priceModels(3)
      expect(p3.kind).to.equal(PriceModelKind.WALK)
      expect(p3.curr).to.equal(fp('0.5'))
      expect(p3.low).to.equal(0)
      expect(p3.high).to.equal(p3.curr.add(fp('0.8')))
    })

    it('can perform a recollateralization', async () => {
      await warmup()

      // Recharge throttle
      await advanceTime(3600)

      const c0 = await ConAt('ERC20Fuzz', await main.tokenBySymbol('CA0'))
      const c2 = await ConAt('ERC20Fuzz', await main.tokenBySymbol('CA2'))

      // Setup backup
      await scenario.pushBackingForBackup(tokenIDs.get('CA0') as number)
      await scenario.setBackupConfig(0)

      // Setup a new basket
      await scenario.pushBackingForPrimeBasket(tokenIDs.get('CA1') as number, fp('0.2').sub(1))
      await scenario.pushBackingForPrimeBasket(tokenIDs.get('CB0') as number, fp('0.3').sub(1))
      await scenario.pushBackingForPrimeBasket(tokenIDs.get('CC0') as number, fp('0.3').sub(1))
      await scenario.pushBackingForPrimeBasket(tokenIDs.get('CA2') as number, fp('0.2').sub(1))
      await scenario.forceSetPrimeBasket()

      // Switch basket
      await scenario.refreshBasket()

      // Issue some RTokens
      // As Alice, make allowances
      const [tokenAddrs, amts] = await comp.rToken.quote(150000n * exa, RoundingMode.CEIL)
      for (let i = 0; i < amts.length; i++) {
        const token = await ConAt('ERC20Fuzz', tokenAddrs[i])
        await token.connect(alice).approve(comp.rToken.address, amts[i])
      }
      // Issue RTokens
      await scenario.connect(alice).justIssue(150000n * exa)

      // No c0 tokens in backing manager
      expect(await c0.balanceOf(comp.backingManager.address)).to.equal(0)

      // Stake RSR
      await scenario.connect(alice).stake(100000n * exa)

      // Default one token in the basket CA2
      const defaultTokenId = Number(tokenIDs.get('CA2'))
      const coll = await ConAt('CollateralMock', await comp.assetRegistry.toColl(c2.address))
      expect(await coll.status()).to.equal(CollateralStatus.SOUND)
      expect(await comp.basketHandler.fullyCollateralized()).to.equal(true)

      await scenario.updatePrice(defaultTokenId, 0, fp(1), fp(1), fp(1)) // Will default CA2

      // Call main poke to perform refresh on assets
      await scenario.poke()

      // Collateral defaulted
      expect(await coll.status()).to.equal(CollateralStatus.DISABLED)
      expect(await comp.basketHandler.fullyCollateralized()).to.equal(false)

      // Trying to manage tokens will fail due to unsound basket
      await scenario.pushBackingToManage(2)
      await scenario.pushBackingToManage(4)
      // BATCH_AUCTION
      await expect(scenario.rebalance(1)).to.be.reverted

      // Refresh basket - will perform basket switch - New basket: CA1 and CA0
      await scenario.refreshBasket()

      // Manage backing tokens, will create auction
      await warmup()
      await scenario.rebalance(1) // BATCH_AUCTION

      // Check trade
      const tradeInBackingManager = await ConAt(
        'GnosisTradeMock',
        await comp.backingManager.trades(c2.address)
      )
      const tradeInBroker = await ConAt('GnosisTradeMock', await comp.broker.lastOpenedTrade())
      expect(tradeInBackingManager.address).to.equal(tradeInBroker.address)

      expect(await tradeInBackingManager.status()).to.equal(TradeStatus.OPEN)
      expect(await tradeInBackingManager.canSettle()).to.be.false

      // All defaulted tokens moved to trader
      expect(await c2.balanceOf(comp.backingManager.address)).to.equal(0)
      expect(await c2.balanceOf(tradeInBackingManager.address)).to.be.gt(0)

      // Wait and settle the trade
      await advanceTime(await comp.broker.batchAuctionLength())
      expect(await tradeInBackingManager.canSettle()).to.be.true

      // No C0 tokens in backing manager
      expect(await c0.balanceOf(comp.backingManager.address)).to.equal(0)

      // Settle trades - set some seed > 0
      await scenario.pushSeedForTrades(fp(1000000))
      await scenario.settleTrades()

      expect(await tradeInBackingManager.status()).to.equal(TradeStatus.CLOSED)

      // Check balances after
      expect(await c2.balanceOf(tradeInBackingManager.address)).to.equal(0)
      expect(await c0.balanceOf(comp.backingManager.address)).to.be.gt(0)
    })

    it('does not fail on refreshBasket after just one call to updatePrice', async () => {
      await scenario.updatePrice(0, 0, 0, 0, 0)

      // emulate echidna_refreshBasketIsNoop, since it's not a view and we need its value
      await comp.basketHandler.savePrev()
      await whileImpersonating(scenario.address, async (asOwner) => {
        await comp.basketHandler.connect(asOwner).refreshBasket()
      })
      expect(await comp.basketHandler.prevEqualsCurr()).to.be.true
    })

    it('maintains stRSR invariants after seizing RSR', async () => {
      await scenario.connect(alice).stake(4)
      await scenario.seizeRSR(1)
      expect(await scenario.echidna_stRSRInvariants()).to.be.true
    })

    /* deprecated 3.0.0
     *
    it('maintains RToken invariants after calling issue', async () => {
      await warmup()
      // As Alice, make allowances
      const [tokenAddrs, amts] = await comp.rToken.quote(20000n * exa, RoundingMode.CEIL)
      for (let i = 0; i < amts.length; i++) {
        const token = await ConAt('ERC20Fuzz', tokenAddrs[i])
        await token.connect(alice).approve(comp.rToken.address, amts[i])
      }
      // Issue RTokens and succeed
      await scenario.connect(alice).justIssue(20000n * exa)

      expect(await scenario.echidna_rTokenInvariants()).to.be.true
    })
    *
    */

    it('does not have the backingManager double-revenue bug', async () => {
      await warmup()
      // Have some RToken in existance
      await scenario.connect(alice).issue(1e6)

      // cause C0 to grow against its ref unit
      await scenario.updatePrice(0, fp(1.1), 0, 0, fp(1))

      // call manageTokens([C0, C0])
      await scenario.pushBackingToManage(0)
      await scenario.pushBackingToManage(0)
      await expect(scenario.forwardRevenue()).to.be.reverted
    })

    // after('stop impersonations', async () => {
    //   await stopImpersonatingAccount(aliceAddr)
    //   await stopImpersonatingAccount(bobAddr)
    //   await stopImpersonatingAccount(carolAddr)
    //   await stopImpersonatingAccount(main.address)
    // })
  })
}
