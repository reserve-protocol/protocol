import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs'
import { expect } from 'chai'
import { signERC2612Permit } from 'eth-permit'
import { BigNumber, ContractFactory } from 'ethers'
import hre, { ethers, upgrades } from 'hardhat'
import { getChainId } from '../common/blockchain-utils'
import { setOraclePrice } from './utils/oracles'
import { bn, fp, near, shortString } from '../common/numbers'
import { expectEvents } from '../common/events'
import {
  ERC20Mock,
  ERC1271Mock,
  StRSRP0,
  StRSRP1Votes,
  StaticATokenMock,
  IAssetRegistry,
  TestIBackingManager,
  TestIBasketHandler,
  TestIFacade,
  TestIMain,
  TestIRToken,
  TestIStRSR,
  CTokenMock,
} from '../typechain'
import { IConfig, MAX_RATIO, MAX_UNSTAKING_DELAY } from '../common/configuration'
import { CollateralStatus, MAX_UINT256, ONE_PERIOD, ZERO_ADDRESS } from '../common/constants'
import {
  advanceBlocks,
  advanceTime,
  advanceToTimestamp,
  getLatestBlockNumber,
  getLatestBlockTimestamp,
  setNextBlockTimestamp,
} from './utils/time'
import { whileImpersonating } from './utils/impersonation'
import {
  Collateral,
  defaultFixture,
  Implementation,
  IMPLEMENTATION,
  SLOW,
  VERSION,
} from './fixtures'
import { makeDecayFn, calcErr } from './utils/rewards'
import snapshotGasCost from './utils/snapshotGasCost'
import { cartesianProduct } from './utils/cases'
import { useEnv } from '#/utils/env'

const describeP1 = IMPLEMENTATION == Implementation.P1 ? describe : describe.skip

const describeGas =
  IMPLEMENTATION == Implementation.P1 && useEnv('REPORT_GAS') ? describe.only : describe.skip

const describeExtreme =
  IMPLEMENTATION == Implementation.P1 && useEnv('EXTREME') ? describe.only : describe.skip

