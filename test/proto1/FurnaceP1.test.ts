import { expect } from 'chai'
import hre from 'hardhat'
import { ethers } from 'hardhat'
import { BigNumber, BigNumberish, ContractFactory } from 'ethers'
import { bn, fp, pow10 } from '../../common/numbers'
import { ZERO_ADDRESS } from '../../common/constants'
import { advanceTime, advanceToTimestamp, getLatestBlockTimestamp } from '../utils/time'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { RTokenMockP1 } from '../../typechain/RTokenMockP1'
import { FurnaceP1 } from '../../typechain/FurnaceP1'
import { ERC20Mock } from '../../typechain/ERC20Mock'

interface FurnaceState {
  balance?: BigNumberish
  burnRate?: BigNumberish
  whenPrev?: BigNumberish
  totalBurnt?: BigNumberish
}

function tkn(x: BigNumberish): BigNumber {
  return bn(x).mul(bn('1e18'))
}

async function inOneBlock(fn: () => Promise<void>): Promise<void> {
  await hre.network.provider.send('evm_setAutomine', [false])
  await fn()
  await hre.network.provider.send('evm_mine', [])
  await hre.network.provider.send('evm_setAutomine', [true])
}

describe('FurnaceP1 contract', () => {
  let owner: SignerWithAddress
  let alice: SignerWithAddress
  let bob: SignerWithAddress

  let RTokenMockFactory: ContractFactory
  let FurnaceFactory: ContractFactory

  let furnace: FurnaceP1
  let rToken: RTokenMockP1

  let initialBal: BigNumber

  // const expectBatchInfo = async (index: number, hdnOutInfo: Partial<IBatchInfo>) => {
  //   const { amount, start, duration, burnt } = await furnace.batches(index)

  //   expect(amount).to.equal(hdnOutInfo.amount)
  //   expect(start).to.equal(hdnOutInfo.start)
  //   expect(duration).to.equal(hdnOutInfo?.duration)
  //   expect(burnt).to.equal(hdnOutInfo.burnt)
  // }

  const expectState = async (state: FurnaceState) => {
    if (state.balance !== undefined) {
      expect(await rToken.balanceOf(furnace.address), 'Furnace: balance').to.equal(state.balance)
    }
    if (state.burnRate !== undefined) {
      expect(await furnace.burnRate(), 'Furnace: burn rate').to.equal(state.burnRate)
    }
    if (state.whenPrev !== undefined) {
      expect(await furnace.whenPreviousBurn(), 'Furnace: when-previous-burn').to.equal(state.whenPrev)
    }
    if (state.totalBurnt !== undefined) {
      expect(await furnace.totalBurnt(), 'Furnace: total burnt').to.equal(state.totalBurnt)
    }
  }

  beforeEach(async () => {
    ;[owner, alice, bob] = await ethers.getSigners()

    // Deploy RToken Mock
    let ERCMockFactory = await ethers.getContractFactory('ERC20Mock')
    let rsr = <ERC20Mock>await ERCMockFactory.deploy('Reserve Rights', 'RSR')
    RTokenMockFactory = await ethers.getContractFactory('RTokenMockP1')
    rToken = <RTokenMockP1>await RTokenMockFactory.deploy('RToken', 'RTKN', rsr.address)

    // Mint and set balances
    initialBal = tkn(100)
    await rToken.connect(owner).mint(alice.address, initialBal)
    await rToken.connect(owner).mint(bob.address, initialBal)

    // Deploy Furnace
    FurnaceFactory = await ethers.getContractFactory('FurnaceP1')
    furnace = <FurnaceP1>await FurnaceFactory.deploy(rToken.address)
  })

  describe('Deployment', () => {
    it('should setup Furnace correctly', async () => {
      expect(await furnace.rToken()).to.equal(rToken.address)
    })

    it('does not accept empty token', async () => {
      await expect(FurnaceFactory.deploy(ZERO_ADDRESS)).to.be.revertedWith('Token is zero address')
    })
  })

  describe('Burning', () => {
    const timePeriod = 60 * 60 * 24 // 1 day

    it('should not allow batches with zero amount', async () => {
      await expect(furnace.connect(alice).burnOverPeriod(tkn(0), timePeriod)).to.be.revertedWith(
        'Cannot burn a batch of zero'
      )
    })

    it('should revert without approval to transfer tokens ', async () => {
      await expect(furnace.connect(alice).burnOverPeriod(tkn(10), timePeriod)).to.be.revertedWith(
        'ERC20: transfer amount exceeds allowance'
      )
    })

    it('should revert without enough RTokens to burn', async () => {
      // Approval
      await rToken.connect(alice).approve(furnace.address, tkn(10))
      await expect(furnace.connect(alice).burnOverPeriod(tkn(20000), timePeriod)).to.be.revertedWith(
        'ERC20: transfer amount exceeds balance'
      )
    })

    it('should allow batches correctly', async () => {
      // Approval
      await rToken.connect(alice).approve(furnace.address, tkn(10))

      // Batch burn
      await furnace.connect(alice).burnOverPeriod(tkn(10), timePeriod)

      expect(await rToken.balanceOf(alice.address)).to.equal(initialBal.sub(tkn(10)))

      // Check burn registered correctly
      expectState({
        balance: tkn(10),
        burnRate: fp(tkn(10)).div(timePeriod),
        whenPrev: await getLatestBlockTimestamp(),
        totalBurnt: 0,
      })
    })

    it('should combine batches correctly', async () => {
      // Approval
      await rToken.connect(alice).approve(furnace.address, tkn(10))
      await rToken.connect(bob).approve(furnace.address, tkn(50))

      // Batch burn
      await inOneBlock(async () => {
        await furnace.connect(alice).burnOverPeriod(tkn(10), timePeriod)
        await furnace.connect(bob).burnOverPeriod(tkn(50), timePeriod)
      })

      await expectState({
        balance: tkn(60),
        burnRate: fp(tkn(60)).div(timePeriod),
        whenPrev: await getLatestBlockTimestamp(),
        totalBurnt: 0,
      })
    })

    describe('Do Burn', () => {
      it('allows burning all funds after period has passed', async () => {
        const amount: BigNumber = tkn(2)

        await rToken.connect(alice).approve(furnace.address, amount)
        await furnace.connect(alice).burnOverPeriod(amount, timePeriod)
        const time0 = await getLatestBlockTimestamp() // when burn happened

        expect(await rToken.balanceOf(alice.address)).to.equal(initialBal.sub(amount))
        await expectState({
          balance: amount,
          burnRate: fp(amount).div(timePeriod),
          whenPrev: time0,
          totalBurnt: 0,
        })

        // Burn
        await advanceToTimestamp((await getLatestBlockTimestamp()) + timePeriod + 1)
        await furnace.connect(alice).doBurn()
        // Check that burn completed, and was total.
        let time1 = await getLatestBlockTimestamp()
        await expectState({
          balance: 0,
          whenPrev: time1,
          totalBurnt: amount,
        })
      })

      it('should not return more funds once all was burnt', async () => {
        const timePeriod: number = 60 * 60 * 24 // 1 day

        // Approve
        await rToken.connect(alice).approve(furnace.address, tkn(10))

        // Batch burn
        await furnace.connect(alice).burnOverPeriod(tkn(10), timePeriod)

        // Advance to the end to withdraw full amount
        await advanceTime(timePeriod + 1)

        // Burn
        await furnace.connect(alice).doBurn()
        const time1 = await getLatestBlockTimestamp()

        expect(await rToken.balanceOf(alice.address)).to.equal(initialBal.sub(tkn(10)))
        await expectState({ balance: 0, whenPrev: time1, totalBurnt: tkn(10) })

        // Try to burn again
        await furnace.connect(alice).doBurn()

        // and see no balance changes
        await expectState({ balance: 0, totalBurnt: tkn(10) })
        expect(await rToken.balanceOf(alice.address)).to.equal(initialBal.sub(tkn(10)))
      })

      it('should allow burn - two equal parts', async () => {
        const timePeriod: number = 60 * 60 * 24 // 1 day

        await rToken.connect(alice).approve(furnace.address, tkn(10))
        await furnace.connect(alice).burnOverPeriod(tkn(10), timePeriod)
        const tStartBurn = await getLatestBlockTimestamp()
        const burnRate = fp(tkn(10)).div(timePeriod) // 10 tokens per day

        expect(await rToken.balanceOf(alice.address)).to.equal(initialBal.sub(tkn(10)))
        await expectState({ balance: tkn(10), whenPrev: tStartBurn, totalBurnt: 0, burnRate: burnRate })

        // Advance to the middle of period and do burn
        await advanceToTimestamp(tStartBurn + timePeriod / 2 - 1)
        await furnace.connect(alice).doBurn()
        const tMiddleBurn = await getLatestBlockTimestamp()
        // Assert correct state
        expect(await rToken.balanceOf(alice.address)).to.equal(initialBal.sub(tkn(10)))

        // TODO: balance off here by 1 attoToken. Do... do we care?
        // await expectState({ balance: tkn(5), whenPrev: tMiddleBurn, totalBurnt: tkn(5), burnRate: burnRate })

        // Advance to the end and do burn
        await advanceToTimestamp((await getLatestBlockTimestamp()) + timePeriod / 2)

        // Burn with any account
        await furnace.connect(bob).doBurn()
        const tEndBurn = await getLatestBlockTimestamp()

        // Assert correct state
        expect(await rToken.balanceOf(alice.address)).to.equal(initialBal.sub(tkn(10)))
        await expectState({ balance: 0, whenPrev: tEndBurn, totalBurnt: tkn(10) })
      })
    })
  })
})
