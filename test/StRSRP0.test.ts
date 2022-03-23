import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { signERC2612Permit } from 'eth-permit'
import { BigNumber, Wallet } from 'ethers'
import hre, { ethers, waffle } from 'hardhat'
import { getChainId } from '../common/blockchain-utils'
import { bn, fp, near } from '../common/numbers'
import {
  AaveOracleMock,
  AssetRegistryP0,
  BackingManagerP0,
  BasketHandlerP0,
  CTokenMock,
  DistributorP0,
  ERC20Mock,
  FacadeP0,
  MainP0,
  IRToken,
  StaticATokenMock,
  IStRSR,
} from '../typechain'
import { CollateralStatus, ZERO_ADDRESS } from '../common/constants'
import { advanceTime, getLatestBlockTimestamp } from './utils/time'
import { whileImpersonating } from './utils/impersonation'
import { Collateral, defaultFixture, IConfig, Implementation, IMPLEMENTATION } from './fixtures'
import { makeDecayFn, calcErr } from './utils/rewards'

const createFixtureLoader = waffle.createFixtureLoader

describe('StRSR contract', () => {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress
  let addr2: SignerWithAddress
  let addr3: SignerWithAddress
  let other: SignerWithAddress

  // RSR
  let rsr: ERC20Mock

  // Main
  let main: MainP0
  let assetRegistry: AssetRegistryP0
  let backingManager: BackingManagerP0
  let basketHandler: BasketHandlerP0
  let distributor: DistributorP0
  let rToken: IRToken
  let facade: FacadeP0

  // StRSR
  let stRSR: IStRSR

  // Tokens/Assets
  let token0: ERC20Mock
  let token1: ERC20Mock
  let token2: StaticATokenMock
  let token3: CTokenMock
  let collateral0: Collateral
  let collateral1: Collateral
  let collateral2: Collateral
  let collateral3: Collateral

  // Aave/ Compound
  let aaveOracleInternal: AaveOracleMock

  // Config
  let config: IConfig

  // Basket
  let basket: Collateral[]
  let basketsNeededAmts: BigNumber[]

  // Quantities
  let initialBal: BigNumber

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  before('create fixture loader', async () => {
    ;[wallet] = await (ethers as any).getSigners()
    loadFixture = createFixtureLoader([wallet])
  })

  beforeEach(async () => {
    ;[owner, addr1, addr2, addr3, other] = await ethers.getSigners()

    // Deploy fixture
    ;({
      rsr,
      stRSR,
      aaveOracleInternal,
      basket,
      basketsNeededAmts,
      config,
      main,
      assetRegistry,
      backingManager,
      basketHandler,
      distributor,
      rToken,
      facade,
    } = await loadFixture(defaultFixture))

    // Mint initial amounts of RSR
    initialBal = bn('10000e18')
    await rsr.connect(owner).mint(addr1.address, initialBal)
    await rsr.connect(owner).mint(addr2.address, initialBal)
    await rsr.connect(owner).mint(addr3.address, initialBal)
    await rsr.connect(owner).mint(owner.address, initialBal)

    // Get assets and tokens
    ;[collateral0, collateral1, collateral2, collateral3] = basket

    token0 = <ERC20Mock>await ethers.getContractAt('ERC20Mock', await collateral0.erc20())
    token1 = <ERC20Mock>await ethers.getContractAt('ERC20Mock', await collateral1.erc20())
    token2 = <StaticATokenMock>(
      await ethers.getContractAt('StaticATokenMock', await collateral2.erc20())
    )
    token3 = <CTokenMock>await ethers.getContractAt('CTokenMock', await collateral3.erc20())
  })

  describe('Deployment', () => {
    it('Should setup initial addresses and values correctly', async () => {
      expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
      expect(await stRSR.balanceOf(owner.address)).to.equal(0)
      expect(await stRSR.balanceOf(addr1.address)).to.equal(0)
      expect(await stRSR.balanceOf(addr2.address)).to.equal(0)

      // ERC20
      expect(await stRSR.name()).to.equal('stRTKNRSR Token')
      expect(await stRSR.symbol()).to.equal('stRTKNRSR')
      expect(await stRSR.decimals()).to.equal(18)
      expect(await stRSR.totalSupply()).to.equal(0)

      expect(await stRSR.exchangeRate()).to.equal(fp('1'))
      expect(await stRSR.unstakingDelay()).to.equal(config.unstakingDelay)
      expect(await stRSR.rewardPeriod()).to.equal(config.rewardPeriod)
      expect(await stRSR.rewardRatio()).to.equal(config.rewardRatio)
    })

    it('Should setup the DomainSeparator for Permit correctly', async () => {
      const chainId = await getChainId(hre)
      const _name = await stRSR.name()
      const version = '1'
      const verifyingContract = stRSR.address
      expect(await stRSR.DOMAIN_SEPARATOR()).to.equal(
        await ethers.utils._TypedDataEncoder.hashDomain({
          name: _name,
          version,
          chainId,
          verifyingContract,
        })
      )
    })
  })

  describe('Configuration / State', () => {
    it('Should allow to update unstakingDelay if Owner and perform validations', async () => {
      // Setup a new value
      const newUnstakingDelay: BigNumber = config.rewardPeriod.mul(2).add(1000)

      await expect(stRSR.connect(owner).setUnstakingDelay(newUnstakingDelay))
        .to.emit(stRSR, 'UnstakingDelaySet')
        .withArgs(config.unstakingDelay, newUnstakingDelay)

      expect(await stRSR.unstakingDelay()).to.equal(newUnstakingDelay)

      // Try to update again if not owner
      await expect(stRSR.connect(addr1).setUnstakingDelay(bn('500'))).to.be.revertedWith(
        'Component: caller is not the owner'
      )

      // Cannot update with invalid unstaking delay
      await expect(stRSR.connect(owner).setUnstakingDelay(config.rewardPeriod)).to.be.revertedWith(
        'unstakingDelay/rewardPeriod incompatible'
      )
    })

    it('Should allow to update rewardPeriod if Owner and perform validations', async () => {
      // Setup a new value
      const newRewardPeriod: BigNumber = bn('100000')

      await expect(stRSR.connect(owner).setRewardPeriod(newRewardPeriod))
        .to.emit(stRSR, 'RewardPeriodSet')
        .withArgs(config.rewardPeriod, newRewardPeriod)

      expect(await stRSR.rewardPeriod()).to.equal(newRewardPeriod)

      // Try to update again if not owner
      await expect(stRSR.connect(addr1).setRewardPeriod(bn('500'))).to.be.revertedWith(
        'Component: caller is not the owner'
      )

      // Cannot update with invalid reward period
      await expect(stRSR.connect(owner).setRewardPeriod(config.unstakingDelay)).to.be.revertedWith(
        'unstakingDelay/rewardPeriod incompatible'
      )
    })

    it('Should allow to update rewardRatio if Owner', async () => {
      // Setup a new value
      const newRatio: BigNumber = bn('100000')

      await expect(stRSR.connect(owner).setRewardRatio(newRatio))
        .to.emit(stRSR, 'RewardRatioSet')
        .withArgs(stRSR.rewardRatio, newRatio)

      expect(await stRSR.rewardRatio()).to.equal(newRatio)

      // Try to update again if not owner
      await expect(stRSR.connect(addr1).setRewardRatio(bn('0'))).to.be.revertedWith(
        'Component: caller is not the owner'
      )
    })
  })

  describe('Deposits/Staking', () => {
    it('Should not allow to stake amount = 0', async () => {
      // Perform stake
      const amount: BigNumber = bn('1000e18')
      const zero: BigNumber = bn(0)

      // Approve transfer and stake
      await rsr.connect(addr1).approve(stRSR.address, amount)
      await expect(stRSR.connect(addr1).stake(zero)).to.be.revertedWith('Cannot stake zero')

      // Check deposit not registered
      expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
      expect(await rsr.balanceOf(stRSR.address)).to.equal(await stRSR.totalSupply())
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal)
      expect(await stRSR.balanceOf(addr1.address)).to.equal(0)
    })

    it('Should not allow to stake if Main is Paused', async () => {
      // Perform stake
      const amount: BigNumber = bn('1000e18')

      // Pause Main
      await main.connect(owner).pause()

      // Approve transfer and stake
      await rsr.connect(addr1).approve(stRSR.address, amount)
      await expect(stRSR.connect(addr1).stake(amount)).to.be.revertedWith('main paused')

      // Check deposit not registered
      expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
      expect(await rsr.balanceOf(stRSR.address)).to.equal(await stRSR.totalSupply())
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal)
      expect(await stRSR.balanceOf(addr1.address)).to.equal(0)
    })

    it('Should allow to stake/deposit in RSR', async () => {
      // Perform stake
      const amount: BigNumber = bn('1000e18')

      // Approve transfer and stake
      await rsr.connect(addr1).approve(stRSR.address, amount)
      await expect(stRSR.connect(addr1).stake(amount))
        .to.emit(stRSR, 'Staked')
        .withArgs(addr1.address, amount, amount)

      // Check balances and stakes
      expect(await rsr.balanceOf(stRSR.address)).to.equal(amount)
      expect(await rsr.balanceOf(stRSR.address)).to.equal(await stRSR.totalSupply())
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(amount))
      expect(await stRSR.balanceOf(addr1.address)).to.equal(amount)

      // Exchange rate remains steady
      expect(await stRSR.exchangeRate()).to.equal(fp('1'))
    })

    it('Should allow multiple stakes/deposits in RSR', async () => {
      // Perform stake
      const amount1: BigNumber = bn('1000e18')
      const amount2: BigNumber = bn('200e18')
      const amount3: BigNumber = bn('3000e18')

      // Approve transfer and stake twice
      await rsr.connect(addr1).approve(stRSR.address, amount1.add(amount2))
      await expect(stRSR.connect(addr1).stake(amount1))
        .to.emit(stRSR, 'Staked')
        .withArgs(addr1.address, amount1, amount1)
      await expect(stRSR.connect(addr1).stake(amount2))
        .to.emit(stRSR, 'Staked')
        .withArgs(addr1.address, amount2, amount2)

      // New stake from different account
      await rsr.connect(addr2).approve(stRSR.address, amount3)
      await expect(stRSR.connect(addr2).stake(amount3))
        .to.emit(stRSR, 'Staked')
        .withArgs(addr2.address, amount3, amount3)

      // Check balances and stakes
      expect(await rsr.balanceOf(stRSR.address)).to.equal(amount1.add(amount2).add(amount3))
      expect(await rsr.balanceOf(stRSR.address)).to.equal(await stRSR.totalSupply())
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(amount1).sub(amount2))
      expect(await stRSR.balanceOf(addr1.address)).to.equal(amount1.add(amount2))
      expect(await rsr.balanceOf(addr2.address)).to.equal(initialBal.sub(amount3))
      expect(await stRSR.balanceOf(addr2.address)).to.equal(amount3)

      // Exchange rate remains steady
      expect(await stRSR.exchangeRate()).to.equal(fp('1'))
    })
  })

  describe('Withdrawals/Unstaking', () => {
    it('Should not allow to unstake amount = 0', async () => {
      const zero: BigNumber = bn(0)

      // Unstake
      await expect(stRSR.connect(addr1).unstake(zero)).to.be.revertedWith('Cannot withdraw zero')
    })

    it('Should not allow to unstake if not enough balance', async () => {
      const amount: BigNumber = bn('1000e18')

      // Unstake with no stakes/balance
      await expect(stRSR.connect(addr1).unstake(amount)).to.be.revertedWith('Not enough balance')
    })

    it('Should create Pending withdrawal when unstaking', async () => {
      const amount: BigNumber = bn('1000e18')

      // Stake
      await rsr.connect(addr1).approve(stRSR.address, amount)
      await stRSR.connect(addr1).stake(amount)
      let availableAt = (await getLatestBlockTimestamp()) + config.unstakingDelay.toNumber() + 1

      // Unstake
      await expect(stRSR.connect(addr1).unstake(amount))
        .emit(stRSR, 'UnstakingStarted')
        .withArgs(0, 0, addr1.address, amount, amount, availableAt)

      // Check withdrawal properly registered
      const [unstakeAcc, unstakeAmt] = await stRSR.withdrawals(addr1.address, 0)
      expect(unstakeAcc).to.equal(addr1.address)
      expect(unstakeAmt).to.equal(amount)

      // Check balances and stakes
      expect(await rsr.balanceOf(stRSR.address)).to.equal(amount)
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(amount))

      // All staked funds withdrawn upfront
      expect(await stRSR.balanceOf(addr1.address)).to.equal(0)
      expect(await stRSR.totalSupply()).to.equal(0)

      // Exchange rate remains steady
      expect(await stRSR.exchangeRate()).to.equal(fp('1'))
    })

    it('Should allow multiple unstakes/withdrawals in RSR', async () => {
      // Perform stake
      const amount1: BigNumber = bn('1e18')
      const amount2: BigNumber = bn('2e18')
      const amount3: BigNumber = bn('3e18')

      // Approve transfers
      await rsr.connect(addr1).approve(stRSR.address, amount1.add(amount2))
      await rsr.connect(addr2).approve(stRSR.address, amount3)

      // Stake
      await stRSR.connect(addr1).stake(amount1)
      await stRSR.connect(addr1).stake(amount2)
      await stRSR.connect(addr2).stake(amount3)

      let availableAt = (await getLatestBlockTimestamp()) + config.unstakingDelay.toNumber() + 1

      // Unstake - Create withdrawal
      await expect(stRSR.connect(addr1).unstake(amount1))
        .emit(stRSR, 'UnstakingStarted')
        .withArgs(0, 0, addr1.address, amount1, amount1, availableAt)

      let [unstakeAcc, unstakeAmt] = await stRSR.withdrawals(addr1.address, 0)
      expect(unstakeAcc).to.equal(addr1.address)
      expect(unstakeAmt).to.equal(amount1)

      // All staked funds withdrawn upfront
      expect(await stRSR.balanceOf(addr1.address)).to.equal(amount2)

      availableAt = (await getLatestBlockTimestamp()) + config.unstakingDelay.toNumber() + 1

      // Unstake again
      await expect(stRSR.connect(addr1).unstake(amount2))
        .emit(stRSR, 'UnstakingStarted')
        .withArgs(1, 0, addr1.address, amount2, amount2, availableAt)
      ;[unstakeAcc, unstakeAmt] = await stRSR.withdrawals(addr1.address, 1)
      expect(unstakeAcc).to.equal(addr1.address)
      expect(unstakeAmt).to.equal(amount2)

      // All staked funds withdrawn upfront
      expect(await stRSR.balanceOf(addr1.address)).to.equal(0)

      availableAt = (await getLatestBlockTimestamp()) + config.unstakingDelay.toNumber() + 1

      // Unstake again with different user
      await expect(stRSR.connect(addr2).unstake(amount3))
        .emit(stRSR, 'UnstakingStarted')
        .withArgs(0, 0, addr2.address, amount3, amount3, availableAt)
      ;[unstakeAcc, unstakeAmt] = await stRSR.withdrawals(addr2.address, 0)
      expect(unstakeAcc).to.equal(addr2.address)
      expect(unstakeAmt).to.equal(amount3)

      // All staked funds withdrawn upfront
      expect(await stRSR.balanceOf(addr2.address)).to.equal(0)

      // Exchange rate remains steady
      expect(await stRSR.exchangeRate()).to.equal(fp('1'))
    })

    context('With deposits and withdrawals', async () => {
      let amount1: BigNumber
      let amount2: BigNumber
      let amount3: BigNumber
      let stkWithdrawalDelay: number

      beforeEach(async () => {
        stkWithdrawalDelay = (await stRSR.unstakingDelay()).toNumber()

        // Perform stake
        amount1 = bn('1e18')
        amount2 = bn('2e18')
        amount3 = bn('3e18')

        // Approve transfers
        await rsr.connect(addr1).approve(stRSR.address, amount1)
        await rsr.connect(addr2).approve(stRSR.address, amount2.add(amount3))

        // Stake
        await stRSR.connect(addr1).stake(amount1)
        await stRSR.connect(addr2).stake(amount2)
        await stRSR.connect(addr2).stake(amount3)

        // Unstake - Create withdrawal
        await stRSR.connect(addr1).unstake(amount1)
      })

      it('Should revert withdraw/unstake if Main is paused', async () => {
        // Get current balance for user
        const prevAddr1Balance = await rsr.balanceOf(addr1.address)

        // Move forward past stakingWithdrawalDelay
        await advanceTime(stkWithdrawalDelay + 1)

        // Pause Main
        await main.connect(owner).pause()

        // Withdraw
        await expect(stRSR.connect(addr1).withdraw(addr1.address, 1)).to.be.revertedWith(
          'is paused'
        )

        // You cannot unstake also in this situation
        await expect(stRSR.connect(addr2).unstake(amount2)).to.be.revertedWith('main paused')

        // If unpaused should withdraw OK
        await main.connect(owner).unpause()

        // Withdraw
        await stRSR.connect(addr1).withdraw(addr1.address, 1)

        // Withdrawal was completed
        expect(await stRSR.totalSupply()).to.equal(amount2.add(amount3))
        expect(await rsr.balanceOf(stRSR.address)).to.equal(await stRSR.totalSupply())
        expect(await rsr.balanceOf(addr1.address)).to.equal(prevAddr1Balance.add(amount1))
        expect(await stRSR.balanceOf(addr1.address)).to.equal(0)
      })

      it('Should not withdraw/unstake if not fully capitalized', async () => {
        // Need to issue some RTokens to handle fully/not fully capitalized
        await token0.connect(owner).mint(addr1.address, initialBal)
        await token1.connect(owner).mint(addr1.address, initialBal)
        await token2.connect(owner).mint(addr1.address, initialBal)
        await token3.connect(owner).mint(addr1.address, initialBal)

        // Approvals
        await token0.connect(addr1).approve(rToken.address, initialBal)
        await token1.connect(addr1).approve(rToken.address, initialBal)
        await token2.connect(addr1).approve(rToken.address, initialBal)
        await token3.connect(addr1).approve(rToken.address, initialBal)

        // Issue tokens
        const issueAmount: BigNumber = bn('100e18')
        await rToken.connect(addr1).issue(issueAmount)

        // Get current balance for user
        const prevAddr1Balance = await rsr.balanceOf(addr1.address)

        // Move forward past stakingWithdrawalDelay
        await advanceTime(stkWithdrawalDelay + 1)

        // Save backing tokens
        const erc20s = await facade.basketTokens()

        // Set not fully capitalized by changing basket
        await basketHandler.connect(owner).setPrimeBasket([token0.address], [fp('1e18')])
        await basketHandler.connect(owner).switchBasket()
        expect(await basketHandler.fullyCapitalized()).to.equal(false)

        // Withdraw
        await expect(stRSR.connect(addr1).withdraw(addr1.address, 1)).to.be.revertedWith(
          'RToken uncapitalized'
        )

        // Also you cannot unstake in this situation
        await expect(stRSR.connect(addr2).unstake(amount2)).to.be.revertedWith(
          'RToken uncapitalized'
        )

        // If fully capitalized should withdraw OK  - Set back original basket
        await basketHandler.connect(owner).setPrimeBasket(erc20s, basketsNeededAmts)
        await basketHandler.connect(owner).switchBasket()

        expect(await basketHandler.fullyCapitalized()).to.equal(true)

        // Withdraw
        await stRSR.connect(addr1).withdraw(addr1.address, 1)

        // Withdrawal completed
        expect(await stRSR.totalSupply()).to.equal(amount2.add(amount3))
        expect(await rsr.balanceOf(stRSR.address)).to.equal(await stRSR.totalSupply())
        expect(await rsr.balanceOf(addr1.address)).to.equal(prevAddr1Balance.add(amount1))
        // All staked funds withdrawn upfront
        expect(await stRSR.balanceOf(addr1.address)).to.equal(0)
      })

      it('Should not withdraw/unstake if basket defaulted', async () => {
        // Move forward past stakingWithdrawalDelay
        await advanceTime(stkWithdrawalDelay + 1)

        // Set Token1 to default - 50% price reduction and mark default as probable
        await aaveOracleInternal.setPrice(token1.address, bn('1.25e14'))
        await collateral1.forceUpdates()
        expect(await basketHandler.status()).to.equal(CollateralStatus.IFFY)
        expect(await basketHandler.fullyCapitalized()).to.equal(true)

        // Attempt to Withdraw
        await expect(stRSR.connect(addr1).withdraw(addr1.address, 1)).to.be.revertedWith(
          'basket defaulted'
        )

        // Also you cannot unstake in this situation
        await expect(stRSR.connect(addr2).unstake(amount2)).to.be.revertedWith('basket defaulted')

        // Nothing completed
        expect(await stRSR.totalSupply()).to.equal(amount2.add(amount3))
        expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(amount1))
        expect(await stRSR.balanceOf(addr1.address)).to.equal(0)
      })

      it('Should not withdraw before stakingWithdrawalDelay', async () => {
        // Withdraw
        await expect(stRSR.connect(addr1).withdraw(addr1.address, 1)).to.be.revertedWith(
          'withdrawal unavailable'
        )

        // Nothing completed so far
        expect(await stRSR.totalSupply()).to.equal(amount2.add(amount3))
        expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(amount1))
        expect(await stRSR.balanceOf(addr1.address)).to.equal(0)

        // Withdraw after certain time (still before stakingWithdrawalDelay)
        await advanceTime(stkWithdrawalDelay / 2)

        await expect(stRSR.connect(addr1).withdraw(addr1.address, 1)).to.be.revertedWith(
          'withdrawal unavailable'
        )

        // Nothing completed still
        expect(await stRSR.totalSupply()).to.equal(amount2.add(amount3))
        expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(amount1))
        expect(await stRSR.balanceOf(addr1.address)).to.equal(0)
      })

      it('Should withdraw after stakingWithdrawalDelay', async () => {
        // Get current balance for user
        const prevAddr1Balance = await rsr.balanceOf(addr1.address)

        // Move forward past stakingWithdrawalDelay
        await advanceTime(stkWithdrawalDelay + 1)

        // Attempt to withdraw with zero index, nothing happens
        await stRSR.connect(addr1).withdraw(addr1.address, 0)

        // Attempt to withdraw with index > number of withdrawals
        await expect(stRSR.connect(addr1).withdraw(addr1.address, 5)).to.be.revertedWith(
          'index out-of-bounds'
        )

        // Nothing compsleted still
        expect(await stRSR.totalSupply()).to.equal(amount2.add(amount3))
        expect(await rsr.balanceOf(addr1.address)).to.equal(prevAddr1Balance)
        // All staked funds withdrawn upfront
        expect(await stRSR.balanceOf(addr1.address)).to.equal(0)

        // Withdraw with correct index
        await stRSR.connect(addr1).withdraw(addr1.address, 1)

        // Withdrawal was completed
        expect(await stRSR.totalSupply()).to.equal(amount2.add(amount3))
        expect(await rsr.balanceOf(stRSR.address)).to.equal(await stRSR.totalSupply())
        expect(await rsr.balanceOf(addr1.address)).to.equal(prevAddr1Balance.add(amount1))
        // All staked funds withdrawn upfront
        expect(await stRSR.balanceOf(addr1.address)).to.equal(0)

        // Exchange rate remains steady
        expect(await stRSR.exchangeRate()).to.equal(fp('1'))
      })

      it('Should store weights and calculate balance correctly', async () => {
        // Get current balances for users
        const prevAddr1Balance = await rsr.balanceOf(addr1.address)
        const prevAddr2Balance = await rsr.balanceOf(addr2.address)

        // Create additional withdrawal - will also withdraw previous one
        await stRSR.connect(addr2).unstake(amount2)

        // Move forward past stakingWithdrawalDelaylay
        await advanceTime(stkWithdrawalDelay + 1)

        // Withdraw
        await stRSR
          .connect(addr1)
          .withdraw(addr1.address, await stRSR.endIdForWithdraw(addr1.address))
        await stRSR
          .connect(addr2)
          .withdraw(addr2.address, await stRSR.endIdForWithdraw(addr2.address))

        // Withdrawals completed
        expect(await stRSR.totalSupply()).to.equal(amount3)
        expect(await rsr.balanceOf(stRSR.address)).to.equal(await stRSR.totalSupply())
        expect(await rsr.balanceOf(addr1.address)).to.equal(prevAddr1Balance.add(amount1))
        expect(await stRSR.balanceOf(addr1.address)).to.equal(0)
        expect(await rsr.balanceOf(addr2.address)).to.equal(prevAddr2Balance.add(amount2))
        expect(await stRSR.balanceOf(addr2.address)).to.equal(amount3)

        // Create additional withdrawal
        await stRSR.connect(addr2).unstake(amount3)

        // Move forward past stakingWithdrawalDelay
        await advanceTime(stkWithdrawalDelay + 1)

        // Withdraw
        await stRSR
          .connect(addr2)
          .withdraw(addr2.address, await stRSR.endIdForWithdraw(addr2.address))

        // Withdrawals completed
        expect(await stRSR.totalSupply()).to.equal(0)
        expect(await rsr.balanceOf(stRSR.address)).to.equal(await stRSR.totalSupply())
        expect(await rsr.balanceOf(addr1.address)).to.equal(prevAddr1Balance.add(amount1))
        expect(await stRSR.balanceOf(addr1.address)).to.equal(0)
        expect(await rsr.balanceOf(addr2.address)).to.equal(
          prevAddr2Balance.add(amount2).add(amount3)
        )
        expect(await stRSR.balanceOf(addr2.address)).to.equal(0)

        // Exchange rate remains steady
        expect(await stRSR.exchangeRate()).to.equal(fp('1'))
      })
    })
  })

  describe('Add RSR / Rewards', async () => {
    const initialRate = fp('1')
    const stake: BigNumber = bn('1e18')
    const amountAdded: BigNumber = bn('10e18')
    let decayFn: (a: BigNumber, b: number) => BigNumber

    beforeEach(async () => {
      // Should start with coherent exchange rate even at no stake
      expect(await stRSR.exchangeRate()).to.equal(initialRate)

      // Add RSR
      await rsr.connect(owner).transfer(stRSR.address, amountAdded)

      // Check RSR balance
      expect(await rsr.balanceOf(stRSR.address)).to.equal(amountAdded)

      // Check exchange rate
      expect(await stRSR.exchangeRate()).to.equal(initialRate)

      // Advance to the end of noop period
      await advanceTime(Number(config.rewardPeriod) + 1)

      await expect(stRSR.payoutRewards())
        .to.emit(stRSR, 'ExchangeRateSet')
        .withArgs(initialRate, initialRate)

      // Check exchange rate remains static
      expect(await stRSR.exchangeRate()).to.equal(initialRate)

      decayFn = makeDecayFn(await stRSR.rewardRatio())
    })

    it('Rewards should not be handed out in same period they were added', async () => {
      // Stake
      await rsr.connect(addr1).approve(stRSR.address, stake)
      await stRSR.connect(addr1).stake(stake)

      expect(await stRSR.balanceOf(addr1.address)).to.equal(stake)
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(stake))
      expect(await stRSR.exchangeRate()).to.equal(initialRate)
    })

    it('Should allow to add RSR - Single staker', async () => {
      // Stake
      await rsr.connect(addr1).approve(stRSR.address, stake)
      await stRSR.connect(addr1).stake(stake)

      // Advance to get 1 round of rewards
      await advanceTime(Number(config.rewardPeriod) + 1)

      // Calculate payout amount
      const expAmt = decayFn(amountAdded, 1) // 1 round
      const newRate: BigNumber = initialRate.add(amountAdded.sub(expAmt))

      // Payout rewards
      await expect(stRSR.payoutRewards())
        .to.emit(stRSR, 'ExchangeRateSet')
        .withArgs(initialRate, newRate)

      // Check exchange rate
      expect(await stRSR.exchangeRate()).to.equal(newRate)

      // Check new balances and stakes
      expect(await rsr.balanceOf(stRSR.address)).to.equal(stake.add(amountAdded))
      expect(await rsr.balanceOf(stRSR.address)).to.be.gt(await stRSR.totalSupply())
      // No change for stakers
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(stake))
      expect(await stRSR.balanceOf(addr1.address)).to.equal(stake)
    })

    it('Should treat two stakers same as one', async () => {
      // Stake
      await rsr.connect(addr1).approve(stRSR.address, stake.div(2))
      await stRSR.connect(addr1).stake(stake.div(2))

      // Stake
      await rsr.connect(addr2).approve(stRSR.address, stake.div(2))
      await stRSR.connect(addr2).stake(stake.div(2))

      // Check balances and stakes
      expect(await rsr.balanceOf(stRSR.address)).to.equal(stake.add(amountAdded))
      expect(await rsr.balanceOf(stRSR.address)).to.be.gt(await stRSR.totalSupply())
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(stake.div(2)))
      expect(await rsr.balanceOf(addr2.address)).to.equal(initialBal.sub(stake.div(2)))
      expect(await stRSR.balanceOf(addr1.address)).to.equal(stake.div(2))
      expect(await stRSR.balanceOf(addr2.address)).to.equal(stake.div(2))

      // Advance to get 1 round of rewards
      await advanceTime(Number(config.rewardPeriod) + 1)

      // Calculate payout amount
      const expAmt = decayFn(amountAdded, 1) // 1 round
      const newRate: BigNumber = initialRate.add(amountAdded.sub(expAmt))

      // Payout rewards
      await expect(stRSR.payoutRewards())
        .to.emit(stRSR, 'ExchangeRateSet')
        .withArgs(initialRate, newRate)

      // Check exchange rate
      expect(await stRSR.exchangeRate()).to.equal(newRate)

      // Check new balances and stakes
      expect(await rsr.balanceOf(stRSR.address)).to.equal(stake.add(amountAdded))
      expect(await rsr.balanceOf(stRSR.address)).to.be.gt(await stRSR.totalSupply())
      // No change for stakers
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(stake.div(2)))
      expect(await rsr.balanceOf(addr2.address)).to.equal(initialBal.sub(stake.div(2)))
      expect(await stRSR.balanceOf(addr1.address)).to.equal(stake.div(2))
      expect(await stRSR.balanceOf(addr2.address)).to.equal(stake.div(2))
    })

    it('Many discrete payouts should approximate true closed form for n = 100', async () => {
      // Stake
      await rsr.connect(addr1).approve(stRSR.address, stake)
      await stRSR.connect(addr1).stake(stake)

      const decayFn = makeDecayFn(await stRSR.rewardRatio())
      let error = bn('0')
      for (let i = 0; i < 100; i++) {
        // Advance to get 1 round of rewards
        await advanceTime(Number(config.rewardPeriod) + 1)

        // Calculate payout amount as if it were a closed form calculation from start
        const expAmt = decayFn(amountAdded, i + 1)
        const newRate: BigNumber = initialRate.add(amountAdded.sub(expAmt))

        // Payout rewards
        await expect(stRSR.payoutRewards()).to.emit(stRSR, 'ExchangeRateSet')

        error = error.add(calcErr(1)) // this is just adding 1 each time

        // Check exchange rate does not exceed max possible cumulative error
        expect(near(await stRSR.exchangeRate(), newRate, error)).to.equal(true)

        // Check new balances and stakes
        expect(await rsr.balanceOf(stRSR.address)).to.equal(stake.add(amountAdded))
        expect(await rsr.balanceOf(stRSR.address)).to.be.gt(await stRSR.totalSupply())
        // No change for stakers
        expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(stake))
        expect(await stRSR.balanceOf(addr1.address)).to.equal(stake)
      }
    })

    it('Single payout for n = 100 rounds should approximate true closed form', async () => {
      // Stake
      await rsr.connect(addr1).approve(stRSR.address, stake)
      await stRSR.connect(addr1).stake(stake)

      // Advance to get 1 round of rewards
      await advanceTime(100 * Number(config.rewardPeriod) + 1)

      // Calculate payout amount as if it were a closed form calculation from start
      const expAmt = decayFn(amountAdded, 100)
      const newRate: BigNumber = initialRate.add(amountAdded.sub(expAmt))

      // Payout rewards
      await expect(stRSR.payoutRewards()).to.emit(stRSR, 'ExchangeRateSet')
      const error = calcErr(100)

      // Check exchange rate is lower by at-most half
      expect(await stRSR.exchangeRate()).to.equal(newRate.add(error)) // exact check!

      // Check new balances and stakes
      expect(await rsr.balanceOf(stRSR.address)).to.equal(stake.add(amountAdded))
      expect(await rsr.balanceOf(stRSR.address)).to.be.gt(await stRSR.totalSupply())
      // No change for stakers
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(stake))
      expect(await stRSR.balanceOf(addr1.address)).to.equal(stake)
    })
  })

  describe('Remove RSR', () => {
    it('Should not allow to remove RSR if caller is not part of Main', async () => {
      const amount: BigNumber = bn('1e18')
      const prevPoolBalance: BigNumber = await rsr.balanceOf(stRSR.address)

      await expect(stRSR.connect(other).seizeRSR(amount)).to.be.revertedWith('not backing manager')
      expect(await rsr.balanceOf(stRSR.address)).to.equal(prevPoolBalance)
    })

    it('Should not allow to remove RSR if amount is zero', async () => {
      const zero: BigNumber = bn('0')
      const prevPoolBalance: BigNumber = await rsr.balanceOf(stRSR.address)

      await whileImpersonating(backingManager.address, async (signer) => {
        await expect(stRSR.connect(signer).seizeRSR(zero)).to.be.revertedWith(
          'Amount cannot be zero'
        )
      })

      expect(await rsr.balanceOf(stRSR.address)).to.equal(prevPoolBalance)
    })

    it('Should allow to remove RSR - Single staker', async () => {
      const amount: BigNumber = bn('10e18')
      const amount2: BigNumber = bn('1e18')

      // Stake
      await rsr.connect(addr1).approve(stRSR.address, amount)
      await stRSR.connect(addr1).stake(amount)

      // Check balances and stakes
      expect(await rsr.balanceOf(stRSR.address)).to.equal(amount)
      expect(await rsr.balanceOf(stRSR.address)).to.equal(await stRSR.totalSupply())
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(amount))
      expect(await stRSR.balanceOf(addr1.address)).to.equal(amount)

      const newRate = fp(amount.sub(amount2)).div(amount)

      // Seize RSR
      await whileImpersonating(backingManager.address, async (signer) => {
        await expect(stRSR.connect(signer).seizeRSR(amount2))
          .to.emit(stRSR, 'ExchangeRateSet')
          .withArgs(fp('1'), newRate)
      })

      // Check balances and stakes
      expect(await rsr.balanceOf(stRSR.address)).to.equal(amount.sub(amount2))
      expect(await stRSR.totalSupply()).to.equal(amount)
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(amount))
      expect(await stRSR.balanceOf(addr1.address)).to.equal(amount)
    })

    it('Should allow to remove RSR - Two stakers - Rounded values', async () => {
      const amount: BigNumber = bn('10e18')
      const amount2: BigNumber = bn('1e18')

      // Stake
      await rsr.connect(addr1).approve(stRSR.address, amount)
      await stRSR.connect(addr1).stake(amount)

      await rsr.connect(addr2).approve(stRSR.address, amount)
      await stRSR.connect(addr2).stake(amount)

      // Check balances and stakes
      expect(await rsr.balanceOf(stRSR.address)).to.equal(amount.mul(2))
      expect(await rsr.balanceOf(stRSR.address)).to.equal(await stRSR.totalSupply())
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(amount))
      expect(await rsr.balanceOf(addr2.address)).to.equal(initialBal.sub(amount))
      expect(await stRSR.balanceOf(addr1.address)).to.equal(amount)
      expect(await stRSR.balanceOf(addr2.address)).to.equal(amount)

      const newRate = fp(amount.mul(2).sub(amount2)).div(amount.mul(2))

      // Seize RSR
      await whileImpersonating(backingManager.address, async (signer) => {
        await expect(stRSR.connect(signer).seizeRSR(amount2))
          .to.emit(stRSR, 'ExchangeRateSet')
          .withArgs(fp('1'), newRate)
      })

      // Check balances and stakes
      expect(await rsr.balanceOf(stRSR.address)).to.equal(amount.mul(2).sub(amount2))
      expect(await stRSR.totalSupply()).to.equal(amount.mul(2))
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(amount))
      expect(await rsr.balanceOf(addr2.address)).to.equal(initialBal.sub(amount))
      expect(await stRSR.balanceOf(addr1.address)).to.equal(amount)
      expect(await stRSR.balanceOf(addr2.address)).to.equal(amount)
    })

    it('Should allow to remove RSR - Three stakers - Check Precision', async () => {
      const amount: BigNumber = bn('10e18')
      const amount2: BigNumber = bn('1e18')

      // Stake
      await rsr.connect(addr1).approve(stRSR.address, amount)
      await stRSR.connect(addr1).stake(amount)

      await rsr.connect(addr2).approve(stRSR.address, amount)
      await stRSR.connect(addr2).stake(amount)

      await rsr.connect(addr3).approve(stRSR.address, amount)
      await stRSR.connect(addr3).stake(amount)

      // Check balances and stakes
      expect(await rsr.balanceOf(stRSR.address)).to.equal(amount.mul(3))
      // expect(near(await rsr.balanceOf(stRSR.address), await stRSR.totalSupply(), 1)).to.equal(true)
      expect(await rsr.balanceOf(stRSR.address)).to.be.closeTo(await stRSR.totalSupply(), 1)
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(amount))
      expect(await rsr.balanceOf(addr2.address)).to.equal(initialBal.sub(amount))
      expect(await rsr.balanceOf(addr3.address)).to.equal(initialBal.sub(amount))
      expect(await stRSR.balanceOf(addr1.address)).to.equal(amount)
      expect(await stRSR.balanceOf(addr2.address)).to.equal(amount)
      expect(await stRSR.balanceOf(addr3.address)).to.equal(amount)

      const newRate = fp(amount.mul(3).sub(amount2)).div(amount.mul(3))

      // Seize RSR
      await whileImpersonating(backingManager.address, async (signer) => {
        await expect(stRSR.connect(signer).seizeRSR(amount2))
          .to.emit(stRSR, 'ExchangeRateSet')
          .withArgs(fp('1'), newRate)
      })
      // Check balances and stakes
      expect(await rsr.balanceOf(stRSR.address)).to.equal(amount.mul(3).sub(amount2))
      expect(await stRSR.totalSupply()).to.equal(amount.mul(3))
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(amount))
      expect(await rsr.balanceOf(addr2.address)).to.equal(initialBal.sub(amount))
      expect(await rsr.balanceOf(addr3.address)).to.equal(initialBal.sub(amount))

      expect(await stRSR.balanceOf(addr1.address)).to.equal(amount)
      expect(await stRSR.balanceOf(addr2.address)).to.equal(amount)
      expect(await stRSR.balanceOf(addr3.address)).to.equal(amount)
    })

    it('Should seize all RSR if required - Mayhem scenario', async () => {
      const amount: BigNumber = bn('10e18')

      // Stake
      await rsr.connect(addr1).approve(stRSR.address, amount)
      await stRSR.connect(addr1).stake(amount)

      await rsr.connect(addr2).approve(stRSR.address, amount)
      await stRSR.connect(addr2).stake(amount)

      // Check balances and stakes
      expect(await rsr.balanceOf(stRSR.address)).to.equal(amount.mul(2))
      expect(await rsr.balanceOf(stRSR.address)).to.equal(await stRSR.totalSupply())
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(amount))
      expect(await rsr.balanceOf(addr2.address)).to.equal(initialBal.sub(amount))
      expect(await stRSR.balanceOf(addr1.address)).to.equal(amount)
      expect(await stRSR.balanceOf(addr2.address)).to.equal(amount)

      // Seize RSR
      await whileImpersonating(backingManager.address, async (signer) => {
        await expect(stRSR.connect(signer).seizeRSR(amount.mul(2).add(bn('1e18'))))
          .to.emit(stRSR, 'ExchangeRateSet')
          .withArgs(fp('1'), fp('1'))
      })

      // Check balances and stakes
      expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
      expect(await stRSR.totalSupply()).to.equal(0)
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(amount))
      expect(await rsr.balanceOf(addr2.address)).to.equal(initialBal.sub(amount))
      expect(await stRSR.balanceOf(addr1.address)).to.equal(0)
      expect(await stRSR.balanceOf(addr2.address)).to.equal(0)
    })

    it('Should remove RSR from Withdrawers', async () => {
      const amount: BigNumber = bn('10e18')
      const amount2: BigNumber = bn('1e18')

      // Stake
      await rsr.connect(addr1).approve(stRSR.address, amount)
      await stRSR.connect(addr1).stake(amount)

      // Check balances and stakes
      expect(await rsr.balanceOf(stRSR.address)).to.equal(amount)
      //expect(near(await rsr.balanceOf(stRSR.address), await stRSR.totalSupply(), 1)).to.equal(true)
      expect(await rsr.balanceOf(stRSR.address)).to.be.closeTo(await stRSR.totalSupply(), 1)
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(amount))
      expect(await stRSR.balanceOf(addr1.address)).to.equal(amount)

      // Unstake
      await stRSR.connect(addr1).unstake(amount)

      // Check withdrawal properly registered
      let [unstakeAcc, unstakeAmt] = await stRSR.withdrawals(addr1.address, 0)
      expect(unstakeAcc).to.equal(addr1.address)
      expect(unstakeAmt).to.equal(amount)

      // Check balances and stakes
      expect(await rsr.balanceOf(stRSR.address)).to.equal(amount)
      expect(await stRSR.totalSupply()).to.equal(0)
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(amount))
      expect(await stRSR.balanceOf(addr1.address)).to.equal(0)

      // Seize RSR
      await whileImpersonating(backingManager.address, async (signer) => {
        await expect(stRSR.connect(signer).seizeRSR(amount2))
          .to.emit(rsr, 'Transfer')
          .withArgs(stRSR.address, backingManager.address, amount2)
      })

      // Check balances, stakes, and withdrawals
      expect(await rsr.balanceOf(stRSR.address)).to.equal(amount.sub(amount2))
      expect(await stRSR.totalSupply()).to.equal(0)
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(amount))
      expect(await stRSR.balanceOf(addr1.address)).to.equal(0)

      // Check impacted withdrawal
      ;[unstakeAcc, unstakeAmt] = await stRSR.withdrawals(addr1.address, 0)
      expect(unstakeAcc).to.equal(addr1.address)
      expect(unstakeAmt).to.equal(amount.sub(amount2))
    })

    it('Should remove RSR proportionally from Stakers and Withdrawers', async () => {
      const amount: BigNumber = bn('10e18')
      const amount2: BigNumber = bn('1e18')

      // Stake
      await rsr.connect(addr1).approve(stRSR.address, amount)
      await stRSR.connect(addr1).stake(amount)

      await rsr.connect(addr2).approve(stRSR.address, amount)
      await stRSR.connect(addr2).stake(amount)

      // Check balances and stakes
      expect(await rsr.balanceOf(stRSR.address)).to.equal(amount.mul(2))
      expect(await rsr.balanceOf(stRSR.address)).to.equal(await stRSR.totalSupply())
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(amount))
      expect(await rsr.balanceOf(addr2.address)).to.equal(initialBal.sub(amount))
      expect(await stRSR.balanceOf(addr1.address)).to.equal(amount)
      expect(await stRSR.balanceOf(addr2.address)).to.equal(amount)

      // Unstake
      await stRSR.connect(addr1).unstake(amount)

      // Check withdrawal properly registered
      let [unstakeAcc, unstakeAmt] = await stRSR.withdrawals(addr1.address, 0)
      expect(unstakeAcc).to.equal(addr1.address)
      expect(unstakeAmt).to.equal(amount)

      // Check balances and stakes
      expect(await rsr.balanceOf(stRSR.address)).to.equal(amount.mul(2))
      expect(await stRSR.totalSupply()).to.equal(amount)
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(amount))
      expect(await rsr.balanceOf(addr2.address)).to.equal(initialBal.sub(amount))
      expect(await stRSR.balanceOf(addr1.address)).to.equal(0)
      expect(await stRSR.balanceOf(addr2.address)).to.equal(amount)

      // Seize RSR
      await whileImpersonating(backingManager.address, async (signer) => {
        await stRSR.connect(signer).seizeRSR(amount2)
      })

      // Check balances, stakes, and withdrawals
      const proportionalAmountToSeize: BigNumber = amount2.div(2)

      expect(await rsr.balanceOf(stRSR.address)).to.equal(amount.mul(2).sub(amount2))
      expect(await stRSR.totalSupply()).to.equal(amount)
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(amount))
      expect(await rsr.balanceOf(addr2.address)).to.equal(initialBal.sub(amount))
      expect(await stRSR.balanceOf(addr1.address)).to.equal(0)
      expect(await stRSR.balanceOf(addr2.address)).to.equal(amount)

      // // Check impacted withdrawal
      ;[unstakeAcc, unstakeAmt] = await stRSR.withdrawals(addr1.address, 0)
      expect(unstakeAcc).to.equal(addr1.address)
      expect(unstakeAmt).to.equal(amount.sub(proportionalAmountToSeize))
    })
  })

  describe('Transfers', () => {
    let amount: BigNumber

    beforeEach(async function () {
      // Stake some RSR
      amount = bn('10e18')

      // Approve transfer and stake
      await rsr.connect(addr1).approve(stRSR.address, amount)

      await stRSR.connect(addr1).stake(amount)
    })

    it('Should transfer stakes between accounts', async function () {
      const addr1BalancePrev = await stRSR.balanceOf(addr1.address)
      const addr2BalancePrev = await stRSR.balanceOf(addr2.address)
      const totalSupplyPrev = await stRSR.totalSupply()

      //  Perform transfer
      await stRSR.connect(addr1).transfer(addr2.address, amount)

      expect(await stRSR.balanceOf(addr1.address)).to.equal(addr1BalancePrev.sub(amount))
      expect(await stRSR.balanceOf(addr2.address)).to.equal(addr2BalancePrev.add(amount))
      expect(await stRSR.totalSupply()).to.equal(totalSupplyPrev)
      expect(await rsr.balanceOf(stRSR.address)).to.equal(amount)
    })

    it('Should not transfer stakes if no balance', async function () {
      const addr1BalancePrev = await stRSR.balanceOf(addr1.address)
      const addr2BalancePrev = await stRSR.balanceOf(addr2.address)
      const totalSupplyPrev = await stRSR.totalSupply()

      //  Perform transfer with user with no stake
      await expect(stRSR.connect(addr2).transfer(addr1.address, amount)).to.be.revertedWith(
        'ERC20: transfer amount exceeds balance'
      )

      // Nothing transferred
      expect(await stRSR.balanceOf(addr1.address)).to.equal(addr1BalancePrev)
      expect(await stRSR.balanceOf(addr2.address)).to.equal(addr2BalancePrev)
      expect(await stRSR.totalSupply()).to.equal(totalSupplyPrev)
      expect(await rsr.balanceOf(stRSR.address)).to.equal(amount)
    })

    it('Should not transfer stakes to zero address', async function () {
      const addr1BalancePrev = await stRSR.balanceOf(addr1.address)
      const addr2BalancePrev = await stRSR.balanceOf(addr2.address)
      const totalSupplyPrev = await stRSR.totalSupply()

      // Attempt to send to zero address
      await expect(stRSR.connect(addr1).transfer(ZERO_ADDRESS, amount)).to.be.revertedWith(
        'ERC20: transfer to the zero address'
      )

      // Nothing transferred
      expect(await stRSR.balanceOf(addr1.address)).to.equal(addr1BalancePrev)
      expect(await stRSR.balanceOf(addr2.address)).to.equal(addr2BalancePrev)
      expect(await stRSR.totalSupply()).to.equal(totalSupplyPrev)
      expect(await rsr.balanceOf(stRSR.address)).to.equal(amount)
    })

    it('Should transferFrom stakes between accounts', async function () {
      const addr1BalancePrev = await stRSR.balanceOf(addr1.address)
      const addr2BalancePrev = await stRSR.balanceOf(addr2.address)
      const totalSupplyPrev = await stRSR.totalSupply()

      // Set allowance and transfer
      await stRSR.connect(addr1).approve(addr2.address, amount)

      expect(await stRSR.allowance(addr1.address, addr2.address)).to.equal(amount)

      await stRSR.connect(addr2).transferFrom(addr1.address, other.address, amount)

      expect(await stRSR.allowance(addr1.address, addr2.address)).to.equal(0)
      expect(await stRSR.balanceOf(addr1.address)).to.equal(addr1BalancePrev.sub(amount))
      expect(await stRSR.balanceOf(addr2.address)).to.equal(addr2BalancePrev)
      expect(await stRSR.balanceOf(other.address)).to.equal(amount)
      expect(await stRSR.totalSupply()).to.equal(totalSupplyPrev)
      expect(await rsr.balanceOf(stRSR.address)).to.equal(amount)
    })

    it('Should set allowance when using "Permit"', async () => {
      expect(await stRSR.allowance(addr1.address, addr2.address)).to.equal(0)

      const permit = await signERC2612Permit(
        addr1,
        stRSR.address,
        addr1.address,
        addr2.address,
        amount.toString()
      )

      await expect(
        stRSR.permit(
          addr1.address,
          addr2.address,
          amount,
          permit.deadline,
          permit.v,
          permit.r,
          permit.s
        )
      )
        .to.emit(stRSR, 'Approval')
        .withArgs(addr1.address, addr2.address, amount)
      expect(await stRSR.allowance(addr1.address, addr2.address)).to.equal(amount)
    })

    it('Should perform validations on "Permit"', async () => {
      expect(await stRSR.allowance(addr1.address, addr2.address)).to.equal(0)

      // Set invalid signature
      const permit = await signERC2612Permit(
        addr1,
        stRSR.address,
        addr1.address,
        addr2.address,
        amount.add(1).toString()
      )

      // Attempt to run permit with invalid signature
      await expect(
        stRSR.permit(
          addr1.address,
          addr2.address,
          amount,
          permit.deadline,
          permit.v,
          permit.r,
          permit.s
        )
      ).to.be.revertedWith('ERC20Permit: invalid signature')

      // Attempt to run permit with expired deadline
      await expect(
        stRSR.permit(
          addr1.address,
          addr2.address,
          amount,
          (await getLatestBlockTimestamp()) - 1,
          permit.v,
          permit.r,
          permit.s
        )
      ).to.be.revertedWith('ERC20Permit: expired deadline')

      expect(await stRSR.allowance(addr1.address, addr2.address)).to.equal(0)
    })

    it('Should not transferFrom stakes if sender is zero address', async function () {
      const addr1BalancePrev = await stRSR.balanceOf(addr1.address)
      const addr2BalancePrev = await stRSR.balanceOf(addr2.address)
      const totalSupplyPrev = await stRSR.totalSupply()

      // Set allowance and transfer
      expect(await stRSR.allowance(addr1.address, addr2.address)).to.equal(0)
      await expect(
        stRSR.connect(addr2).transferFrom(ZERO_ADDRESS, other.address, amount)
      ).to.be.revertedWith('ERC20: transfer from the zero address')

      // Nothing transferred
      expect(await stRSR.balanceOf(addr1.address)).to.equal(addr1BalancePrev)
      expect(await stRSR.balanceOf(addr2.address)).to.equal(addr2BalancePrev)
      expect(await stRSR.balanceOf(other.address)).to.equal(0)
      expect(await stRSR.totalSupply()).to.equal(totalSupplyPrev)
      expect(await rsr.balanceOf(stRSR.address)).to.equal(amount)
    })

    it('Should not transferFrom stakes if no allowance', async function () {
      const addr1BalancePrev = await stRSR.balanceOf(addr1.address)
      const addr2BalancePrev = await stRSR.balanceOf(addr2.address)
      const totalSupplyPrev = await stRSR.totalSupply()

      // Set allowance and transfer
      expect(await stRSR.allowance(addr1.address, addr2.address)).to.equal(0)
      await expect(
        stRSR.connect(addr2).transferFrom(addr1.address, other.address, amount)
      ).to.be.revertedWith('ERC20: transfer amount exceeds allowance')

      // Nothing transferred
      expect(await stRSR.balanceOf(addr1.address)).to.equal(addr1BalancePrev)
      expect(await stRSR.balanceOf(addr2.address)).to.equal(addr2BalancePrev)
      expect(await stRSR.balanceOf(other.address)).to.equal(0)
      expect(await stRSR.totalSupply()).to.equal(totalSupplyPrev)
      expect(await rsr.balanceOf(stRSR.address)).to.equal(amount)
    })

    it('Should perform validations on approvals', async function () {
      expect(await stRSR.allowance(addr1.address, ZERO_ADDRESS)).to.equal(0)
      expect(await stRSR.allowance(ZERO_ADDRESS, addr2.address)).to.equal(0)

      // Attempt to set allowance to zero address
      await expect(stRSR.connect(addr1).approve(ZERO_ADDRESS, amount)).to.be.revertedWith(
        'ERC20: approve to the zero address'
      )

      // Attempt set allowance from zero address - Impersonation is the only way to get to this validation
      await whileImpersonating(ZERO_ADDRESS, async (signer) => {
        await expect(stRSR.connect(signer).approve(addr2.address, amount)).to.be.revertedWith(
          'ERC20: approve from the zero address'
        )
      })

      // Nothing set
      expect(await stRSR.allowance(addr1.address, ZERO_ADDRESS)).to.equal(0)
      expect(await stRSR.allowance(ZERO_ADDRESS, addr2.address)).to.equal(0)
    })
  })
})