describe(`StRSRP${IMPLEMENTATION} contract`, () => {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress
  let addr2: SignerWithAddress
  let addr3: SignerWithAddress
  let other: SignerWithAddress

  // RSR
  let rsr: ERC20Mock

  // Main
  let main: TestIMain
  let backingManager: TestIBackingManager
  let basketHandler: TestIBasketHandler
  let rToken: TestIRToken
  let facade: TestIFacade
  let assetRegistry: IAssetRegistry

  // StRSR
  let stRSR: TestIStRSR

  // Tokens/Assets
  let token0: ERC20Mock
  let token1: ERC20Mock
  let token2: StaticATokenMock
  let token3: CTokenMock
  let collateral0: Collateral
  let collateral1: Collateral
  let collateral2: Collateral
  let collateral3: Collateral

  // Config
  let config: IConfig

  // Basket
  let basket: Collateral[]
  let basketsNeededAmts: BigNumber[]

  // Quantities
  let initialBal: BigNumber
  let stkWithdrawalDelay: number

  interface IWithdrawal {
    rsrAmount: BigNumber
    availableAt: BigNumber
  }

  // Implementation-agnostic testing interface for withdrawals
  // The P1 implementation differs enough that this method of testing is highly constrained
  const expectWithdrawal = async (
    address: string,
    index: number,
    withdrawal: Partial<IWithdrawal>
  ) => {
    if (IMPLEMENTATION == Implementation.P0) {
      const stRSRP0 = <StRSRP0>await ethers.getContractAt('StRSRP0', stRSR.address)
      const [account, rsrAmount, , availableAt] = await stRSRP0.withdrawals(address, index)

      expect(account).to.eql(address)
      if (withdrawal.rsrAmount) expect(rsrAmount.toString()).to.eql(withdrawal.rsrAmount.toString())
      if (withdrawal.availableAt) {
        expect(availableAt.toString()).to.eql(withdrawal.availableAt.toString())
      }
    } else if (IMPLEMENTATION == Implementation.P1) {
      const stRSRP1 = <StRSRP1Votes>await ethers.getContractAt('StRSRP1Votes', stRSR.address)
      const [draftsCurr, availableAt] = await stRSRP1.draftQueues(1, address, index)

      const [draftsPrev] = index == 0 ? [0] : await stRSRP1.draftQueues(1, address, index - 1)
      const drafts = draftsCurr.sub(draftsPrev)

      if (withdrawal.rsrAmount) {
        const rsrAmount = fp(drafts).div(await stRSRP1.draftRate())
        expect(rsrAmount.toString()).to.eql(withdrawal.rsrAmount.toString())
      }

      if (withdrawal.availableAt) {
        expect(availableAt.toString()).to.eql(withdrawal.availableAt.toString())
      }
    } else {
      throw new Error('PROTO_IMPL must be set to either `0` or `1`')
    }
  }

  // Only used for P1, checks the length of the draft queue
  const expectDraftQueue = async (era: number, account: string, expectedValue: number) => {
    if (IMPLEMENTATION == Implementation.P1) {
      const stRSRP1 = <StRSRP1Votes>await ethers.getContractAt('StRSRP1Votes', stRSR.address)
      expect(await stRSRP1.draftQueueLen(era, account)).to.equal(expectedValue)
    } else return
  }

  beforeEach(async () => {
    ;[owner, addr1, addr2, addr3, other] = await ethers.getSigners()

    // Deploy fixture
    ;({
      rsr,
      stRSR,
      basket,
      basketsNeededAmts,
      config,
      main,
      backingManager,
      basketHandler,
      rToken,
      facade,
      assetRegistry,
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

  describe('Deployment #fast', () => {
    it('Should setup initial addresses and values correctly', async () => {
      expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
      expect(await stRSR.balanceOf(owner.address)).to.equal(0)
      expect(await stRSR.balanceOf(addr1.address)).to.equal(0)
      expect(await stRSR.balanceOf(addr2.address)).to.equal(0)

      // ERC20
      expect(await stRSR.name()).to.equal('rtknRSR Token')
      expect(await stRSR.symbol()).to.equal('rtknRSR')
      expect(await stRSR.decimals()).to.equal(18)
      expect(await stRSR.totalSupply()).to.equal(0)

      expect(await stRSR.exchangeRate()).to.equal(fp('1'))
      expect(await stRSR.unstakingDelay()).to.equal(config.unstakingDelay)
      expect(await stRSR.rewardRatio()).to.equal(config.rewardRatio)
    })

    it('Should setup the DomainSeparator for Permit correctly', async () => {
      const chainId = await getChainId(hre)
      const _name = await stRSR.name()
      const verifyingContract = stRSR.address
      expect(await stRSR.DOMAIN_SEPARATOR()).to.equal(
        await ethers.utils._TypedDataEncoder.hashDomain({
          name: _name,
          version: VERSION,
          chainId,
          verifyingContract,
        })
      )
    })

    it('Should perform validations on init', async () => {
      let StRSRFactory: ContractFactory = await ethers.getContractFactory('StRSRP0')
      let newStRSR: TestIStRSR = <TestIStRSR>await StRSRFactory.deploy()

      if (IMPLEMENTATION == Implementation.P1) {
        // Create a new StRSR
        StRSRFactory = await ethers.getContractFactory('StRSRP1Votes')
        newStRSR = <TestIStRSR>await StRSRFactory.deploy()
        newStRSR = <TestIStRSR>await upgrades.deployProxy(StRSRFactory, [], {
          kind: 'uups',
        })
      }

      await expect(
        newStRSR.init(
          main.address,
          '',
          'rtknRSR',
          config.unstakingDelay,
          config.rewardRatio,
          config.withdrawalLeak
        )
      ).to.be.reverted
      await expect(
        newStRSR.init(
          main.address,
          'rtknRSR Token',
          '',
          config.unstakingDelay,
          config.rewardRatio,
          config.withdrawalLeak
        )
      ).to.be.reverted
    })
  })

  describe('Configuration / State #fast', () => {
    it('Should allow to update unstakingDelay if Owner and perform validations', async () => {
      // Setup a new value
      const newUnstakingDelay: BigNumber = ONE_PERIOD.mul(2).add(1000)

      await expect(stRSR.connect(owner).setUnstakingDelay(newUnstakingDelay))
        .to.emit(stRSR, 'UnstakingDelaySet')
        .withArgs(config.unstakingDelay, newUnstakingDelay)

      expect(await stRSR.unstakingDelay()).to.equal(newUnstakingDelay)

      // Try to update again if not owner
      await expect(stRSR.connect(addr1).setUnstakingDelay(bn('500'))).to.be.revertedWith(
        'governance only'
      )

      // Cannot update with invalid unstaking delay
      await expect(
        stRSR.connect(owner).setUnstakingDelay(ONE_PERIOD.mul(2).sub(1))
      ).to.be.revertedWith('invalid unstakingDelay')

      // Cannot update with zero unstaking delay
      await expect(stRSR.connect(owner).setUnstakingDelay(bn(0))).to.be.revertedWith(
        'invalid unstakingDelay'
      )

      // Cannot update with unstaking delay > max
      await expect(
        stRSR.connect(owner).setUnstakingDelay(MAX_UNSTAKING_DELAY + 1)
      ).to.be.revertedWith('invalid unstakingDelay')
    })

    it('Should allow to update rewardRatio if Owner and perform validations', async () => {
      // Setup a new value
      const newRatio: BigNumber = bn('100000')

      await expect(stRSR.connect(owner).setRewardRatio(newRatio))
        .to.emit(stRSR, 'RewardRatioSet')
        .withArgs(config.rewardRatio, newRatio)

      expect(await stRSR.rewardRatio()).to.equal(newRatio)

      // Try to update again if not owner
      await expect(stRSR.connect(addr1).setRewardRatio(bn('0'))).to.be.revertedWith(
        'governance only'
      )

      // Cannot update with rewardRatio > max
      await expect(stRSR.connect(owner).setRewardRatio(MAX_RATIO.add(1))).to.be.revertedWith(
        'invalid rewardRatio'
      )
    })

    it('Should allow to update withdrawalLeak if Owner and perform validations', async () => {
      // Setup a new value
      const newLeak: BigNumber = fp('0.1') // 10%

      await expect(stRSR.connect(owner).setWithdrawalLeak(newLeak))
        .to.emit(stRSR, 'WithdrawalLeakSet')
        .withArgs(config.withdrawalLeak, newLeak)

      expect(await stRSR.withdrawalLeak()).to.equal(newLeak)

      // Try to update again if not owner
      await expect(stRSR.connect(addr1).setWithdrawalLeak(bn('0'))).to.be.revertedWith(
        'governance only'
      )

      // Cannot update with withdrawalLeak > max
      await expect(stRSR.connect(owner).setWithdrawalLeak(fp('0.3').add(1))).to.be.revertedWith(
        'invalid withdrawalLeak'
      )
    })

    it('Should payout rewards before updating the reward ratio', async () => {
      const startBal = await rsr.balanceOf(addr1.address)
      const stakeAmt = bn('100e18')
      await rsr.connect(addr1).approve(stRSR.address, stakeAmt)
      await stRSR.connect(addr1).stake(stakeAmt)

      // send some rewards
      await rsr.connect(addr2).transfer(stRSR.address, bn('10e18'))
      await setNextBlockTimestamp((await getLatestBlockTimestamp()) + 1200)

      await stRSR.setRewardRatio(bn('1e13'))
      await setNextBlockTimestamp((await getLatestBlockTimestamp()) + 1200)

      await stRSR.connect(addr1).unstake(stakeAmt)
      await setNextBlockTimestamp((await getLatestBlockTimestamp()) + 1209600)
      await stRSR.connect(addr1).withdraw(addr1.address, 1)

      const endingBal = await rsr.balanceOf(addr1.address)
      expect(endingBal.sub(startBal)).gt(0)
    })

    it('Should payout rewards when updating the reward ratio, even if frozen', async () => {
      const startBal = await rsr.balanceOf(addr1.address)
      const stakeAmt = bn('100e18')
      await rsr.connect(addr1).approve(stRSR.address, stakeAmt)
      await stRSR.connect(addr1).stake(stakeAmt)

      // send some rewards
      await rsr.connect(addr2).transfer(stRSR.address, bn('10e18'))
      await setNextBlockTimestamp((await getLatestBlockTimestamp()) + 1200)

      // Freeze Main
      await main.connect(owner).freezeShort()

      // Set reward ratio - rewards payout
      await expectEvents(stRSR.setRewardRatio(bn('1e13')), [
        {
          contract: stRSR,
          name: 'ExchangeRateSet',
          emitted: true,
        },
        {
          contract: stRSR,
          name: 'RewardsPaid',
          emitted: true,
        },
      ])

      // Unfreeze Main
      await main.connect(owner).unfreeze()
      await setNextBlockTimestamp((await getLatestBlockTimestamp()) + 1200)

      await stRSR.connect(addr1).unstake(stakeAmt)
      await setNextBlockTimestamp((await getLatestBlockTimestamp()) + 1209600)
      await stRSR.connect(addr1).withdraw(addr1.address, 1)

      // Rewards paid
      const endingBal = await rsr.balanceOf(addr1.address)
      expect(endingBal.sub(startBal)).gt(0)
    })
  })

  describe('Deposits/Staking', () => {
    it('Should not allow to stake amount = 0', async () => {
      // Perform stake
      const amount: BigNumber = bn('1000e18')
      const zero: BigNumber = bn(0)

      // Approve transfer and stake
      await rsr.connect(addr1).approve(stRSR.address, amount)
      await expect(stRSR.connect(addr1).stake(zero)).to.be.revertedWith('zero amount')

      // Check deposit not registered
      expect(await rsr.balanceOf(stRSR.address)).to.equal(0)
      expect(await rsr.balanceOf(stRSR.address)).to.equal(await stRSR.totalSupply())
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal)
      expect(await stRSR.balanceOf(addr1.address)).to.equal(0)
    })

    it('Should not allow to stake from the zero address', async () => {
      // Perform stake
      const amount: BigNumber = bn('1000e18')

      if (IMPLEMENTATION == Implementation.P0) {
        await whileImpersonating(ZERO_ADDRESS, async (signer) => {
          await expect(stRSR.connect(signer).stake(amount)).to.be.revertedWith(
            'ERC20: insufficient allowance'
          )
        })
      } else if (IMPLEMENTATION == Implementation.P1) {
        await whileImpersonating(ZERO_ADDRESS, async (signer) => {
          await expect(stRSR.connect(signer).stake(amount)).to.be.revertedWith('zero address')
        })
      }
    })

    it('Should allow to stake if Main is Paused', async () => {
      // Perform stake
      const amount: BigNumber = bn('1000e18')

      // Pause Main
      await main.connect(owner).pauseTrading()
      await main.connect(owner).pauseIssuance()

      // Approve transfer and stake
      await rsr.connect(addr1).approve(stRSR.address, amount)
      await stRSR.connect(addr1).stake(amount)

      // Check deposit registered
      expect(await rsr.balanceOf(stRSR.address)).to.equal(amount)
      expect(await rsr.balanceOf(stRSR.address)).to.equal(amount)
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(amount))
      expect(await stRSR.balanceOf(addr1.address)).to.equal(amount)
    })

    it('Should still allow to stake if frozen', async () => {
      // This is crucial for governace to function

      // Perform stake
      const amount: BigNumber = bn('1000e18')

      // Freeze Main
      await main.connect(owner).freezeShort()

      // Approve transfer and stake
      await rsr.connect(addr1).approve(stRSR.address, amount)
      await stRSR.connect(addr1).stake(amount)
      expect(await stRSR.balanceOf(addr1.address)).to.equal(amount)
    })

    it('Should allow to stake/deposit in RSR', async () => {
      // Perform stake
      const amount: BigNumber = bn('1000e18')

      // Approve transfer and stake
      await rsr.connect(addr1).approve(stRSR.address, amount)
      await expect(stRSR.connect(addr1).stake(amount))
        .to.emit(stRSR, 'Staked')
        .withArgs(1, addr1.address, amount, amount)

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
        .withArgs(1, addr1.address, amount1, amount1)
      await expect(stRSR.connect(addr1).stake(amount2))
        .to.emit(stRSR, 'Staked')
        .withArgs(1, addr1.address, amount2, amount2)

      // New stake from different account
      await rsr.connect(addr2).approve(stRSR.address, amount3)
      await expect(stRSR.connect(addr2).stake(amount3))
        .to.emit(stRSR, 'Staked')
        .withArgs(1, addr2.address, amount3, amount3)

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
      await expect(stRSR.connect(addr1).unstake(zero)).to.be.revertedWith('zero amount')
    })

    it('Should not allow to unstake if not enough balance', async () => {
      const amount: BigNumber = bn('1000e18')

      // Unstake with no stakes/balance
      await expect(stRSR.connect(addr1).unstake(amount)).to.be.revertedWith('insufficient balance')
    })

    it('Should not unstake if paused', async () => {
      await main.connect(owner).pauseTrading()
      await expect(stRSR.connect(addr1).unstake(0)).to.be.revertedWith('frozen or trading paused')
    })

    it('Should not unstake if frozen', async () => {
      await main.connect(owner).freezeShort()
      await expect(stRSR.connect(addr1).unstake(0)).to.be.revertedWith('frozen or trading paused')
    })

    it('Should emit UnstakingStarted event with draftEra -- regression test 01/18/2024', async () => {
      const amount: BigNumber = bn('1000e18')

      // Stake
      await rsr.connect(addr1).approve(stRSR.address, amount)
      await stRSR.connect(addr1).stake(amount)

      // Seize half the RSR, bumping the draftEra because the withdrawal queue is empty
      await whileImpersonating(backingManager.address, async (signer) => {
        await stRSR.connect(signer).seizeRSR(amount.div(2))
      })

      // Unstake
      await expect(stRSR.connect(addr1).unstake(amount))
        .emit(stRSR, 'UnstakingStarted')
        .withArgs(0, 2, addr1.address, amount.div(2), amount, anyValue)
    })

    it('Should create Pending withdrawal when unstaking', async () => {
      const amount: BigNumber = bn('1000e18')

      // Stake
      await rsr.connect(addr1).approve(stRSR.address, amount)
      await stRSR.connect(addr1).stake(amount)
      const availableAt = (await getLatestBlockTimestamp()) + config.unstakingDelay.toNumber() + 1

      // Set next block timestamp - for deterministic result
      await setNextBlockTimestamp((await getLatestBlockTimestamp()) + 1)

      // Unstake
      await expect(stRSR.connect(addr1).unstake(amount))
        .emit(stRSR, 'UnstakingStarted')
        .withArgs(0, 1, addr1.address, amount, amount, availableAt)

      // Check withdrawal properly registered
      await expectWithdrawal(addr1.address, 0, { rsrAmount: amount })

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

      // Set next block timestamp - for deterministic result
      await setNextBlockTimestamp((await getLatestBlockTimestamp()) + 1)

      // Unstake - Create withdrawal
      await expect(stRSR.connect(addr1).unstake(amount1))
        .emit(stRSR, 'UnstakingStarted')
        .withArgs(0, 1, addr1.address, amount1, amount1, availableAt)

      await expectWithdrawal(addr1.address, 0, { rsrAmount: amount1 })

      // Check draftQueueLen
      await expectDraftQueue(1, addr1.address, 1)

      // All staked funds withdrawn upfront
      expect(await stRSR.balanceOf(addr1.address)).to.equal(amount2)

      availableAt = (await getLatestBlockTimestamp()) + config.unstakingDelay.toNumber() + 1

      // Set next block timestamp - for deterministic result
      await setNextBlockTimestamp((await getLatestBlockTimestamp()) + 1)

      // Unstake again
      await expect(stRSR.connect(addr1).unstake(amount2))
        .emit(stRSR, 'UnstakingStarted')
        .withArgs(1, 1, addr1.address, amount2, amount2, availableAt)

      await expectWithdrawal(addr1.address, 1, { rsrAmount: amount2 })

      await expectDraftQueue(1, addr1.address, 2)

      // All staked funds withdrawn upfront
      expect(await stRSR.balanceOf(addr1.address)).to.equal(0)

      availableAt = (await getLatestBlockTimestamp()) + config.unstakingDelay.toNumber() + 1

      // Set next block timestamp - for deterministic result
      await setNextBlockTimestamp((await getLatestBlockTimestamp()) + 1)

      // Unstake again with different user
      await expect(stRSR.connect(addr2).unstake(amount3))
        .emit(stRSR, 'UnstakingStarted')
        .withArgs(0, 1, addr2.address, amount3, amount3, availableAt)

      await expectWithdrawal(addr2.address, 0, { rsrAmount: amount3 })

      await expectDraftQueue(1, addr1.address, 2)
      await expectDraftQueue(1, addr2.address, 1)

      // All staked funds withdrawn upfront
      expect(await stRSR.balanceOf(addr2.address)).to.equal(0)

      // Exchange rate remains steady
      expect(await stRSR.exchangeRate()).to.equal(fp('1'))
    })

    it('Should allow cancelling unstaking', async () => {
      const amount: BigNumber = bn('1000e18')

      // Stake
      await rsr.connect(addr1).approve(stRSR.address, amount)
      await stRSR.connect(addr1).stake(amount)
      const availableAt = (await getLatestBlockTimestamp()) + config.unstakingDelay.toNumber() + 1

      // Set next block timestamp - for deterministic result
      await setNextBlockTimestamp((await getLatestBlockTimestamp()) + 1)

      // Unstake
      await expect(stRSR.connect(addr1).unstake(amount))
        .emit(stRSR, 'UnstakingStarted')
        .withArgs(0, 1, addr1.address, amount, amount, availableAt)

      // Check withdrawal properly registered
      await expectWithdrawal(addr1.address, 0, { rsrAmount: amount })

      // Check balances and stakes
      expect(await rsr.balanceOf(stRSR.address)).to.equal(amount)
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(amount))

      // All staked funds withdrawn upfront
      expect(await stRSR.balanceOf(addr1.address)).to.equal(0)
      expect(await stRSR.totalSupply()).to.equal(0)

      // Exchange rate remains steady
      expect(await stRSR.exchangeRate()).to.equal(fp('1'))

      // Cancelling the unstake with invalid index does nothing
      await expect(stRSR.connect(addr1).cancelUnstake(0)).to.not.emit(stRSR, 'UnstakingCancelled')
      await expect(stRSR.connect(addr1).cancelUnstake(2)).to.be.revertedWith('index out-of-bounds')
      expect(await stRSR.balanceOf(addr1.address)).to.equal(0)
      expect(await stRSR.totalSupply()).to.equal(0)

      // Let's cancel the unstake
      await expect(stRSR.connect(addr1).cancelUnstake(1)).to.emit(stRSR, 'UnstakingCancelled')

      // Check balances and stakes
      expect(await stRSR.balanceOf(addr1.address)).to.equal(amount)
      expect(await stRSR.totalSupply()).to.equal(amount)
      expect(await rsr.balanceOf(stRSR.address)).to.equal(amount) // RSR is still in the contract
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(amount)) // RSR wasn't returned
    })

    it('Should not allow to cancel unstake if frozen', async () => {
      const amount: BigNumber = bn('1000e18')

      // Stake
      await rsr.connect(addr1).approve(stRSR.address, amount)
      await stRSR.connect(addr1).stake(amount)

      // Unstake
      await stRSR.connect(addr1).unstake(amount)

      // Freeze Main
      await main.connect(owner).freezeShort()

      // Attempt to cancel unstake
      await expect(stRSR.connect(addr1).cancelUnstake(1)).to.be.revertedWith('frozen')
    })

    describe('Withdrawal Leak', () => {
      const withdrawalLeak = fp('0.1') // 10%
      const stake = bn('1000e18')

      beforeEach(async () => {
        stkWithdrawalDelay = bn(await stRSR.unstakingDelay()).toNumber()

        // Stake
        await rsr.connect(addr1).approve(stRSR.address, stake)
        await stRSR.connect(addr1).stake(stake)

        // Set Withdrawal Leak
        await expect(stRSR.connect(owner).setWithdrawalLeak(withdrawalLeak))
          .to.emit(stRSR, 'WithdrawalLeakSet')
          .withArgs(config.withdrawalLeak, withdrawalLeak)
      })

      it('Should refresh above withdrawal leak only', async () => {
        const withdrawal = stake.mul(withdrawalLeak).div(fp('1'))
        await stRSR.connect(addr1).unstake(withdrawal)
        await stRSR.connect(addr1).unstake(1)
        await stRSR.connect(addr1).unstake(1)

        // Move forward past stakingWithdrawalDelaylay
        await advanceToTimestamp(Number(await getLatestBlockTimestamp()) + stkWithdrawalDelay)

        let lastRefresh = await assetRegistry.lastRefresh()

        // Should not refresh
        await stRSR.withdraw(addr1.address, 1)
        expect(await assetRegistry.lastRefresh()).to.eq(lastRefresh)

        // Should refresh
        await stRSR.withdraw(addr1.address, 2)
        expect(await assetRegistry.lastRefresh()).to.be.gt(lastRefresh)
        lastRefresh = await assetRegistry.lastRefresh()

        // Should not refresh
        await stRSR.withdraw(addr1.address, 3)
        expect(await assetRegistry.lastRefresh()).to.eq(lastRefresh)
      })

      it('Should prevent unstaking', async () => {
        const withdrawal = stake.mul(withdrawalLeak).div(fp('1')).add(1)
        await stRSR.connect(addr1).unstake(withdrawal)

        // Move forward past stakingWithdrawalDelaylay
        await advanceToTimestamp(Number(await getLatestBlockTimestamp()) + stkWithdrawalDelay)

        // Depeg collateral
        await setOraclePrice(collateral1.address, bn('0.5e8'))
        await expect(stRSR.withdraw(addr1.address, 1)).to.be.revertedWith('RToken readying')
      })
    })

    context('With deposits and withdrawals', () => {
      let amount1: BigNumber
      let amount2: BigNumber
      let amount3: BigNumber

      beforeEach(async () => {
        stkWithdrawalDelay = bn(await stRSR.unstakingDelay()).toNumber()

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

      it('Should revert withdraw if Main is paused', async () => {
        // Get current balance for user
        const prevAddr1Balance = await rsr.balanceOf(addr1.address)

        // Move forward past stakingWithdrawalDelay
        await setNextBlockTimestamp(Number(await getLatestBlockTimestamp()) + stkWithdrawalDelay)

        // Pause Main
        await main.connect(owner).pauseTrading()

        // Withdraw
        await expect(stRSR.connect(addr1).withdraw(addr1.address, 1)).to.be.revertedWith(
          'frozen or trading paused'
        )

        // If unpaused should withdraw OK
        await main.connect(owner).unpauseTrading()

        // Withdraw
        await stRSR.connect(addr1).withdraw(addr1.address, 1)

        // Withdrawal was completed
        expect(await stRSR.totalSupply()).to.equal(amount2.add(amount3))
        expect(await rsr.balanceOf(stRSR.address)).to.equal(await stRSR.totalSupply())
        expect(await rsr.balanceOf(addr1.address)).to.equal(prevAddr1Balance.add(amount1))
        expect(await stRSR.balanceOf(addr1.address)).to.equal(0)
      })

      it('Should revert withdraw if Main is frozen', async () => {
        // Get current balance for user
        const prevAddr1Balance = await rsr.balanceOf(addr1.address)

        // Move forward past stakingWithdrawalDelay
        await setNextBlockTimestamp(Number(await getLatestBlockTimestamp()) + stkWithdrawalDelay)

        // Freeze Main
        await main.connect(owner).freezeShort()

        // Withdraw
        await expect(stRSR.connect(addr1).withdraw(addr1.address, 1)).to.be.revertedWith(
          'frozen or trading paused'
        )

        // If unpaused should withdraw OK
        await main.connect(owner).unfreeze()

        // Withdraw
        await stRSR.connect(addr1).withdraw(addr1.address, 1)

        // Withdrawal was completed
        expect(await stRSR.totalSupply()).to.equal(amount2.add(amount3))
        expect(await rsr.balanceOf(stRSR.address)).to.equal(await stRSR.totalSupply())
        expect(await rsr.balanceOf(addr1.address)).to.equal(prevAddr1Balance.add(amount1))
        expect(await stRSR.balanceOf(addr1.address)).to.equal(0)
      })

      it('Should not complete withdrawal if not fully collateralized', async () => {
        // Need to issue some RTokens to handle fully/not fully collateralized
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
        await setNextBlockTimestamp(Number(await getLatestBlockTimestamp()) + stkWithdrawalDelay)

        const erc20s = await facade.basketTokens(rToken.address)

        // Set not fully collateralized by changing basket
        await basketHandler.connect(owner).setPrimeBasket([token0.address], [fp('1')])
        await basketHandler.connect(owner).refreshBasket()
        expect(await basketHandler.fullyCollateralized()).to.equal(false)

        // Withdraw
        await expect(stRSR.connect(addr1).withdraw(addr1.address, 1)).to.be.revertedWith(
          'RToken readying'
        )

        // If fully collateralized should withdraw OK  - Set back original basket
        await basketHandler.connect(owner).setPrimeBasket(erc20s, basketsNeededAmts)
        await basketHandler.connect(owner).refreshBasket()

        expect(await basketHandler.fullyCollateralized()).to.equal(true)

        // Withdraw
        await stRSR.connect(addr1).withdraw(addr1.address, 1)

        // Withdrawal completed
        expect(await stRSR.totalSupply()).to.equal(amount2.add(amount3))
        expect(await rsr.balanceOf(stRSR.address)).to.equal(await stRSR.totalSupply())
        expect(await rsr.balanceOf(addr1.address)).to.equal(prevAddr1Balance.add(amount1))
        // All staked funds withdrawn upfront
        expect(await stRSR.balanceOf(addr1.address)).to.equal(0)
      })

      it('Should not complete withdrawal if IFFY or DISABLED', async () => {
        // Move forward past stakingWithdrawalDelay
        await setNextBlockTimestamp(Number(await getLatestBlockTimestamp()) + stkWithdrawalDelay)

        // Set Token1 to default - 50% price reduction and mark default as probable
        await setOraclePrice(collateral1.address, bn('0.5e8'))
        await collateral1.refresh()
        expect(await basketHandler.status()).to.equal(CollateralStatus.IFFY)
        expect(await basketHandler.fullyCollateralized()).to.equal(true)

        // Attempt to Withdraw
        await expect(stRSR.connect(addr1).withdraw(addr1.address, 1)).to.be.revertedWith(
          'RToken readying'
        )

        // Nothing completed
        expect(await stRSR.totalSupply()).to.equal(amount2.add(amount3))
        expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(amount1))
        expect(await stRSR.balanceOf(addr1.address)).to.equal(0)

        // Move past DELAY_UNTIL_DEFAULT
        await setNextBlockTimestamp(
          (await collateral1.delayUntilDefault()) + (await getLatestBlockTimestamp())
        )

        // Still can't withdraw
        await collateral1.refresh()
        expect(await basketHandler.status()).to.equal(CollateralStatus.DISABLED)
        expect(await basketHandler.fullyCollateralized()).to.equal(true)

        // Attempt to Withdraw
        await expect(stRSR.connect(addr1).withdraw(addr1.address, 1)).to.be.revertedWith(
          'RToken readying'
        )
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
        await setNextBlockTimestamp(
          Number(await getLatestBlockTimestamp()) + stkWithdrawalDelay / 2
        )

        await expect(stRSR.connect(addr1).withdraw(addr1.address, 1)).to.be.revertedWith(
          'withdrawal unavailable'
        )

        // Nothing completed still
        expect(await stRSR.totalSupply()).to.equal(amount2.add(amount3))
        expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(amount1))
        expect(await stRSR.balanceOf(addr1.address)).to.equal(0)
      })

      it('Should not withdraw if firstId >= endId', async () => {
        const prevAddr1Balance = await rsr.balanceOf(addr1.address)

        await setNextBlockTimestamp(Number(await getLatestBlockTimestamp()) + stkWithdrawalDelay)

        // Withdraw
        await stRSR.connect(addr1).withdraw(addr1.address, 1)

        // Withdrawal was completed
        expect(await stRSR.totalSupply()).to.equal(amount2.add(amount3))
        expect(await rsr.balanceOf(stRSR.address)).to.equal(await stRSR.totalSupply())
        expect(await rsr.balanceOf(addr1.address)).to.equal(prevAddr1Balance.add(amount1))

        // withdraw with same ID, nothing happens
        await stRSR.connect(addr1).withdraw(addr1.address, 1)

        // Nothing changed since second withdrawal
        expect(await stRSR.totalSupply()).to.equal(amount2.add(amount3))
        expect(await rsr.balanceOf(stRSR.address)).to.equal(await stRSR.totalSupply())
        expect(await rsr.balanceOf(addr1.address)).to.equal(prevAddr1Balance.add(amount1))
      })

      it('Should withdraw after stakingWithdrawalDelay', async () => {
        // Get current balance for user
        const prevAddr1Balance = await rsr.balanceOf(addr1.address)

        // Move forward past stakingWithdrawalDelay
        await setNextBlockTimestamp(Number(await getLatestBlockTimestamp()) + stkWithdrawalDelay)

        // Attempt to withdraw with zero index, nothing happens
        await stRSR.connect(addr1).withdraw(addr1.address, 0)

        // Attempt to withdraw with index > number of withdrawals
        await expect(stRSR.connect(addr1).withdraw(addr1.address, 5)).to.be.revertedWith(
          'index out-of-bounds'
        )

        // Nothing compeleted still
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

        expect(await stRSR.endIdForWithdraw(addr1.address)).to.equal(0)
        expect(await stRSR.endIdForWithdraw(addr2.address)).to.equal(0)

        // Create additional withdrawal
        await stRSR.connect(addr2).unstake(amount2)

        // Move forward past stakingWithdrawalDelaylay
        await advanceToTimestamp(Number(await getLatestBlockTimestamp()) + stkWithdrawalDelay)

        expect(await stRSR.endIdForWithdraw(addr1.address)).to.equal(1)
        expect(await stRSR.endIdForWithdraw(addr2.address)).to.equal(1)

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
        await advanceToTimestamp(Number(await getLatestBlockTimestamp()) + stkWithdrawalDelay)

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

      it('Should calculate available withdrawals correctly', async function () {
        // Create an additional third stake for user 2
        await rsr.connect(addr2).approve(stRSR.address, amount3)
        await stRSR.connect(addr2).stake(amount3)

        // Get current balances for users
        const prevAddr1Balance = await rsr.balanceOf(addr1.address)
        const prevAddr2Balance = await rsr.balanceOf(addr2.address)

        // Create withdrawal for user 2
        await stRSR.connect(addr2).unstake(amount2)

        // Move time forward to half of first period
        await setNextBlockTimestamp(
          Number(await getLatestBlockTimestamp()) + stkWithdrawalDelay / 2
        )

        // Create additional withdrawal for user 2
        await stRSR.connect(addr2).unstake(amount3)

        // Check withdrawals - Nothing available yet
        expect(await stRSR.endIdForWithdraw(addr1.address)).to.equal(0)
        expect(await stRSR.endIdForWithdraw(addr2.address)).to.equal(0)

        // Move time forward to first period complete
        await advanceToTimestamp(Number(await getLatestBlockTimestamp()) + stkWithdrawalDelay / 2)

        // Check withdrawals - We can withdraw the first stakes for each
        expect(await stRSR.endIdForWithdraw(addr1.address)).to.equal(1)
        expect(await stRSR.endIdForWithdraw(addr2.address)).to.equal(1)

        // Create additional withdrawal for user 2
        await stRSR.connect(addr2).unstake(amount3)

        // Move time forward to end of second period
        await advanceToTimestamp(Number(await getLatestBlockTimestamp()) + stkWithdrawalDelay / 2)

        // Check withdrawals - We can withdraw the second stake for user 2
        expect(await stRSR.endIdForWithdraw(addr1.address)).to.equal(1)
        expect(await stRSR.endIdForWithdraw(addr2.address)).to.equal(2)

        // Move time forward to end of all periods
        await advanceToTimestamp(Number(await getLatestBlockTimestamp()) + stkWithdrawalDelay * 2)

        // Check withdrawals - We can withdraw the third stake for user 2
        expect(await stRSR.endIdForWithdraw(addr1.address)).to.equal(1)
        expect(await stRSR.endIdForWithdraw(addr2.address)).to.equal(3)

        // Withdraw
        await stRSR
          .connect(addr1)
          .withdraw(addr1.address, await stRSR.endIdForWithdraw(addr1.address))
        await stRSR
          .connect(addr2)
          .withdraw(addr2.address, await stRSR.endIdForWithdraw(addr2.address))

        // Withdrawals completed
        expect(await stRSR.totalSupply()).to.equal(0)
        expect(await rsr.balanceOf(stRSR.address)).to.equal(await stRSR.totalSupply())
        expect(await rsr.balanceOf(addr1.address)).to.equal(prevAddr1Balance.add(amount1))
        expect(await stRSR.balanceOf(addr1.address)).to.equal(0)
        expect(await rsr.balanceOf(addr2.address)).to.equal(
          prevAddr2Balance.add(amount2).add(amount3).add(amount3)
        )
        expect(await stRSR.balanceOf(addr2.address)).to.equal(0)

        /// Exchange rate remains steady
        expect(await stRSR.exchangeRate()).to.equal(fp('1'))
      })

      it('Allow cancelling unstake with multiple withdraws', async function () {
        // Create an additional third stake for user 2
        await rsr.connect(addr2).approve(stRSR.address, amount3)
        await stRSR.connect(addr2).stake(amount3)

        // Create 1st withdrawal for user 2
        await stRSR.connect(addr2).unstake(amount2)

        // Move time forward to half of first period
        await setNextBlockTimestamp(
          Number(await getLatestBlockTimestamp()) + stkWithdrawalDelay / 2
        )

        await hre.network.provider.send('evm_setAutomine', [false])

        // Send reward RSR -- bn('3e18')
        await rsr.connect(addr1).transfer(stRSR.address, amount3)
        await stRSR.connect(owner).setRewardRatio(bn('1e14')) // handout max ratio

        // Create 2nd withdrawal for user 2 -- should unstake at 1:1 rate
        expect(await stRSR.exchangeRate()).to.equal(fp('1'))
        await stRSR.connect(addr2).unstake(amount3)

        await hre.network.provider.send('evm_setAutomine', [true])

        // Mine block
        await advanceTime(1)

        expect(await stRSR.exchangeRate()).to.equal(fp('1'))

        // Check withdrawals - Nothing available yet
        expect(await stRSR.endIdForWithdraw(addr1.address)).to.equal(0)
        expect(await stRSR.endIdForWithdraw(addr2.address)).to.equal(0)

        // Move time forward 3/4 of way to first period complete
        await setNextBlockTimestamp(
          Number(await getLatestBlockTimestamp()) + stkWithdrawalDelay / 4
        )

        // Cancel 1st withdrawal
        await stRSR.connect(addr2).cancelUnstake(1)

        // Calculate new exchange rate ~1.91 -- regression test
        const decayFn = makeDecayFn(await stRSR.rewardRatio())
        const numRounds = stkWithdrawalDelay / 4
        const rewardHandout = amount3.sub(decayFn(amount3, numRounds))
        const newExchangeRate = amount3.add(rewardHandout).mul(fp('1')).div(amount3).add(1)
        expect(await stRSR.exchangeRate()).to.be.closeTo(newExchangeRate, bn(200))

        // Move time forward to first period complete
        await advanceToTimestamp(Number(await getLatestBlockTimestamp()) + stkWithdrawalDelay / 4)

        // Check withdrawals - We can withdraw the first stakes for each
        expect(await stRSR.endIdForWithdraw(addr1.address)).to.equal(1)
        expect(await stRSR.endIdForWithdraw(addr2.address)).to.equal(1)

        // Create 3rd withdrawal for user 2
        await stRSR.connect(addr2).unstake(amount3)

        // Move time forward to end of second period
        await advanceToTimestamp(Number(await getLatestBlockTimestamp()) + stkWithdrawalDelay / 2)

        // Check withdrawals - We can withdraw the second stake for user 2
        expect(await stRSR.endIdForWithdraw(addr1.address)).to.equal(1)
        expect(await stRSR.endIdForWithdraw(addr2.address)).to.equal(2)

        // Move time forward to end of all periods
        await advanceToTimestamp(Number(await getLatestBlockTimestamp()) + stkWithdrawalDelay * 2)

        // Check withdrawals - We can withdraw the third stake for user 2
        expect(await stRSR.endIdForWithdraw(addr1.address)).to.equal(1)
        expect(await stRSR.endIdForWithdraw(addr2.address)).to.equal(3)

        // Cancelling the unstake with invalid index does nothing
        await expect(stRSR.connect(addr2).cancelUnstake(1)).to.not.emit(stRSR, 'UnstakingCancelled')
        await expect(stRSR.connect(addr2).cancelUnstake(4)).to.be.revertedWith(
          'index out-of-bounds'
        )

        // Withdraw everything
        await stRSR.connect(addr1).withdraw(addr1.address, 1)
        await stRSR.connect(addr2).withdraw(addr2.address, 3)
        expect(await stRSR.balanceOf(addr1.address)).to.equal(0)
        expect(await stRSR.totalSupply()).to.be.gt(amount1)
        expect(await stRSR.totalSupply()).to.be.lt(amount1.add(amount1.div(20))) // 5%

        /// Exchange rate should increase
        expect(await stRSR.exchangeRate()).to.be.gt(newExchangeRate)
      })

      it('Should handle changes in stakingWithdrawalDelay correctly', async function () {
        // Get current balance for user 2
        const prevAddr2Balance = await rsr.balanceOf(addr2.address)

        // Create first withdrawal for user 2
        await stRSR.connect(addr2).unstake(amount2)

        // Reduce staking withdrawal delay significantly - Also need to update rewardPeriod
        const newUnstakingDelay: BigNumber = bn(172800) // 2 days

        await expect(stRSR.connect(owner).setUnstakingDelay(newUnstakingDelay))
          .to.emit(stRSR, 'UnstakingDelaySet')
          .withArgs(config.unstakingDelay, newUnstakingDelay)

        // Perform another withdrawal for user 2, with shorter period
        await stRSR.connect(addr2).unstake(amount3)

        // Move forward time past this second stake
        // Should not be processed, only after the first pending stake is done
        await advanceToTimestamp(Number(newUnstakingDelay.add(await getLatestBlockTimestamp())))

        // Check withdrawals - Nothing available yet
        expect(await stRSR.endIdForWithdraw(addr2.address)).to.equal(0)

        // Nothing completed still
        expect(await stRSR.totalSupply()).to.equal(0)
        expect(await rsr.balanceOf(addr2.address)).to.equal(prevAddr2Balance)
        // All staked funds withdrawn upfront
        expect(await stRSR.balanceOf(addr2.address)).to.equal(0)

        // Move forward past first stakingWithdrawalDelay
        await advanceToTimestamp(Number(await getLatestBlockTimestamp()) + stkWithdrawalDelay)

        //  Check withdrawals - We can withdraw both stakes
        expect(await stRSR.endIdForWithdraw(addr2.address)).to.equal(2)

        // Withdraw with correct index
        await stRSR.connect(addr2).withdraw(addr2.address, 2)

        // Withdrawals were completed
        expect(await stRSR.totalSupply()).to.equal(0)
        expect(await rsr.balanceOf(stRSR.address)).to.equal(amount1) // Still pending the withdraw for user1
        expect(await rsr.balanceOf(addr2.address)).to.equal(
          prevAddr2Balance.add(amount2).add(amount3)
        )
        // All staked funds withdrawn upfront
        expect(await stRSR.balanceOf(addr2.address)).to.equal(0)

        // Exchange rate remains steady
        expect(await stRSR.exchangeRate()).to.equal(fp('1'))
      })

      describeP1('Should be able to view staking/withdrawal quantities', () => {
        let stRSRP1: StRSRP1Votes

        beforeEach(async () => {
          stRSRP1 = await ethers.getContractAt('StRSRP1Votes', stRSR.address)
        })

        it('Should read draftRSR', async () => {
          expect(await stRSRP1.getDraftRSR()).to.equal(amount1)
        })

        it('Should read stakeRSR', async () => {
          expect(await stRSRP1.getStakeRSR()).to.equal(amount2.add(amount3))
        })

        it('Should read totalDrafts', async () => {
          expect(await stRSRP1.getTotalDrafts()).to.equal(amount1)
        })
      })
    })
  })

  describe('Add RSR / Rewards', () => {
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
      await setNextBlockTimestamp(Number(ONE_PERIOD.add(await getLatestBlockTimestamp())))

      await expectEvents(stRSR.payoutRewards(), [
        {
          contract: stRSR,
          name: 'ExchangeRateSet',
          args: [initialRate, initialRate],
          emitted: true,
        },
        {
          contract: stRSR,
          name: 'RewardsPaid',
          args: [0],
          emitted: true,
        },
      ])

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

    it('Rewards should be handed out on subsequent staking', async () => {
      // Stake 1
      await rsr.connect(addr1).approve(stRSR.address, stake)
      await stRSR.connect(addr1).stake(stake)

      await setNextBlockTimestamp(Number(ONE_PERIOD.add(await getLatestBlockTimestamp())))
      expect(await stRSR.exchangeRate()).to.equal(initialRate)

      // Stake 2
      await rsr.connect(addr2).approve(stRSR.address, stake)
      await stRSR.connect(addr2).stake(stake)

      // Should get new exchange rate
      expect(await stRSR.balanceOf(addr1.address)).to.equal(stake)
      expect(await stRSR.balanceOf(addr2.address)).to.be.lt(stake)
      expect(await rsr.balanceOf(stRSR.address)).to.equal(stake.mul(2).add(amountAdded))
      expect(await stRSR.exchangeRate()).to.be.gt(initialRate)
    })

    it('Rewards should be handed, even if frozen', async () => {
      // Stake
      await rsr.connect(addr1).approve(stRSR.address, stake)
      await stRSR.connect(addr1).stake(stake)

      await setNextBlockTimestamp(Number(ONE_PERIOD.add(await getLatestBlockTimestamp())))
      expect(await stRSR.exchangeRate()).to.equal(initialRate)

      // Freeze main
      await main.connect(owner).freezeShort()

      // Payout rewards
      await stRSR.payoutRewards()

      // Should get new exchange rate
      expect(await stRSR.balanceOf(addr1.address)).to.equal(stake)
      expect(await rsr.balanceOf(stRSR.address)).to.equal(stake.add(amountAdded))
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(stake))
      expect(await stRSR.exchangeRate()).to.be.gt(initialRate)
    })

    it('Rewards should not be handed out when paused but staking should still work', async () => {
      await main.connect(owner).pauseTrading()
      await setNextBlockTimestamp(Number(ONE_PERIOD.add(await getLatestBlockTimestamp())))

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
      await setNextBlockTimestamp((await getLatestBlockTimestamp()) + 1)

      // Calculate payout amount
      const addedRSRStake = amountAdded.sub(decayFn(amountAdded, 1)) // 1 round
      const newRate: BigNumber = fp(stake.add(addedRSRStake)).div(stake)

      // Payout rewards
      await expectEvents(stRSR.payoutRewards(), [
        {
          contract: stRSR,
          name: 'ExchangeRateSet',
          emitted: true,
        },
        {
          contract: stRSR,
          name: 'RewardsPaid',
          args: [addedRSRStake],
          emitted: true,
        },
      ])
      expect(await stRSR.exchangeRate()).to.be.closeTo(newRate, 1)
      expect(await stRSR.exchangeRate()).to.be.lte(newRate)

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
      await setNextBlockTimestamp((await getLatestBlockTimestamp()) + 1)

      // Calculate payout amount
      const addedRSRStake = amountAdded.sub(decayFn(amountAdded, 1)) // 1 round
      const newRate: BigNumber = fp(stake.add(addedRSRStake)).div(stake)

      // Payout rewards
      await expect(stRSR.payoutRewards()).to.emit(stRSR, 'ExchangeRateSet')
      expect(await stRSR.exchangeRate()).to.be.closeTo(newRate, 1)
      expect(await stRSR.exchangeRate()).to.be.lte(newRate)

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
      let error = bn('2')
      for (let i = 0; i < 100; i++) {
        // Advance to get 1 round of rewards
        await setNextBlockTimestamp(Number(await getLatestBlockTimestamp()) + 1)

        // Calculate payout amount, as if closed-form from the beginning
        const addedRSRStake = amountAdded.sub(decayFn(amountAdded, 1 + i)) // 1+i rounds
        const newRate: BigNumber = fp(stake.add(addedRSRStake)).add(stake.div(2)).div(stake)

        // Payout rewards
        await expect(stRSR.payoutRewards()).to.emit(stRSR, 'ExchangeRateSet')

        // error = error.add(calcErr(1)) // this is just adding 1 each time
        error = error.add(calcErr(2))

        // Check exchange rate does not exceed more than the acceptable amount per round
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

      // Advance to get 100 rounds of rewards
      await setNextBlockTimestamp((await getLatestBlockTimestamp()) + 100)

      // Calculate payout amount as if it were a closed form calculation from start
      const addedRSRStake = amountAdded.sub(decayFn(amountAdded, 100))
      const newRate: BigNumber = fp(stake.add(addedRSRStake)).add(stake.div(2)).div(stake)

      // Payout rewards
      await expect(stRSR.payoutRewards()).to.emit(stRSR, 'ExchangeRateSet')
      // const error = calcErr(100)
      const error = 100

      // Check exchange rate is greater by at-most half
      expect((await stRSR.exchangeRate()).sub(newRate).abs()).to.be.lte(error)

      // Check new balances and stakes
      expect(await rsr.balanceOf(stRSR.address)).to.equal(stake.add(amountAdded))
      expect(await rsr.balanceOf(stRSR.address)).to.be.gt(await stRSR.totalSupply())
      // No change for stakers
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(stake))
      expect(await stRSR.balanceOf(addr1.address)).to.equal(stake)
    })
  })

  describe('Remove RSR #fast', () => {
    it('Should not allow to remove RSR if caller is not backing manager', async () => {
      const amount: BigNumber = bn('1e18')
      const prevPoolBalance: BigNumber = await rsr.balanceOf(stRSR.address)

      await whileImpersonating(basketHandler.address, async (signer) => {
        await expect(stRSR.connect(signer).seizeRSR(amount)).to.be.revertedWith('!bm')
      })
      expect(await rsr.balanceOf(stRSR.address)).to.equal(prevPoolBalance)

      await expect(stRSR.connect(other).seizeRSR(amount)).to.be.revertedWith('!bm')
      expect(await rsr.balanceOf(stRSR.address)).to.equal(prevPoolBalance)
    })

    it('Should not allow to remove RSR if paused', async () => {
      await main.connect(owner).pauseTrading()
      await whileImpersonating(backingManager.address, async (signer) => {
        await expect(stRSR.connect(signer).seizeRSR(1)).to.be.revertedWith(
          'frozen or trading paused'
        )
      })
    })

    it('Should not allow to remove RSR if frozen', async () => {
      await main.connect(owner).freezeShort()
      await whileImpersonating(backingManager.address, async (signer) => {
        await expect(stRSR.connect(signer).seizeRSR(1)).to.be.revertedWith(
          'frozen or trading paused'
        )
      })
    })

    it('Should not allow to remove RSR if amount is zero', async () => {
      const zero: BigNumber = bn('0')
      const prevPoolBalance: BigNumber = await rsr.balanceOf(stRSR.address)

      await whileImpersonating(backingManager.address, async (signer) => {
        await expect(stRSR.connect(signer).seizeRSR(zero)).to.be.revertedWith('zero amount')
      })

      expect(await rsr.balanceOf(stRSR.address)).to.equal(prevPoolBalance)
    })

    it('Should not allow to remove RSR if amount is larger than balance', async () => {
      const prevPoolBalance: BigNumber = await rsr.balanceOf(stRSR.address)
      const amount: BigNumber = bn('500000000e18')

      await whileImpersonating(backingManager.address, async (signer) => {
        await expect(stRSR.connect(signer).seizeRSR(amount)).to.be.revertedWith(
          'seize exceeds balance'
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

      // new rate: new strsr supply / RSR backing that strsr supply
      const newRate = fp(amount.sub(amount2)).div(amount)

      // Seize RSR
      await whileImpersonating(backingManager.address, async (signer) => {
        await expect(stRSR.connect(signer).seizeRSR(amount2)).to.emit(stRSR, 'ExchangeRateSet')
      })
      expect(await stRSR.exchangeRate()).to.be.closeTo(newRate, 1)
      expect(await stRSR.exchangeRate()).to.be.lte(newRate)

      // Check balances and stakes
      expect(await rsr.balanceOf(stRSR.address)).to.equal(amount.sub(amount2))
      expect(await stRSR.totalSupply()).to.equal(amount)
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(amount))
      expect(await stRSR.balanceOf(addr1.address)).to.equal(amount)
    })

    it('Seize RSR - Single staker after giant unstaking', async () => {
      // Regression for TOB-RES-11

      const all = bn('10000e18')
      const most = all.sub(1)
      const toSeize = bn('9999e18')

      // Stake all
      await rsr.connect(addr1).approve(stRSR.address, all)
      await stRSR.connect(addr1).stake(all)

      // Check balances and stakes
      expect(await rsr.balanceOf(stRSR.address)).to.equal(all)
      expect(await stRSR.totalSupply()).to.equal(all)
      expect(await rsr.balanceOf(addr1.address)).to.equal(0)
      expect(await stRSR.balanceOf(addr1.address)).to.equal(all)
      expect(await stRSR.exchangeRate()).to.equal(fp(1))

      // Start to unstake most
      await stRSR.connect(addr1).unstake(most)

      // Again, check expected balances
      expect(await stRSR.totalSupply()).to.equal(1) // That's not a lot!
      expect(await rsr.balanceOf(stRSR.address)).to.equal(all)
      expect(await rsr.balanceOf(addr1.address)).to.equal(0)

      // Seize most
      await whileImpersonating(backingManager.address, async (signer) => {
        await stRSR.connect(signer).seizeRSR(toSeize)
      })

      // Ensure seizure actually happened
      const rsrBal = await rsr.balanceOf(stRSR.address)
      expect(rsrBal).lte(all.sub(toSeize)) // Expect to have seized all of the toSeize amount
      expect(rsrBal).gte(all.sub(toSeize).sub(10)) // And no more than a little more.

      // Test for the TOB-RES-11 failure -- the above unstaking would leave stakeBal nonzero,
      // but unable to be unstaked.
      const stakeBal = await stRSR.balanceOf(addr1.address)
      if (stakeBal.gt(0)) {
        await stRSR.connect(addr1).unstake(stakeBal)
      }
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
        await expect(stRSR.connect(signer).seizeRSR(amount2)).to.emit(stRSR, 'ExchangeRateSet')
      })
      expect(await stRSR.exchangeRate()).to.be.closeTo(newRate, 1)
      expect(await stRSR.exchangeRate()).to.be.lte(newRate)

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
        await expect(stRSR.connect(signer).seizeRSR(amount2)).to.emit(stRSR, 'ExchangeRateSet')
      })
      expect(await stRSR.exchangeRate()).to.be.closeTo(newRate, 1)
      expect(await stRSR.exchangeRate()).to.be.lte(newRate)

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
        await expect(stRSR.connect(signer).seizeRSR(amount.mul(2)))
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

    it('Should round down below MIN_EXCHANGE_RATE - Epsilon mayhem scenario', async () => {
      const amount: BigNumber = bn('10e18')

      // Stake
      await rsr.connect(addr1).approve(stRSR.address, amount)
      await stRSR.connect(addr1).stake(amount)

      // Stake + Withdraw
      await rsr.connect(addr2).approve(stRSR.address, amount)
      await stRSR.connect(addr2).stake(amount)
      await stRSR.connect(addr2).unstake(amount)

      // Check balances and stakes
      expect(await rsr.balanceOf(stRSR.address)).to.equal(amount.mul(2))
      expect(await rsr.balanceOf(stRSR.address)).to.equal((await stRSR.totalSupply()).mul(2))
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(amount))
      expect(await rsr.balanceOf(addr2.address)).to.equal(initialBal.sub(amount))
      expect(await stRSR.balanceOf(addr1.address)).to.equal(amount)
      expect(await stRSR.balanceOf(addr2.address)).to.equal(0)
      await expectWithdrawal(addr2.address, 0, { rsrAmount: amount })

      const dustAmt = bn('20e9')
      const toSeize = amount.mul(2).sub(dustAmt).add(1)

      // Seize RSR
      await whileImpersonating(backingManager.address, async (signer) => {
        await expect(stRSR.connect(signer).seizeRSR(toSeize))
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
      expect(await stRSR.exchangeRate()).to.equal(fp('1'))
    })

    it('Should not round down at or above MIN_EXCHANGE_RATE - Hyperinflation scenario', async () => {
      const amount: BigNumber = bn('10e18')

      // Stake 10 RSR
      await rsr.connect(addr1).approve(stRSR.address, amount)
      await stRSR.connect(addr1).stake(amount)

      // Stake 10 RSR + Withdraw 10 RSR
      await rsr.connect(addr2).approve(stRSR.address, amount)
      await stRSR.connect(addr2).stake(amount)
      await stRSR.connect(addr2).unstake(amount)

      // Check balances and stakes
      expect(await rsr.balanceOf(stRSR.address)).to.equal(amount.mul(2))
      expect(await rsr.balanceOf(stRSR.address)).to.equal((await stRSR.totalSupply()).mul(2))
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(amount))
      expect(await rsr.balanceOf(addr2.address)).to.equal(initialBal.sub(amount))
      expect(await stRSR.balanceOf(addr1.address)).to.equal(amount)
      expect(await stRSR.balanceOf(addr2.address)).to.equal(0)
      await expectWithdrawal(addr2.address, 0, { rsrAmount: amount })

      const dustAmt = bn('20e9')
      const toSeize = amount.mul(2).sub(dustAmt)

      // Seize all but dustAmt qRSR
      await whileImpersonating(backingManager.address, async (signer) => {
        await expect(stRSR.connect(signer).seizeRSR(toSeize))
          .to.emit(stRSR, 'ExchangeRateSet')
          .withArgs(fp('1'), fp('1e-9'))
      })

      // Check balances and stakes
      expect(await rsr.balanceOf(stRSR.address)).to.equal(dustAmt)
      expect(await stRSR.totalSupply()).to.equal(amount)
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(amount))
      expect(await rsr.balanceOf(addr2.address)).to.equal(initialBal.sub(amount))
      expect(await stRSR.balanceOf(addr1.address)).to.equal(amount)
      expect(await stRSR.balanceOf(addr2.address)).to.equal(0)
      await expectWithdrawal(addr2.address, 0, { rsrAmount: dustAmt.div(2) })
      expect(await stRSR.exchangeRate()).to.equal(fp('1e-9'))
    })

    it('Should remove RSR from Withdrawers', async () => {
      const amount: BigNumber = bn('10e18')
      const amount2: BigNumber = bn('1e18')

      // Stake
      await rsr.connect(addr1).approve(stRSR.address, amount)
      await stRSR.connect(addr1).stake(amount)

      // Check balances and stakes
      expect(await rsr.balanceOf(stRSR.address)).to.equal(amount)
      expect(await rsr.balanceOf(stRSR.address)).to.be.closeTo(await stRSR.totalSupply(), 1)
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(amount))
      expect(await stRSR.balanceOf(addr1.address)).to.equal(amount)

      // Unstake
      await stRSR.connect(addr1).unstake(amount)

      // Check withdrawal properly registered
      await expectWithdrawal(addr1.address, 0, { rsrAmount: amount })

      // Check balances and stakes
      expect(await rsr.balanceOf(stRSR.address)).to.equal(amount)
      expect(await stRSR.totalSupply()).to.equal(0)
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(amount))
      expect(await stRSR.balanceOf(addr1.address)).to.equal(0)
      expect(await stRSR.exchangeRate()).to.equal(fp('1'))

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
      expect(await stRSR.exchangeRate()).to.equal(fp('1'))
    })

    it('Should remove RSR proportionally from Stakers and Withdrawers', async () => {
      const amount: BigNumber = bn('10e18')
      const amount2: BigNumber = bn('1e18')

      // Stake
      await rsr.connect(addr1).approve(stRSR.address, amount)
      await stRSR.connect(addr1).stake(amount)

      await rsr.connect(addr2).approve(stRSR.address, amount)
      await stRSR.connect(addr2).stake(amount)

      const double = amount.mul(2)

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
      await expectWithdrawal(addr1.address, 0, { rsrAmount: amount })

      // Check balances and stakes
      expect(await rsr.balanceOf(stRSR.address)).to.equal(double)
      expect(await stRSR.totalSupply()).to.equal(amount)
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(amount))
      expect(await rsr.balanceOf(addr2.address)).to.equal(initialBal.sub(amount))
      expect(await stRSR.balanceOf(addr1.address)).to.equal(0)
      expect(await stRSR.balanceOf(addr2.address)).to.equal(amount)
      expect(await stRSR.exchangeRate()).to.equal(fp('1'))

      // Seize RSR
      await whileImpersonating(backingManager.address, async (signer) => {
        await expect(stRSR.connect(signer).seizeRSR(amount2))
          .to.emit(rsr, 'Transfer')
          .withArgs(stRSR.address, backingManager.address, amount2)
      })

      // Check balances, stakes, and withdrawals
      expect(await rsr.balanceOf(stRSR.address)).to.equal(double.sub(amount2))
      expect(await stRSR.totalSupply()).to.equal(amount)
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(amount))
      expect(await rsr.balanceOf(addr2.address)).to.equal(initialBal.sub(amount))
      expect(await stRSR.balanceOf(addr1.address)).to.equal(0)
      expect(await stRSR.balanceOf(addr2.address)).to.equal(amount)
      const newExchangeRate = fp(double.sub(amount2)).div(double)
      expect(await stRSR.exchangeRate()).to.be.closeTo(newExchangeRate, 1)
      expect(await stRSR.exchangeRate()).to.be.lte(newExchangeRate)
    })

    it('Should handle small unstake after a significant RSR seizure', async () => {
      stkWithdrawalDelay = bn(await stRSR.unstakingDelay()).toNumber()

      const amount: BigNumber = bn('1e9')
      const one: BigNumber = bn('1')

      // Stake
      await rsr.connect(addr1).approve(stRSR.address, amount)
      await stRSR.connect(addr1).stake(amount)

      // Check balances and stakes
      expect(await rsr.balanceOf(stRSR.address)).to.equal(amount)
      expect(await rsr.balanceOf(stRSR.address)).to.equal(await stRSR.totalSupply())
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(amount))
      expect(await stRSR.balanceOf(addr1.address)).to.equal(amount)

      // Seize most of the RSR
      await whileImpersonating(backingManager.address, async (signer) => {
        await expect(stRSR.connect(signer).seizeRSR(amount.sub(one)))
          .to.emit(stRSR, 'ExchangeRateSet')
          .withArgs(fp('1'), fp('1e-9'))
      })

      // Check balances and stakes
      expect(await rsr.balanceOf(stRSR.address)).to.equal(one)
      expect(await stRSR.totalSupply()).to.equal(amount)
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(amount))
      expect(await stRSR.balanceOf(addr1.address)).to.equal(amount)

      // Check new rate
      expect(await stRSR.exchangeRate()).to.equal(fp('1e-9'))

      // Unstake 1 stRSR with user 1
      const availableAt = (await getLatestBlockTimestamp()) + config.unstakingDelay.toNumber() + 1
      // Set next block timestamp - for deterministic result
      await setNextBlockTimestamp((await getLatestBlockTimestamp()) + 1)

      await expect(stRSR.connect(addr1).unstake(one))
        .emit(stRSR, 'UnstakingStarted')
        .withArgs(0, 2, addr1.address, bn(0), one, availableAt)

      // Check withdrawal properly registered - Check draft era
      //await expectWithdrawal(addr1.address, 0, { rsrAmount: bn(1) })

      // Check balances and stakes
      expect(await rsr.balanceOf(stRSR.address)).to.equal(one)
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(amount))

      // All staked funds withdrawn upfront
      expect(await stRSR.balanceOf(addr1.address)).to.equal(amount.sub(one))
      expect(await stRSR.totalSupply()).to.equal(amount.sub(one))

      // Move forward past stakingWithdrawalDelay
      await setNextBlockTimestamp(Number(await getLatestBlockTimestamp()) + stkWithdrawalDelay)

      // Withdraw
      await stRSR.connect(addr1).withdraw(addr1.address, 1)

      // Check balances and stakes - Nothing was transferred
      expect(await rsr.balanceOf(stRSR.address)).to.equal(one)
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(amount))

      expect(await stRSR.balanceOf(addr1.address)).to.equal(amount.sub(one))
      expect(await stRSR.totalSupply()).to.equal(amount.sub(one))
    })

    it('Should handle cancel unstake after a significant RSR seizure', async () => {
      stkWithdrawalDelay = bn(await stRSR.unstakingDelay()).toNumber()

      const unstakeAmount: BigNumber = fp('1e-9')
      const amount: BigNumber = bn('1e18').add(unstakeAmount).add(1)

      // Stake enough for 2 unstakings
      await rsr.connect(addr1).approve(stRSR.address, amount.add(1))
      await stRSR.connect(addr1).stake(amount.add(1))

      // Check balances and stakes
      expect(await rsr.balanceOf(stRSR.address)).to.equal(amount.add(1))
      expect(await rsr.balanceOf(stRSR.address)).to.equal(await stRSR.totalSupply())
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(amount.add(1)))
      expect(await stRSR.balanceOf(addr1.address)).to.equal(amount.add(1))

      // Unstake twice
      const availableAt = (await getLatestBlockTimestamp()) + config.unstakingDelay.toNumber() + 1
      // Set next block timestamp - for deterministic result
      await setNextBlockTimestamp((await getLatestBlockTimestamp()) + 1)

      await expect(stRSR.connect(addr1).unstake(1))
        .emit(stRSR, 'UnstakingStarted')
        .withArgs(0, 1, addr1.address, 1, 1, availableAt)
      await expect(stRSR.connect(addr1).unstake(unstakeAmount))
        .emit(stRSR, 'UnstakingStarted')
        .withArgs(1, 1, addr1.address, unstakeAmount, unstakeAmount, availableAt + 1)

      // Check balances and stakes
      expect(await rsr.balanceOf(stRSR.address)).to.equal(amount.add(1))
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(amount.add(1)))

      // All staked funds withdrawn upfront
      expect(await stRSR.balanceOf(addr1.address)).to.equal(amount.sub(unstakeAmount))
      expect(await stRSR.totalSupply()).to.equal(amount.sub(unstakeAmount))

      // Rate does not change
      expect(await stRSR.exchangeRate()).to.equal(fp('1'))

      // Seize most of the RSR
      const seizeAmt = fp('0.99999999').mul(amount).div(fp('1')).add(1)
      const exchangeRate = fp('1e-8')
      await whileImpersonating(backingManager.address, async (signer) => {
        await expect(stRSR.connect(signer).seizeRSR(seizeAmt)).to.emit(stRSR, 'ExchangeRateSet')
      })

      // Check new rate
      expect(await stRSR.exchangeRate()).to.be.closeTo(exchangeRate, bn(10))

      // Check balances and stakes
      expect(await rsr.balanceOf(stRSR.address)).to.equal(exchangeRate.add(10))
      expect(await stRSR.totalSupply()).to.equal(amount.sub(unstakeAmount))
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(amount.add(1)))
      expect(await stRSR.balanceOf(addr1.address)).to.equal(amount.sub(unstakeAmount))

      // Move forward past stakingWithdrawalDelay
      await setNextBlockTimestamp(Number(await getLatestBlockTimestamp()) + stkWithdrawalDelay)

      // Cancel the larger unstake -- should round down to 0
      await stRSR.connect(addr1).cancelUnstake(1)

      // Check balances and stakes - No changes
      expect(await rsr.balanceOf(stRSR.address)).to.equal(exchangeRate.add(10))
      expect(await stRSR.totalSupply()).to.equal(amount.sub(unstakeAmount))
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(amount.add(1)))
      expect(await stRSR.balanceOf(addr1.address)).to.equal(amount.sub(unstakeAmount))
    })

    it('Should not allow stakeRate manipulation', async () => {
      // send RSR to stRSR (attempt to manipulate stake rate)
      await rsr.connect(addr1).transfer(stRSR.address, fp('200'))
      const attackerBalBefore = await rsr.balanceOf(addr1.address)
      const stakerBalBefore = await rsr.balanceOf(addr2.address)

      // stake 1 wei
      await rsr.connect(addr1).approve(stRSR.address, bn(1))
      await stRSR.connect(addr1).stake(bn(1))

      // wait, then payout rewards
      await setNextBlockTimestamp((await getLatestBlockTimestamp()) + 12)
      const preExRate = await stRSR.exchangeRate()
      await stRSR.payoutRewards()
      const postExRate = await stRSR.exchangeRate()
      expect(postExRate).eq(preExRate)

      // addr2 stakes
      const stakeAmt = fp('10')
      await rsr.connect(addr2).approve(stRSR.address, stakeAmt)
      await stRSR.connect(addr2).stake(stakeAmt)
      const addr2Bal = await stRSR.balanceOf(addr2.address)
      expect(addr2Bal).to.eq(stakeAmt)

      // attacker unstakes
      const unstakingDelay = await stRSR.unstakingDelay()
      await stRSR.connect(addr1).unstake(bn(1))
      await setNextBlockTimestamp((await getLatestBlockTimestamp()) + unstakingDelay)
      await stRSR.connect(addr1).withdraw(addr1.address, 1)
      const attackerBalAfter = await rsr.balanceOf(addr1.address)
      expect(attackerBalAfter).closeTo(attackerBalBefore, bn(10))

      // staker unstakes
      await stRSR.connect(addr2).unstake(addr2Bal)
      await setNextBlockTimestamp((await getLatestBlockTimestamp()) + unstakingDelay)
      await stRSR.connect(addr2).withdraw(addr2.address, 1)
      const stakerBalAFter = await rsr.balanceOf(addr2.address)
      expect(stakerBalAFter).to.be.gt(stakerBalBefore)
    })
  })

  describe('Reset Stakes - Governance', () => {
    it('Should not allow to reset stakes if not governance', async () => {
      await expect(stRSR.connect(other).resetStakes()).to.be.revertedWith('governance only')
    })

    it('Should reset stakes and perform validations on rate - MAX', async () => {
      const stakeAmt: BigNumber = bn('100e18')
      const seizeAmt: BigNumber = bn('1e18')

      // Stake
      await rsr.connect(addr1).approve(stRSR.address, stakeAmt)
      await stRSR.connect(addr1).stake(stakeAmt)

      expect(await stRSR.exchangeRate()).to.equal(fp('1'))
      expect(await stRSR.totalSupply()).to.equal(stakeAmt)
      expect(await stRSR.balanceOf(addr1.address)).to.equal(stakeAmt)

      // Cannot reset stakes with this rate
      await expect(stRSR.connect(owner).resetStakes()).to.be.revertedWith('rate still safe')

      // Seize small portion of RSR to increase stake rate - still safe
      await whileImpersonating(backingManager.address, async (signer) => {
        await expect(stRSR.connect(signer).seizeRSR(seizeAmt)).to.emit(stRSR, 'ExchangeRateSet')
      })

      // new rate: new strsr supply / RSR backing that strsr supply
      let expectedRate = fp(stakeAmt.sub(seizeAmt)).div(stakeAmt)
      expect(await stRSR.exchangeRate()).to.be.closeTo(expectedRate, 1)
      expect(await stRSR.totalSupply()).to.equal(stakeAmt)
      expect(await stRSR.balanceOf(addr1.address)).to.equal(stakeAmt)

      // Attempt to reset stakes, still not possible
      await expect(stRSR.connect(owner).resetStakes()).to.be.revertedWith('rate still safe')

      // New Seizure - rate will be unsafe
      const rsrRemaining = stakeAmt.sub(seizeAmt)
      const seizeAmt2 = rsrRemaining.sub(1e13)
      await whileImpersonating(backingManager.address, async (signer) => {
        await expect(stRSR.connect(signer).seizeRSR(seizeAmt2)).to.emit(stRSR, 'ExchangeRateSet')
      })

      // check new rate
      expectedRate = fp(stakeAmt.sub(seizeAmt).sub(seizeAmt2)).div(stakeAmt)
      expect(await stRSR.exchangeRate()).to.be.closeTo(expectedRate, 1)
      expect(await stRSR.exchangeRate()).to.be.lte(fp('1e-6'))
      expect(await stRSR.exchangeRate()).to.be.gte(fp('1e-9'))

      // Now governance can reset stakes
      await expect(stRSR.connect(owner).resetStakes()).to.emit(stRSR, 'AllBalancesReset')

      // All stakes reset
      expect(await stRSR.exchangeRate()).to.equal(fp('1'))
      expect(await stRSR.totalSupply()).to.equal(bn(0))
      expect(await stRSR.balanceOf(addr1.address)).to.equal(bn(0))
    })

    it('Should reset stakes and perform validations on rate - MIN', async () => {
      const stakeAmt: BigNumber = bn('1000e18')
      const addAmt1: BigNumber = bn('100e18')
      const addAmt2: BigNumber = bn('120e30')

      // Stake
      await rsr.connect(addr1).approve(stRSR.address, stakeAmt)
      await stRSR.connect(addr1).stake(stakeAmt)

      expect(await stRSR.exchangeRate()).to.equal(fp('1'))
      expect(await stRSR.totalSupply()).to.equal(stakeAmt)
      expect(await stRSR.balanceOf(addr1.address)).to.equal(stakeAmt)

      // Cannot reset stakes with this rate
      await expect(stRSR.connect(owner).resetStakes()).to.be.revertedWith('rate still safe')

      // Add RSR to decrease stake rate - still safe
      await rsr.connect(owner).transfer(stRSR.address, addAmt1)

      // Advance to the end of noop period
      await advanceToTimestamp((await getLatestBlockTimestamp()) + 1)
      await stRSR.payoutRewards()

      // Calculate payout amount
      const decayFn = makeDecayFn(await stRSR.rewardRatio())
      const addedRSRStake = addAmt1.sub(decayFn(addAmt1, 1)) // 1 round
      const newRate: BigNumber = fp(stakeAmt.add(addedRSRStake)).div(stakeAmt)

      // Payout rewards - Advance to get 1 round of rewards
      await setNextBlockTimestamp((await getLatestBlockTimestamp()) + 1)
      await expect(stRSR.payoutRewards()).to.emit(stRSR, 'ExchangeRateSet')
      expect(await stRSR.exchangeRate()).to.be.closeTo(newRate, 1)
      expect(await stRSR.totalSupply()).to.equal(stakeAmt)
      expect(await stRSR.balanceOf(addr1.address)).to.equal(stakeAmt)

      // Attempt to reset stakes, still not possible
      await expect(stRSR.connect(owner).resetStakes()).to.be.revertedWith('rate still safe')

      // Add a large amount of funds - rate will be unsafe
      await rsr.connect(owner).mint(owner.address, addAmt2)
      await rsr.connect(owner).transfer(stRSR.address, addAmt2)

      // Advance to the end of noop period
      await setNextBlockTimestamp((await getLatestBlockTimestamp()) + 1)
      await stRSR.payoutRewards()

      // Payout rewards - Advance time - rate will be unsafe
      await setNextBlockTimestamp((await getLatestBlockTimestamp()) + 100)
      await expect(stRSR.payoutRewards()).to.emit(stRSR, 'ExchangeRateSet')
      expect(await stRSR.exchangeRate()).to.be.gte(fp('1e6'))
      expect(await stRSR.exchangeRate()).to.be.lte(fp('1e9'))
      expect(await stRSR.totalSupply()).to.equal(stakeAmt)
      expect(await stRSR.balanceOf(addr1.address)).to.equal(stakeAmt)

      // Now governance can reset stakes
      await expect(stRSR.connect(owner).resetStakes()).to.emit(stRSR, 'AllBalancesReset')

      // All stakes reset
      expect(await stRSR.exchangeRate()).to.equal(fp('1'))
      expect(await stRSR.totalSupply()).to.equal(bn(0))
      expect(await stRSR.balanceOf(addr1.address)).to.equal(bn(0))
    })
  })

  describe('Transfers #fast', () => {
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
        'insufficient balance'
      )

      // Nothing transferred
      expect(await stRSR.balanceOf(addr1.address)).to.equal(addr1BalancePrev)
      expect(await stRSR.balanceOf(addr2.address)).to.equal(addr2BalancePrev)
      expect(await stRSR.totalSupply()).to.equal(totalSupplyPrev)
      expect(await rsr.balanceOf(stRSR.address)).to.equal(amount)
    })

    it('Should not transfer stakes from/to zero address', async function () {
      const addr1BalancePrev = await stRSR.balanceOf(addr1.address)
      const addr2BalancePrev = await stRSR.balanceOf(addr2.address)
      const totalSupplyPrev = await stRSR.totalSupply()

      // Attempt to send to zero address
      await expect(stRSR.connect(addr1).transfer(ZERO_ADDRESS, amount)).to.be.revertedWith(
        'zero address'
      )

      // Attempt to send from zero address - Impersonation is the only way to get to this validation
      await whileImpersonating(ZERO_ADDRESS, async (signer) => {
        await expect(stRSR.connect(signer).transfer(addr2.address, amount)).to.be.revertedWith(
          'zero address'
        )
      })

      // Nothing transferred
      expect(await stRSR.balanceOf(addr1.address)).to.equal(addr1BalancePrev)
      expect(await stRSR.balanceOf(addr2.address)).to.equal(addr2BalancePrev)
      expect(await stRSR.totalSupply()).to.equal(totalSupplyPrev)
      expect(await rsr.balanceOf(stRSR.address)).to.equal(amount)
    })

    it('Should not allow transfer/transferFrom to address(this)', async () => {
      // transfer
      await expect(stRSR.connect(addr1).transfer(stRSR.address, 1)).to.be.revertedWith(
        'transfer to self'
      )

      // transferFrom
      await stRSR.connect(addr1).approve(addr2.address, 1)
      await expect(
        stRSR.connect(addr2).transferFrom(addr1.address, stRSR.address, 1)
      ).to.be.revertedWith('transfer to self')
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
        {
          name: await stRSR.name(),
          version: VERSION,
          chainId: await getChainId(hre),
          verifyingContract: stRSR.address,
        },
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
        {
          name: await stRSR.name(),
          version: VERSION,
          chainId: await getChainId(hre),
          verifyingContract: stRSR.address,
        },
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

    describe('ERC1271 #fast', () => {
      let erc1271Mock: ERC1271Mock

      beforeEach(async () => {
        const ERC1271Factory = await ethers.getContractFactory('ERC1271Mock')
        erc1271Mock = await ERC1271Factory.deploy()

        // Give StRSR balance to ERC1271Mock
        await stRSR.connect(addr1).transfer(erc1271Mock.address, amount)
      })

      it('should not permit without ERC1271 support', async () => {
        // Try a smart contract that does not support ERC1271
        await expect(
          stRSR.permit(
            main.address,
            addr1.address,
            amount,
            bn(2).pow(255),
            0,
            ethers.utils.formatBytes32String(''),
            ethers.utils.formatBytes32String('')
          )
        ).to.be.reverted
        expect(await stRSR.allowance(main.address, addr1.address)).to.equal(0)

        // Try the ERC1271Mock with approvals turned off
        await expect(
          stRSR.permit(
            erc1271Mock.address,
            addr1.address,
            amount,
            bn(2).pow(255),
            0,
            ethers.utils.formatBytes32String(''),
            ethers.utils.formatBytes32String('')
          )
        ).to.be.revertedWith('ERC1271: Unauthorized')
        expect(await stRSR.allowance(erc1271Mock.address, addr1.address)).to.equal(0)
      })

      it('should permit spend with ERC1271 support', async () => {
        // ERC1271 with approvals turned on
        await erc1271Mock.enableApprovals()
        await stRSR.permit(
          erc1271Mock.address,
          addr1.address,
          amount,
          bn(2).pow(255),
          0,
          ethers.utils.formatBytes32String(''),
          ethers.utils.formatBytes32String('')
        )
        expect(await stRSR.allowance(erc1271Mock.address, addr1.address)).to.equal(amount)
        await stRSR.connect(addr1).transferFrom(erc1271Mock.address, addr1.address, amount)
        expect(await stRSR.balanceOf(erc1271Mock.address)).to.equal(0)
        expect(await stRSR.balanceOf(addr1.address)).to.equal(amount)
      })
    })

    it('Should not transferFrom stakes if no allowance', async function () {
      const addr1BalancePrev = await stRSR.balanceOf(addr1.address)
      const addr2BalancePrev = await stRSR.balanceOf(addr2.address)
      const totalSupplyPrev = await stRSR.totalSupply()

      // Transfer
      expect(await stRSR.allowance(addr1.address, addr2.address)).to.equal(0)
      await expect(
        stRSR.connect(addr2).transferFrom(addr1.address, other.address, amount)
      ).to.be.revertedWith('insufficient allowance')

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
        'zero address'
      )

      // Attempt set allowance from zero address - Impersonation is the only way to get to this validation
      await whileImpersonating(ZERO_ADDRESS, async (signer) => {
        await expect(stRSR.connect(signer).approve(addr2.address, amount)).to.be.revertedWith(
          'zero address'
        )
      })

      // Nothing set
      expect(await stRSR.allowance(addr1.address, ZERO_ADDRESS)).to.equal(0)
      expect(await stRSR.allowance(ZERO_ADDRESS, addr2.address)).to.equal(0)
    })

    it('Should allow to increase/decrease allowances', async function () {
      expect(await stRSR.allowance(addr1.address, addr2.address)).to.equal(0)

      //  Increase allowance
      await expect(stRSR.connect(addr1).increaseAllowance(addr2.address, amount))
        .to.emit(stRSR, 'Approval')
        .withArgs(addr1.address, addr2.address, amount)

      expect(await stRSR.allowance(addr1.address, addr2.address)).to.equal(amount)

      // Increase again
      await expect(stRSR.connect(addr1).increaseAllowance(addr2.address, amount))
        .to.emit(stRSR, 'Approval')
        .withArgs(addr1.address, addr2.address, amount.mul(2))

      expect(await stRSR.allowance(addr1.address, addr2.address)).to.equal(amount.mul(2))

      // Decrease allowance
      await expect(stRSR.connect(addr1).decreaseAllowance(addr2.address, amount))
        .to.emit(stRSR, 'Approval')
        .withArgs(addr1.address, addr2.address, amount)

      expect(await stRSR.allowance(addr1.address, addr2.address)).to.equal(amount)

      // Should not allow to decrease below zero
      await expect(
        stRSR.connect(addr1).decreaseAllowance(addr2.address, amount.add(1))
      ).to.be.revertedWith('decrease allowance')

      // No changes
      expect(await stRSR.allowance(addr1.address, addr2.address)).to.equal(amount)
    })

    it('Should not decrease allowance when Max allowance pattern is used', async function () {
      expect(await stRSR.allowance(addr1.address, addr2.address)).to.equal(0)

      // Increase to maximum allowance
      await expect(stRSR.connect(addr1).increaseAllowance(addr2.address, MAX_UINT256))
        .to.emit(stRSR, 'Approval')
        .withArgs(addr1.address, addr2.address, MAX_UINT256)

      expect(await stRSR.allowance(addr1.address, addr2.address)).to.equal(MAX_UINT256)

      // Perform a transfer, should not decrease allowance (Max allowance pattern assumed)
      await stRSR.connect(addr2).transferFrom(addr1.address, other.address, amount)

      // Remains the same
      expect(await stRSR.allowance(addr1.address, addr2.address)).to.equal(MAX_UINT256)
    })
  })

  describeP1('ERC20Votes', () => {
    let stRSRVotes: StRSRP1Votes

    beforeEach(async function () {
      // Cast to ERC20Votes contract
      stRSRVotes = <StRSRP1Votes>await ethers.getContractAt('StRSRP1Votes', stRSR.address)
    })

    it('Should setup initial state correctly', async function () {
      const currentBlockNumber = (await getLatestBlockNumber()) - 1
      expect(await stRSRVotes.getPastTotalSupply(currentBlockNumber)).to.equal(0)

      expect(await stRSRVotes.getVotes(addr1.address)).to.equal(0)
      expect(await stRSRVotes.getVotes(addr2.address)).to.equal(0)
      expect(await stRSRVotes.getVotes(addr3.address)).to.equal(0)

      expect(await stRSRVotes.getPastVotes(addr1.address, currentBlockNumber)).to.equal(0)
      expect(await stRSRVotes.getPastVotes(addr2.address, currentBlockNumber)).to.equal(0)
      expect(await stRSRVotes.getPastVotes(addr3.address, currentBlockNumber)).to.equal(0)

      expect(await stRSRVotes.delegates(addr1.address)).to.equal(ZERO_ADDRESS)
      expect(await stRSRVotes.delegates(addr2.address)).to.equal(ZERO_ADDRESS)
      expect(await stRSRVotes.delegates(addr3.address)).to.equal(ZERO_ADDRESS)

      expect(await stRSRVotes.numCheckpoints(addr1.address)).to.equal(0)
      expect(await stRSRVotes.numCheckpoints(addr2.address)).to.equal(0)
      expect(await stRSRVotes.numCheckpoints(addr3.address)).to.equal(0)
    })

    it('Should register delegates correctly', async function () {
      // Change delegate for addr1
      await stRSRVotes.connect(addr1).delegate(addr1.address)
      expect(await stRSRVotes.delegates(addr1.address)).to.equal(addr1.address)

      // Change delegate for addr1, again
      await stRSRVotes.connect(addr1).delegate(addr2.address)
      expect(await stRSRVotes.delegates(addr1.address)).to.equal(addr2.address)

      // Change delegate for addr2
      await stRSRVotes.connect(addr2).delegate(addr3.address)
      expect(await stRSRVotes.delegates(addr2.address)).to.equal(addr3.address)

      // Change delegate for addr3
      await stRSRVotes.connect(addr3).delegate(addr3.address)
      expect(await stRSRVotes.delegates(addr3.address)).to.equal(addr3.address)
    })

    it('Should allow to delegate by signature', async function () {
      // Check no delegate
      expect(await stRSRVotes.delegates(addr1.address)).to.equal(ZERO_ADDRESS)

      const Delegation = [
        { name: 'delegatee', type: 'address' },
        { name: 'nonce', type: 'uint256' },
        { name: 'expiry', type: 'uint256' },
      ]

      const nonce = await stRSRVotes.nonces(addr1.address)
      const expiry = MAX_UINT256
      const chainId = await getChainId(hre)
      const name = await stRSRVotes.name()
      const verifyingContract = stRSRVotes.address

      // Get data
      const buildData = {
        types: { Delegation },
        domain: { name, version: VERSION, chainId, verifyingContract },
        message: {
          delegatee: addr1.address,
          nonce,
          expiry,
        },
      }

      // Get data
      const sig = await addr1._signTypedData(buildData.domain, buildData.types, buildData.message)
      const { v, r, s } = ethers.utils.splitSignature(sig)

      // Change delegate for addr1 using signature
      await stRSRVotes.connect(other).delegateBySig(addr1.address, nonce, expiry, v, r, s)

      // Check result
      expect(await stRSRVotes.delegates(addr1.address)).to.equal(addr1.address)
    })

    it('Should perform validations when delegating by signature', async function () {
      // Check no delegate
      expect(await stRSRVotes.delegates(addr1.address)).to.equal(ZERO_ADDRESS)

      const Delegation = [
        { name: 'delegatee', type: 'address' },
        { name: 'nonce', type: 'uint256' },
        { name: 'expiry', type: 'uint256' },
      ]

      // Set invalid nonce
      const invalidNonce = 5

      // Set other values
      const nonce = await stRSRVotes.nonces(addr1.address)
      const expiry = MAX_UINT256
      const chainId = await getChainId(hre)
      const name = await stRSRVotes.name()
      const verifyingContract = stRSRVotes.address

      // Get data
      const buildData = {
        types: { Delegation },
        domain: { name, version: VERSION, chainId, verifyingContract },
        message: {
          delegatee: addr1.address,
          nonce: invalidNonce,
          expiry,
        },
      }

      // Get data
      const sig = await addr1._signTypedData(buildData.domain, buildData.types, buildData.message)
      const { v, r, s } = ethers.utils.splitSignature(sig)

      // Attempt to delegate with invalid nonce
      await expect(
        stRSRVotes.connect(other).delegateBySig(addr1.address, invalidNonce, expiry, v, r, s)
      ).to.be.revertedWith('invalid nonce')

      // Attempt to delegate with invalid signature
      await expect(
        stRSRVotes
          .connect(other)
          .delegateBySig(
            addr1.address,
            nonce,
            expiry,
            28,
            '0x91d1478d8d0aaaafc8cf58fc0c9c1e95a07a78baa730de72981407d3344ddb5d',
            '0x1d33a68b1b1aaaa5ed119bb71ad14e21c5168120c18700eb1411d6640d1b3d76'
          )
      ).to.be.revertedWith('ECDSA: invalid signature')

      // Set invalid expiration
      const invalidExpiry = bn(await getLatestBlockNumber())
      buildData.message.nonce = Number(nonce)
      buildData.message.expiry = invalidExpiry

      // Attempt to delegate with invalid expiry
      await expect(
        stRSRVotes.connect(other).delegateBySig(addr1.address, nonce, invalidExpiry, v, r, s)
      ).to.be.revertedWith('signature expired')

      // Check result - No delegates
      expect(await stRSRVotes.delegates(addr1.address)).to.equal(ZERO_ADDRESS)
    })

    it('Should use independent nonces for permit and delegation', async function () {
      // Check no delegate
      expect(await stRSRVotes.delegates(addr1.address)).to.equal(ZERO_ADDRESS)

      const amount = bn('10e18')

      const permit = await signERC2612Permit(
        addr1,
        {
          name: await stRSR.name(),
          version: VERSION,
          chainId: await getChainId(hre),
          verifyingContract: stRSR.address,
        },
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

      const Delegation = [
        { name: 'delegatee', type: 'address' },
        { name: 'nonce', type: 'uint256' },
        { name: 'expiry', type: 'uint256' },
      ]

      const chainId = await getChainId(hre)
      const expiry = MAX_UINT256
      const name = await stRSRVotes.name()
      const verifyingContract = stRSRVotes.address

      const nonce1 = await stRSRVotes.nonces(addr1.address)

      const sig1 = ethers.utils.splitSignature(
        await addr1._signTypedData(
          { name, version: VERSION, chainId, verifyingContract },
          { Delegation },
          {
            delegatee: addr1.address,
            nonce: nonce1,
            expiry,
          }
        )
      )

      // Change delegate for addr1 using signature with bad nonce
      await expect(
        stRSRVotes
          .connect(other)
          .delegateBySig(addr1.address, nonce1, expiry, sig1.v, sig1.r, sig1.s)
      ).to.be.revertedWith('invalid nonce')

      const nonce2 = await stRSRVotes.delegationNonces(addr1.address)

      const sig2 = ethers.utils.splitSignature(
        await addr1._signTypedData(
          { name, version: VERSION, chainId, verifyingContract },
          { Delegation },
          {
            delegatee: addr1.address,
            nonce: nonce2,
            expiry,
          }
        )
      )

      // Change delegate for addr1 using signature with good nonce
      await expect(
        stRSRVotes
          .connect(other)
          .delegateBySig(addr1.address, nonce2, expiry, sig2.v, sig2.r, sig2.s)
      ).to.not.be.reverted

      // Check result
      expect(await stRSRVotes.delegates(addr1.address)).to.equal(addr1.address)
    })

    it('Should count votes properly when staking', async function () {
      // Perform some stakes
      const amount1: BigNumber = bn('50e18')
      await rsr.connect(addr1).approve(stRSRVotes.address, amount1)
      await stRSRVotes.connect(addr1).stake(amount1)

      // Check checkpoint
      expect(await stRSRVotes.numCheckpoints(addr1.address)).to.equal(0)

      // Advance time
      await advanceTime(1)

      // Check new values - Still zero for addr1, requires delegation
      let currentBlockTimestamp = (await getLatestBlockTimestamp()) - 1
      expect(await stRSRVotes.getPastTotalSupply(currentBlockTimestamp)).to.equal(amount1)
      expect(await stRSRVotes.getPastVotes(addr1.address, currentBlockTimestamp)).to.equal(0)
      expect(await stRSRVotes.getVotes(addr1.address)).to.equal(0)
      expect(await stRSRVotes.getPastEra(currentBlockTimestamp)).to.equal(1)

      // Cannot check votes on future block
      await expect(stRSRVotes.getPastTotalSupply(currentBlockTimestamp + 1)).to.be.revertedWith(
        'future lookup'
      )
      await expect(
        stRSRVotes.getPastVotes(addr1.address, currentBlockTimestamp + 1)
      ).to.be.revertedWith('future lookup')
      await expect(stRSRVotes.getPastEra(currentBlockTimestamp + 1)).to.be.revertedWith(
        'future lookup'
      )

      // Delegate votes
      await stRSRVotes.connect(addr1).delegate(addr1.address)

      // Check checkpoint stored
      expect(await stRSRVotes.numCheckpoints(addr1.address)).to.equal(1)
      expect(await stRSRVotes.checkpoints(addr1.address, 0)).to.eql([
        await getLatestBlockTimestamp(),
        amount1,
      ])

      // Advance time
      await advanceTime(1)

      // Check new values - Now properly counted
      currentBlockTimestamp = (await getLatestBlockTimestamp()) - 1
      expect(await stRSRVotes.getPastTotalSupply(currentBlockTimestamp)).to.equal(amount1)
      expect(await stRSRVotes.getPastVotes(addr1.address, currentBlockTimestamp)).to.equal(amount1)
      expect(await stRSRVotes.getPastVotes(addr2.address, currentBlockTimestamp)).to.equal(0)
      expect(await stRSRVotes.getPastVotes(addr3.address, currentBlockTimestamp)).to.equal(0)
      expect(await stRSRVotes.getPastEra(currentBlockTimestamp)).to.equal(1)

      // Check current votes
      expect(await stRSRVotes.getVotes(addr1.address)).to.equal(amount1)

      // Perform some stakes with another user
      const amount2: BigNumber = bn('40e18')
      await rsr.connect(addr2).approve(stRSRVotes.address, amount2)
      await stRSRVotes.connect(addr2).stake(amount2)

      // Delegate votes
      await stRSRVotes.connect(addr2).delegate(addr2.address)

      // Check checkpoint stored
      expect(await stRSRVotes.numCheckpoints(addr2.address)).to.equal(1)
      expect(await stRSRVotes.checkpoints(addr2.address, 0)).to.eql([
        await getLatestBlockTimestamp(),
        amount2,
      ])

      // Advance time
      await advanceTime(1)

      // Check new values - Couting votes for addr2
      currentBlockTimestamp = (await getLatestBlockTimestamp()) - 1
      expect(await stRSRVotes.getPastTotalSupply(currentBlockTimestamp)).to.equal(
        amount1.add(amount2)
      )
      expect(await stRSRVotes.getPastVotes(addr1.address, currentBlockTimestamp)).to.equal(amount1)
      expect(await stRSRVotes.getPastVotes(addr2.address, currentBlockTimestamp)).to.equal(amount2)
      expect(await stRSRVotes.getPastVotes(addr3.address, currentBlockTimestamp)).to.equal(0)
      expect(await stRSRVotes.getPastEra(currentBlockTimestamp)).to.equal(1)

      // Check current votes
      expect(await stRSRVotes.getVotes(addr1.address)).to.equal(amount1)
      expect(await stRSRVotes.getVotes(addr2.address)).to.equal(amount2)

      // Perform some stakes with other users
      const amount3: BigNumber = bn('10e18')
      await rsr.connect(addr3).approve(stRSRVotes.address, amount3)
      await stRSRVotes.connect(addr3).stake(amount3)

      // Delegate votes to addr2
      await stRSRVotes.connect(addr3).delegate(addr2.address)

      // Check checkpoints stored
      expect(await stRSRVotes.numCheckpoints(addr2.address)).to.equal(2)
      expect(await stRSRVotes.checkpoints(addr2.address, 1)).to.eql([
        await getLatestBlockTimestamp(),
        amount2.add(amount3),
      ])
      expect(await stRSRVotes.numCheckpoints(addr3.address)).to.equal(0)

      // Advance block
      await advanceBlocks(1)

      // Check new values - Delegated votes from addr3 count for addr2
      currentBlockTimestamp = (await getLatestBlockTimestamp()) - 1
      expect(await stRSRVotes.getPastTotalSupply(currentBlockTimestamp)).to.equal(
        amount1.add(amount2).add(amount3)
      )
      expect(await stRSRVotes.getPastVotes(addr1.address, currentBlockTimestamp)).to.equal(amount1)
      expect(await stRSRVotes.getPastVotes(addr2.address, currentBlockTimestamp)).to.equal(
        amount2.add(amount3)
      )
      expect(await stRSRVotes.getPastVotes(addr3.address, currentBlockTimestamp)).to.equal(0)
      expect(await stRSRVotes.getPastEra(currentBlockTimestamp)).to.equal(1)

      // Check current votes
      expect(await stRSRVotes.getVotes(addr1.address)).to.equal(amount1)
      expect(await stRSRVotes.getVotes(addr2.address)).to.equal(amount2.add(amount3))
      expect(await stRSRVotes.getVotes(addr3.address)).to.equal(0)
    })

    it('Should allow to stake and delegate in single transaction', async function () {
      // Should perform basic validations on stake
      await expect(
        stRSRVotes.connect(addr1).stakeAndDelegate(bn(0), ZERO_ADDRESS)
      ).to.be.revertedWith('zero amount')

      expect(await stRSRVotes.delegates(addr1.address)).to.equal(ZERO_ADDRESS)

      // Perform some stakes - delegate to self
      const amount1: BigNumber = bn('50e18')
      await rsr.connect(addr1).approve(stRSRVotes.address, amount1)
      await expect(stRSRVotes.connect(addr1).stakeAndDelegate(amount1, ZERO_ADDRESS)).to.emit(
        stRSRVotes,
        'Staked'
      )

      // Check deposit registered
      expect(await rsr.balanceOf(stRSRVotes.address)).to.equal(amount1)
      expect(await rsr.balanceOf(addr1.address)).to.equal(initialBal.sub(amount1))
      expect(await stRSR.balanceOf(addr1.address)).to.equal(amount1)

      // Check checkpoint stored - no need to delegate again
      expect(await stRSRVotes.delegates(addr1.address)).to.equal(addr1.address)
      expect(await stRSRVotes.numCheckpoints(addr1.address)).to.equal(1)
      expect(await stRSRVotes.checkpoints(addr1.address, 0)).to.eql([
        await getLatestBlockTimestamp(),
        amount1,
      ])

      // Advance block
      await advanceBlocks(1)

      // Check new values - Now properly counted
      let currentBlockTimestamp = (await getLatestBlockTimestamp()) - 1
      expect(await stRSRVotes.getPastTotalSupply(currentBlockTimestamp)).to.equal(amount1)
      expect(await stRSRVotes.getPastVotes(addr1.address, currentBlockTimestamp)).to.equal(amount1)
      expect(await stRSRVotes.getPastVotes(addr2.address, currentBlockTimestamp)).to.equal(0)
      expect(await stRSRVotes.getPastVotes(addr3.address, currentBlockTimestamp)).to.equal(0)
      expect(await stRSRVotes.getPastEra(currentBlockTimestamp)).to.equal(1)

      // Check current votes
      expect(await stRSRVotes.getVotes(addr1.address)).to.equal(amount1)

      // Perform some stakes with another user, delegate to a third address
      expect(await stRSRVotes.delegates(addr2.address)).to.equal(ZERO_ADDRESS)

      const amount2: BigNumber = bn('40e18')
      await rsr.connect(addr2).approve(stRSRVotes.address, amount2)
      await stRSRVotes.connect(addr2).stakeAndDelegate(amount2, addr3.address)

      // Check deposit registered
      expect(await rsr.balanceOf(stRSRVotes.address)).to.equal(amount1.add(amount2))
      expect(await rsr.balanceOf(addr2.address)).to.equal(initialBal.sub(amount2))
      expect(await stRSR.balanceOf(addr2.address)).to.equal(amount2)

      // Check checkpoint stored for delegatee correctly
      expect(await stRSRVotes.delegates(addr2.address)).to.equal(addr3.address)
      expect(await stRSRVotes.numCheckpoints(addr3.address)).to.equal(1)
      expect(await stRSRVotes.checkpoints(addr3.address, 0)).to.eql([
        await getLatestBlockTimestamp(),
        amount2,
      ])

      // Advance time
      await advanceTime(1)

      // Check new values - Counting votes for addr3
      currentBlockTimestamp = (await getLatestBlockTimestamp()) - 1
      expect(await stRSRVotes.getPastTotalSupply(currentBlockTimestamp)).to.equal(
        amount1.add(amount2)
      )
      expect(await stRSRVotes.getPastVotes(addr1.address, currentBlockTimestamp)).to.equal(amount1)
      expect(await stRSRVotes.getPastVotes(addr2.address, currentBlockTimestamp)).to.equal(0)
      expect(await stRSRVotes.getPastVotes(addr3.address, currentBlockTimestamp)).to.equal(amount2)
      expect(await stRSRVotes.getPastEra(currentBlockTimestamp)).to.equal(1)

      // Check current votes
      expect(await stRSRVotes.getVotes(addr1.address)).to.equal(amount1)
      expect(await stRSRVotes.getVotes(addr2.address)).to.equal(0)
      expect(await stRSRVotes.getVotes(addr3.address)).to.equal(amount2)

      // By passing the zero address it keeps current delegate (if one defined already)
      const amount3: BigNumber = bn('10e18')
      await rsr.connect(addr2).approve(stRSRVotes.address, amount3)
      await stRSRVotes.connect(addr2).stakeAndDelegate(amount3, ZERO_ADDRESS)

      // Delegate remains the same
      expect(await stRSRVotes.delegates(addr2.address)).to.equal(addr3.address)

      // Check deposit registered
      expect(await rsr.balanceOf(stRSRVotes.address)).to.equal(amount1.add(amount2).add(amount3))
      expect(await rsr.balanceOf(addr2.address)).to.equal(initialBal.sub(amount2).sub(amount3))
      expect(await stRSR.balanceOf(addr2.address)).to.equal(amount2.add(amount3))

      // Check checkpoint stored for delegatee correctly
      expect(await stRSRVotes.numCheckpoints(addr3.address)).to.equal(2)
      expect(await stRSRVotes.checkpoints(addr3.address, 1)).to.eql([
        await getLatestBlockTimestamp(),
        amount2.add(amount3),
      ])

      // Advance tim
      await advanceTime(1)

      // Check current votes
      expect(await stRSRVotes.getVotes(addr1.address)).to.equal(amount1)
      expect(await stRSRVotes.getVotes(addr2.address)).to.equal(0)
      expect(await stRSRVotes.getVotes(addr3.address)).to.equal(amount2.add(amount3))
    })

    it('Should register single checkpoint per block per account', async function () {
      // Set automine to false for multiple transactions in one block
      await hre.network.provider.send('evm_setAutomine', [false])

      // Perform two stakes and delegate
      const amount: BigNumber = bn('50e18')
      await rsr.connect(addr1).approve(stRSRVotes.address, amount.mul(2))
      await stRSRVotes.connect(addr1).stake(amount)
      await stRSRVotes.connect(addr1).stake(amount)

      await stRSRVotes.connect(addr1).delegate(addr1.address)

      // Mine block
      await advanceTime(1)

      // Set automine to true again
      await hre.network.provider.send('evm_setAutomine', [true])

      // Check checkpoints stored - Only one checkpoint
      expect(await stRSRVotes.numCheckpoints(addr1.address)).to.equal(1)
      expect(await stRSRVotes.checkpoints(addr1.address, 0)).to.eql([
        await getLatestBlockTimestamp(),
        amount.mul(2),
      ])

      // Current votes properly counted
      expect(await stRSRVotes.getVotes(addr1.address)).to.equal(amount.mul(2))

      // Mine an additional block
      await advanceTime(1)

      const currentBlockTimestamp = (await getLatestBlockTimestamp()) - 1
      expect(await stRSRVotes.getPastTotalSupply(currentBlockTimestamp)).to.equal(amount.mul(2))
      expect(await stRSRVotes.getPastVotes(addr1.address, currentBlockTimestamp)).to.equal(
        amount.mul(2)
      )
    })

    context('With stakes', function () {
      let currentBlockTimestamp: number
      let amount: BigNumber

      beforeEach(async function () {
        // Perform stakes
        amount = bn('50e18')
        await rsr.connect(addr1).approve(stRSRVotes.address, amount)
        await stRSRVotes.connect(addr1).stake(amount)
        await rsr.connect(addr2).approve(stRSRVotes.address, amount)
        await stRSRVotes.connect(addr2).stake(amount)

        // Delegate votes
        await stRSRVotes.connect(addr1).delegate(addr1.address)
        await stRSRVotes.connect(addr2).delegate(addr2.address)
        await stRSRVotes.connect(addr3).delegate(addr3.address)

        // Advance block
        await advanceTime(1)
      })

      it('Should count votes properly when changing exchange rate', async function () {
        // Check values before changing rate
        currentBlockTimestamp = (await getLatestBlockTimestamp()) - 1
        expect(await stRSRVotes.getPastTotalSupply(currentBlockTimestamp)).to.equal(amount.mul(2))
        expect(await stRSRVotes.getPastVotes(addr1.address, currentBlockTimestamp)).to.equal(amount)
        expect(await stRSRVotes.getPastVotes(addr2.address, currentBlockTimestamp)).to.equal(amount)
        expect(await stRSRVotes.getPastVotes(addr3.address, currentBlockTimestamp)).to.equal(0)
        expect(await stRSRVotes.getVotes(addr1.address)).to.equal(amount)
        expect(await stRSRVotes.getVotes(addr2.address)).to.equal(amount)
        expect(await stRSRVotes.getVotes(addr3.address)).to.equal(0)

        // Check balances and stakes
        expect(await stRSRVotes.balanceOf(addr1.address)).to.equal(amount)
        expect(await stRSRVotes.balanceOf(addr2.address)).to.equal(amount)
        expect(await stRSRVotes.balanceOf(addr3.address)).to.equal(0)
        expect(await stRSRVotes.exchangeRate()).to.equal(fp('1'))

        // Seize RSR 50%
        await whileImpersonating(backingManager.address, async (signer) => {
          await expect(stRSRVotes.connect(signer).seizeRSR(amount))
            .to.emit(stRSR, 'ExchangeRateSet')
            .withArgs(fp('1'), fp('0.5'))
        })

        // Check balances and stakes
        expect(await stRSRVotes.balanceOf(addr1.address)).to.equal(amount)
        expect(await stRSRVotes.balanceOf(addr2.address)).to.equal(amount)
        expect(await stRSRVotes.balanceOf(addr3.address)).to.equal(0)
        expect(await stRSRVotes.exchangeRate()).to.equal(fp('0.5'))

        // Advance block
        await advanceTime(1)

        // Check values after changing exchange rate
        currentBlockTimestamp = (await getLatestBlockTimestamp()) - 1
        expect(await stRSRVotes.getPastTotalSupply(currentBlockTimestamp)).to.equal(amount.mul(2))
        expect(await stRSRVotes.getPastVotes(addr1.address, currentBlockTimestamp)).to.equal(amount)
        expect(await stRSRVotes.getPastVotes(addr2.address, currentBlockTimestamp)).to.equal(amount)
        expect(await stRSRVotes.getPastVotes(addr3.address, currentBlockTimestamp)).to.equal(0)
        expect(await stRSRVotes.getVotes(addr1.address)).to.equal(amount)
        expect(await stRSRVotes.getVotes(addr2.address)).to.equal(amount)
        expect(await stRSRVotes.getVotes(addr3.address)).to.equal(0)

        // Perform a new stake with the updated rate
        await rsr.connect(addr3).approve(stRSRVotes.address, amount)
        await stRSRVotes.connect(addr3).stake(amount)

        // Advance block
        await advanceTime(1)

        // Check values after new stake - final stake counts double
        currentBlockTimestamp = (await getLatestBlockTimestamp()) - 1
        expect(await stRSRVotes.getPastTotalSupply(currentBlockTimestamp)).to.equal(amount.mul(4))
        expect(await stRSRVotes.getPastVotes(addr1.address, currentBlockTimestamp)).to.equal(amount)
        expect(await stRSRVotes.getPastVotes(addr2.address, currentBlockTimestamp)).to.equal(amount)
        expect(await stRSRVotes.getPastVotes(addr3.address, currentBlockTimestamp)).to.equal(
          amount.mul(2)
        )
        expect(await stRSRVotes.getVotes(addr1.address)).to.equal(amount)
        expect(await stRSRVotes.getVotes(addr2.address)).to.equal(amount)
        expect(await stRSRVotes.getVotes(addr3.address)).to.equal(amount.mul(2))
      })

      it('Should track votes properly when changing era', async function () {
        // Check values before changing era
        let currentBlockTimestamp = (await getLatestBlockTimestamp()) - 1
        expect(await stRSRVotes.getPastTotalSupply(currentBlockTimestamp)).to.equal(amount.mul(2))
        expect(await stRSRVotes.getPastVotes(addr1.address, currentBlockTimestamp)).to.equal(amount)
        expect(await stRSRVotes.getPastVotes(addr2.address, currentBlockTimestamp)).to.equal(amount)
        expect(await stRSRVotes.getPastVotes(addr3.address, currentBlockTimestamp)).to.equal(0)

        expect(await stRSRVotes.getVotes(addr1.address)).to.equal(amount)
        expect(await stRSRVotes.getVotes(addr2.address)).to.equal(amount)
        expect(await stRSRVotes.getVotes(addr3.address)).to.equal(0)

        // Perform wipeout - Seize RSR
        await whileImpersonating(backingManager.address, async (signer) => {
          await expect(stRSRVotes.connect(signer).seizeRSR(amount.mul(2)))
            .to.emit(stRSR, 'ExchangeRateSet')
            .withArgs(fp('1'), fp('1'))
        })

        // Check balances and stakes
        expect(await stRSRVotes.balanceOf(addr1.address)).to.equal(0)
        expect(await stRSRVotes.balanceOf(addr2.address)).to.equal(0)
        expect(await stRSRVotes.balanceOf(addr3.address)).to.equal(0)
        expect(await stRSRVotes.exchangeRate()).to.equal(fp('1'))

        // Advance block
        await advanceTime(1)

        // Should not have retroactively wiped past vote
        expect(await stRSRVotes.getPastTotalSupply(currentBlockTimestamp)).to.equal(amount.mul(2))
        expect(await stRSRVotes.getPastVotes(addr1.address, currentBlockTimestamp)).to.equal(amount)
        expect(await stRSRVotes.getPastVotes(addr2.address, currentBlockTimestamp)).to.equal(amount)
        expect(await stRSRVotes.getPastVotes(addr3.address, currentBlockTimestamp)).to.equal(0)

        // Check values after changing era
        currentBlockTimestamp = (await getLatestBlockTimestamp()) - 1
        expect(await stRSRVotes.getPastTotalSupply(currentBlockTimestamp)).to.equal(0)
        expect(await stRSRVotes.getPastVotes(addr1.address, currentBlockTimestamp)).to.equal(0)
        expect(await stRSRVotes.getPastVotes(addr2.address, currentBlockTimestamp)).to.equal(0)
        expect(await stRSRVotes.getPastVotes(addr3.address, currentBlockTimestamp)).to.equal(0)

        expect(await stRSRVotes.getVotes(addr1.address)).to.equal(0)
        expect(await stRSRVotes.getVotes(addr2.address)).to.equal(0)
        expect(await stRSRVotes.getVotes(addr3.address)).to.equal(0)

        // Perform a new stake with the updated era
        await rsr.connect(addr3).approve(stRSRVotes.address, amount)
        await stRSRVotes.connect(addr3).stake(amount)

        // Advance block
        await advanceTime(1)

        // Check values after new stake - final stake is registered
        currentBlockTimestamp = (await getLatestBlockTimestamp()) - 1
        expect(await stRSRVotes.getPastTotalSupply(currentBlockTimestamp)).to.equal(amount)
        expect(await stRSRVotes.getPastVotes(addr1.address, currentBlockTimestamp)).to.equal(0)
        expect(await stRSRVotes.getPastVotes(addr2.address, currentBlockTimestamp)).to.equal(0)
        expect(await stRSRVotes.getPastVotes(addr3.address, currentBlockTimestamp)).to.equal(amount)
      })

      it('Should update votes/checkpoints on transfer', async function () {
        // Check values before transfers
        const currentBlockTimestamp = (await getLatestBlockTimestamp()) - 1
        expect(await stRSRVotes.getPastTotalSupply(currentBlockTimestamp)).to.equal(amount.mul(2))
        expect(await stRSRVotes.getPastVotes(addr1.address, currentBlockTimestamp)).to.equal(amount)
        expect(await stRSRVotes.getPastVotes(addr2.address, currentBlockTimestamp)).to.equal(amount)
        expect(await stRSRVotes.getPastVotes(addr3.address, currentBlockTimestamp)).to.equal(0)

        expect(await stRSRVotes.getVotes(addr1.address)).to.equal(amount)
        expect(await stRSRVotes.getVotes(addr2.address)).to.equal(amount)
        expect(await stRSRVotes.getVotes(addr3.address)).to.equal(0)

        // Check checkpoint stored
        expect(await stRSRVotes.numCheckpoints(addr1.address)).to.equal(1)
        expect(await stRSRVotes.numCheckpoints(addr2.address)).to.equal(1)

        // Transfer stRSR
        await stRSRVotes.connect(addr1).transfer(addr2.address, amount)

        // Checkpoints stored
        expect(await stRSRVotes.numCheckpoints(addr1.address)).to.equal(2)
        expect(await stRSRVotes.checkpoints(addr1.address, 1)).to.eql([
          await getLatestBlockTimestamp(),
          bn(0),
        ])
        expect(await stRSRVotes.numCheckpoints(addr2.address)).to.equal(2)
        expect(await stRSRVotes.checkpoints(addr2.address, 1)).to.eql([
          await getLatestBlockTimestamp(),
          amount.mul(2),
        ])

        // Check current voting power has moved, previous values remain for older blocks
        expect(await stRSRVotes.getPastVotes(addr1.address, currentBlockTimestamp)).to.equal(amount)
        expect(await stRSRVotes.getPastVotes(addr2.address, currentBlockTimestamp)).to.equal(amount)
        expect(await stRSRVotes.getPastVotes(addr3.address, currentBlockTimestamp)).to.equal(0)

        expect(await stRSRVotes.getVotes(addr1.address)).to.equal(0)
        expect(await stRSRVotes.getVotes(addr2.address)).to.equal(amount.mul(2))
        expect(await stRSRVotes.getVotes(addr3.address)).to.equal(0)
      })

      it('Should remove voting weight on unstaking', async function () {
        // Check values before transfers
        const currentBlockTimestamp = (await getLatestBlockTimestamp()) - 1
        expect(await stRSRVotes.getPastTotalSupply(currentBlockTimestamp)).to.equal(amount.mul(2))
        expect(await stRSRVotes.getPastVotes(addr1.address, currentBlockTimestamp)).to.equal(amount)
        expect(await stRSRVotes.getPastVotes(addr2.address, currentBlockTimestamp)).to.equal(amount)
        expect(await stRSRVotes.getPastVotes(addr3.address, currentBlockTimestamp)).to.equal(0)

        expect(await stRSRVotes.getVotes(addr1.address)).to.equal(amount)
        expect(await stRSRVotes.getVotes(addr2.address)).to.equal(amount)
        expect(await stRSRVotes.getVotes(addr3.address)).to.equal(0)

        // Check checkpoint stored
        expect(await stRSRVotes.numCheckpoints(addr1.address)).to.equal(1)
        expect(await stRSRVotes.numCheckpoints(addr2.address)).to.equal(1)

        // Unstake stRSR
        await stRSRVotes.connect(addr2).unstake(amount)
        expect(await stRSRVotes.getVotes(addr1.address)).to.equal(amount)
        expect(await stRSRVotes.getVotes(addr2.address)).to.equal(0)
      })
    })
  })

  describe('(regressions)', () => {
    it('avoids paying revenue to an empty stRSR population', async () => {
      expect(await stRSR.totalSupply()).to.equal(0)

      await setNextBlockTimestamp(Number(await getLatestBlockTimestamp()) + 600_000)
      await rsr.mint(stRSR.address, bn('1e18'))
      // If some RSR rewards have been cooking in stRSR for a while, but no one is there to collect,
      await setNextBlockTimestamp(Number(await getLatestBlockTimestamp()) + 600_000)
      await stRSR.payoutRewards()
      await setNextBlockTimestamp(Number(await getLatestBlockTimestamp()) + 600_000)
      await stRSR.payoutRewards()

      // Then both totalStakes and stakeRSR should remain 0 after a few payoutRewards() calls
      // And, so, if someone then stakes a bit, they just get 1:1 stRSR for staked RSR.
      await rsr.connect(addr1).approve(stRSR.address, bn('1e18'))
      await stRSR.connect(addr1).stake(bn('1e18'))
      expect(await stRSR.balanceOf(addr1.address)).to.equal(bn('1e18'))
    })
  })

  describeExtreme(`Extreme Bounds ${SLOW ? 'slow mode' : 'fast mode'})`, () => {
    // Dimensions
    //
    // StRSR economics can be broken down into 4 "places" that RSR can be.
    // The StRSR balances and exchange rate is fully determined by these 4 dimensions.
    //
    //  1. RSR staked directly {qRSR}
    //  2. RSR accreted {qRSR}
    //  3. RSR being withdrawn {qRSR}
    //  4. RSR being rewarded {qRSR}
    //  5. Unstaking Delay {seconds}
    //  6. Reward Ratio {%}
    //
    //  3^7 = 2187 cases ~= about 2-3min runtime
    //  2^7 = 128 cases ~= about 10s runtime

    const runSimulation = async ([
      rsrStake,
      rsrAccreted,
      rsrWithdrawal,
      rsrReward,
      unstakingDelay,
      rewardRatio,
    ]: BigNumber[]) => {
      // === Setup ===

      // addr1 is the staker; addr2 is the withdrawer

      // addr1 - staker
      if (rsrStake.gt(0)) {
        await rsr.connect(owner).mint(addr1.address, rsrStake)
        await rsr.connect(addr1).approve(stRSR.address, rsrStake)
        await stRSR.connect(addr1).stake(rsrStake)
      }

      // addr2 - withdrawer
      if (rsrWithdrawal.gt(0)) {
        await rsr.connect(owner).mint(addr2.address, rsrWithdrawal)
        await rsr.connect(addr2).approve(stRSR.address, rsrWithdrawal)
        await stRSR.connect(addr2).stake(rsrWithdrawal)
      }

      // Do accretion
      if (rsrAccreted.gt(0)) {
        await rsr.connect(owner).mint(stRSR.address, rsrAccreted)
        await stRSR.connect(owner).setRewardRatio(bn('1e14')) // this pays out rewards
        await setNextBlockTimestamp(Number(ONE_PERIOD.add(await getLatestBlockTimestamp())))
        await expect(stRSR.payoutRewards())
        // now the mint has been fully paid out
      }

      // Config -- note this assumes the gov params have been chosen sensibly
      await stRSR.connect(owner).setUnstakingDelay(unstakingDelay)
      await stRSR.connect(owner).setRewardRatio(rewardRatio)

      // addr2 - withdrawer
      if (rsrWithdrawal.gt(0)) {
        const bal = await stRSR.balanceOf(addr2.address)
        await stRSR.connect(addr2).unstake(bal)
      }

      // Place Rewards
      await rsr.connect(owner).mint(stRSR.address, rsrReward)

      // === Simulate ===

      // To register the reward amount

      await setNextBlockTimestamp(Number(await getLatestBlockTimestamp()) + Number(ONE_PERIOD))
      await expect(stRSR.payoutRewards()).to.emit(stRSR, 'ExchangeRateSet')

      // Payout over 1000 periods
      await setNextBlockTimestamp(
        Number(await getLatestBlockTimestamp()) + 1000 * Number(ONE_PERIOD)
      )
      await stRSR.payoutRewards()

      if (rsrStake.gt(0)) {
        // Staker should be able to withdraw
        await stRSR.connect(addr1).unstake(await stRSR.balanceOf(addr1.address))
      }

      await advanceToTimestamp(Number(unstakingDelay.add(await getLatestBlockTimestamp())))

      // Clear both withdrawals
      if (rsrStake.gt(0)) {
        const endId = await stRSR.endIdForWithdraw(addr1.address)
        await expect(stRSR.withdraw(addr1.address, endId)).to.emit(stRSR, 'UnstakingCompleted')
      }
      if (rsrWithdrawal.gt(0)) {
        const endId = await stRSR.endIdForWithdraw(addr2.address)
        await expect(stRSR.withdraw(addr2.address, endId)).to.emit(stRSR, 'UnstakingCompleted')
      }
    }

    // 100B RSR
    const rsrStakes = [bn('1e29'), bn('0'), bn('1e18')]

    // the amount of RSR that has already been absorbed as profit
    // has to do with the initial exchange rate
    const rsrAccreteds = [bn('1e29'), bn('0'), bn('1e18')]

    const rsrWithdrawals = [bn('1e29'), bn('0'), bn('1e18')]

    const rsrRewards = [bn('1e29'), bn('0'), bn('1e18')]

    // max: 1 year
    const unstakingDelays = [bn(MAX_UNSTAKING_DELAY), bn('0'), bn('604800')]

    const rewardRatios = [bn('1e14'), fp('0'), fp('0.000001069671574938')]

    let dimensions = [
      rsrStakes,
      rsrAccreteds,
      rsrWithdrawals,
      rsrRewards,
      unstakingDelays,
      rewardRatios,
    ]

    // Restrict to 2^7 from 3^7 to decrease runtime
    if (!SLOW) {
      dimensions = dimensions.map((d) => [d[0], d[1]])
    }

    const cases = cartesianProduct(...dimensions)

    const numCases = cases.length.toString()

    cases.forEach((params, index) => {
      // if (2 periods <= unstakingDelay)
      if (ONE_PERIOD.mul(2).lte(params[4])) {
        it(`case ${index + 1} of ${numCases}: ${params.map(shortString).join(' ')}`, async () => {
          await runSimulation(params)
        })
      }
    })
  })

  describeGas('Gas Reporting', () => {
    let amount: BigNumber
    beforeEach(async function () {
      // Stake some RSR
      amount = bn('10e18')

      // Approve transfer and stake
      await rsr.connect(addr1).approve(stRSR.address, amount)

      await stRSR.connect(addr1).stake(amount)
    })

    it('Transfer', async function () {
      //  Perform transfer
      await snapshotGasCost(stRSR.connect(addr1).transfer(addr2.address, amount.div(2)))

      // Transfer again
      await snapshotGasCost(stRSR.connect(addr1).transfer(addr2.address, amount.div(2)))

      // Transfer back
      await snapshotGasCost(stRSR.connect(addr2).transfer(addr1.address, amount))
    })
    it('Stake', async function () {
      // Approve transfer and stake
      await rsr.connect(addr1).approve(stRSR.address, amount.mul(2))

      await snapshotGasCost(stRSR.connect(addr1).stake(amount))
      await snapshotGasCost(stRSR.connect(addr1).stake(amount))
    })
    it('Unstake', async function () {
      // Unstake
      await snapshotGasCost(stRSR.connect(addr1).unstake(amount.div(2)))
      await snapshotGasCost(stRSR.connect(addr1).unstake(amount.div(2)))
    })
    it('Withdraw', async function () {
      // Unstake
      await stRSR.connect(addr1).unstake(amount.div(2))
      await stRSR.connect(addr1).unstake(amount.div(2))

      // Check withdrawal properly registered
      await expectWithdrawal(addr1.address, 0, { rsrAmount: amount.div(2) })
      await expectWithdrawal(addr1.address, 1, { rsrAmount: amount.div(2) })

      // Advance timestamp
      await setNextBlockTimestamp(
        (await getLatestBlockTimestamp()) + config.unstakingDelay.toNumber() + 1
      )

      // Withdraw
      await snapshotGasCost(stRSR.connect(addr1).withdraw(addr1.address, 1))
      await snapshotGasCost(stRSR.connect(addr1).withdraw(addr1.address, 2))
    })
  })
})
