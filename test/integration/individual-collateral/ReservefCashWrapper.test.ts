import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, ContractFactory } from 'ethers'
import hre, { ethers } from 'hardhat'
import { IMPLEMENTATION } from '../../fixtures'
import { getChainId } from '../../../common/blockchain-utils'
import { bn, toBNDecimals } from '../../../common/numbers'
import { ERC20Mock, ReservefCashWrapper } from '../../../typechain'
import { whileImpersonating } from '../../utils/impersonation'
import { networkConfig } from '../../../common/configuration'
import { advanceBlocks, advanceTime } from '../../utils/time'
import { evmRevert, evmSnapshot } from '../utils'
import { ZERO_ADDRESS } from '../../../common/constants'
import forkBlockNumber from '../fork-block-numbers'

const describeFork = process.env.FORK ? describe : describe.skip

const holderUSDC = '0x0A59649758aa4d66E25f08Dd01271e891fe52199'

describeFork(`ReservefCashWrapper - Mainnet Forking P${IMPLEMENTATION}`, function () {
  let addr1: SignerWithAddress
  let addr2: SignerWithAddress

  let usdc: ERC20Mock
  let wfCash: ReservefCashWrapper

  let chainId: number
  let initialBalance: BigNumber
  let WrappedFCashFactory: ContractFactory

  const setup = async (blockNumber: number) => {
    // Use Mainnet fork
    await hre.network.provider.request({
      method: 'hardhat_reset',
      params: [
        {
          forking: {
            jsonRpcUrl: process.env.MAINNET_RPC_URL,
            blockNumber: blockNumber,
          },
        },
      ],
    })
  }

  before(async () => {
    await setup(forkBlockNumber['notional-fixed-rate'])
    chainId = await getChainId(hre)
    if (!networkConfig[chainId]) {
      throw new Error(`Missing network configuration for ${hre.network.name}`)
    }
  })

  beforeEach(async () => {
    ;[, addr1, addr2] = await ethers.getSigners()

    WrappedFCashFactory = await ethers.getContractFactory('ReservefCashWrapper')
    wfCash = <ReservefCashWrapper>await WrappedFCashFactory.deploy(
      '0x1344A36A1B56144C3Bc62E7757377D288fDE0369',
      '0x5D051DeB5db151C2172dCdCCD42e6A2953E27261',
      networkConfig[chainId].tokens.USDC || '',
      3 // USDC
    )

    usdc = <ERC20Mock>(
      await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.USDC || '')
    )

    initialBalance = bn('10000e6')
    await whileImpersonating(holderUSDC, async (usdcSigner) => {
      await usdc.connect(usdcSigner).transfer(addr1.address, initialBalance)
      await usdc.connect(usdcSigner).transfer(addr2.address, initialBalance)
    })
  })

  describe('Deployment', () => {
    it('Should have set basics correctly', async () => {
      expect(await wfCash.decimals()).to.equal(8)
    })

    it('Should return active markets', async () => {
      const markets = await wfCash.activeMarkets()

      expect(markets.length).to.equal(3)
      expect(markets[0].maturity).to.equal('1664064000')
    })

    it('Should validate constructor arguments correctly', async () => {
      await expect(
        WrappedFCashFactory.deploy(
          ZERO_ADDRESS,
          '0x5D051DeB5db151C2172dCdCCD42e6A2953E27261',
          networkConfig[chainId].tokens.USDC || '',
          3 // USDC
        )
      ).to.be.revertedWith('missing notional proxy address')

      await expect(
        WrappedFCashFactory.deploy(
          '0x1344A36A1B56144C3Bc62E7757377D288fDE0369',
          ZERO_ADDRESS,
          networkConfig[chainId].tokens.USDC || '',
          3 // USDC
        )
      ).to.be.revertedWith('missing wfCashFactory address')

      await expect(
        WrappedFCashFactory.deploy(
          '0x1344A36A1B56144C3Bc62E7757377D288fDE0369',
          '0x5D051DeB5db151C2172dCdCCD42e6A2953E27261',
          ZERO_ADDRESS,
          3 // USDC
        )
      ).to.be.revertedWith('missing underlying asset address')

      await expect(
        WrappedFCashFactory.deploy(
          '0x1344A36A1B56144C3Bc62E7757377D288fDE0369',
          '0x5D051DeB5db151C2172dCdCCD42e6A2953E27261',
          networkConfig[chainId].tokens.USDC || '',
          0
        )
      ).to.be.revertedWith('invalid currencyId')
    })
  })

  describe('Deposit/Withdraw', () => {
    it('Should deposit and withdraw whole stack correctly', async () => {
      const amount = bn('100e6')

      await usdc.connect(addr1).approve(wfCash.address, amount)
      await wfCash.connect(addr1).deposit(amount)

      const balanceRwfCash1 = await wfCash.balanceOf(addr1.address)
      const depositedAmount1 = await wfCash.depositedBy(addr1.address)
      const balance1 = await usdc.balanceOf(addr1.address)

      expect(balanceRwfCash1).to.be.gt(toBNDecimals(amount, 8))
      expect(depositedAmount1).to.equal(amount)
      expect((await wfCash.activeMarketsOf(addr1.address)).length).to.equal(1)

      await wfCash.connect(addr1).withdraw(balanceRwfCash1)

      const balanceRwfCash2 = await wfCash.balanceOf(addr1.address)
      const depositedAmount2 = await wfCash.depositedBy(addr1.address)
      const balance2 = await usdc.balanceOf(addr1.address)

      expect(depositedAmount2).to.equal(0)
      expect(balanceRwfCash2).to.equal(0)
      expect(balance2.sub(balance1)).to.be.lt(amount) // due to premature redeeming is less
      expect((await wfCash.activeMarketsOf(addr1.address)).length).to.equal(0)
    })

    it('Should deposit and withdraw half of it', async () => {
      const amount = bn('100e6')

      await usdc.connect(addr1).approve(wfCash.address, amount)
      await wfCash.connect(addr1).deposit(amount)

      const balanceRwfCash1 = await wfCash.balanceOf(addr1.address)
      const depositedAmount1 = await wfCash.depositedBy(addr1.address)
      const balance1 = await usdc.balanceOf(addr1.address)

      expect(balanceRwfCash1).to.be.gt(toBNDecimals(amount, 8))
      expect(depositedAmount1).to.equal(amount)
      expect((await wfCash.activeMarketsOf(addr1.address)).length).to.equal(1)

      await wfCash.connect(addr1).withdraw(balanceRwfCash1.div(2))

      const balanceRwfCash2 = await wfCash.balanceOf(addr1.address)
      const depositedAmount2 = await wfCash.depositedBy(addr1.address)
      const balance2 = await usdc.balanceOf(addr1.address)

      expect(depositedAmount2).to.equal(amount.div(2))
      expect(balanceRwfCash2).to.equal(balanceRwfCash1.div(2))
      expect(balance2.sub(balance1)).to.be.lt(amount) // due to premature redeeming is less
      expect((await wfCash.activeMarketsOf(addr1.address)).length).to.equal(1)
    })

    it('Should deposit and withdraw different maturities correctly', async () => {
      const amount = bn('100e6')
      const markets = await wfCash.activeMarkets()

      // maturity 1 deposit
      await usdc.connect(addr1).approve(wfCash.address, amount)
      await wfCash.connect(addr1).depositTo(amount, markets[0].maturity)

      // maturity 2 deposit
      await usdc.connect(addr1).approve(wfCash.address, amount)
      await wfCash.connect(addr1).depositTo(amount, markets[1].maturity)

      const balanceRwfCash = await wfCash.balanceOf(addr1.address)
      const depositedAmount = await wfCash.depositedBy(addr1.address)

      expect(depositedAmount).to.closeTo(amount.mul(2), bn('0.3e6'))
      expect(balanceRwfCash).to.be.gt(amount.mul(2))
      expect((await wfCash.activeMarketsOf(addr1.address)).length).to.equal(2)

      await wfCash.connect(addr1).withdraw(balanceRwfCash)

      expect(await wfCash.balanceOf(addr1.address)).to.equal(0)
      expect(await wfCash.depositedBy(addr1.address)).to.equal(0)
      expect((await wfCash.activeMarketsOf(addr1.address)).length).to.equal(0)
    })

    it('Should manage multiple deposits correctly', async () => {
      const amount = bn('100e6')
      const markets = await wfCash.activeMarkets()

      await usdc.connect(addr1).approve(wfCash.address, amount)
      await wfCash.connect(addr1).depositTo(amount, markets[0].maturity)
      await usdc.connect(addr1).approve(wfCash.address, amount)
      await wfCash.connect(addr1).depositTo(amount, markets[0].maturity)

      const balanceRwfCash = await wfCash.balanceOf(addr1.address)
      const depositedAmount = await wfCash.depositedBy(addr1.address)

      expect(depositedAmount).to.be.closeTo(amount.mul(2), bn('0.3e6'))
      expect(balanceRwfCash).to.be.gt(amount.mul(2))
    })
  })

  describe('Transfers', () => {
    it('Should transfer single position to an empty address', async () => {
      const amount = bn('100e6')

      await usdc.connect(addr1).approve(wfCash.address, amount)
      await wfCash.connect(addr1).deposit(amount)

      const balanceRwfCash1 = await wfCash.balanceOf(addr1.address)
      const depositedAmount1 = await wfCash.depositedBy(addr1.address)

      expect(balanceRwfCash1).to.closeTo(bn('100.56427e8'), bn('1e4'))
      expect(depositedAmount1).to.equal(amount)
      expect((await wfCash.activeMarketsOf(addr1.address)).length).to.equal(1)
      expect((await wfCash.activeMarketsOf(addr2.address)).length).to.equal(0)

      await wfCash.connect(addr1).transfer(addr2.address, balanceRwfCash1.div(2))

      const balanceRwfCash2 = await wfCash.balanceOf(addr2.address)
      const depositedAmount2 = await wfCash.depositedBy(addr2.address)

      expect(balanceRwfCash2).to.closeTo(bn('50.2821e8'), bn('1e4'))
      expect(depositedAmount2).to.equal(depositedAmount1.div(2))
      expect((await wfCash.activeMarketsOf(addr1.address)).length).to.equal(1)
      expect((await wfCash.activeMarketsOf(addr2.address)).length).to.equal(1)
    })

    it('Should transfer single position to account with different maturity', async () => {
      const amount = bn('100e6')
      const markets = await wfCash.activeMarkets()

      // address 1 deposit
      await usdc.connect(addr1).approve(wfCash.address, amount)
      await wfCash.connect(addr1).depositTo(amount, markets[0].maturity)
      const balanceRwfCash1 = await wfCash.balanceOf(addr1.address)
      const depositedAmount1 = await wfCash.depositedBy(addr1.address)

      // address 2 deposit
      await usdc.connect(addr2).approve(wfCash.address, amount)
      await wfCash.connect(addr2).depositTo(amount, markets[1].maturity)
      const balanceRwfCash2 = await wfCash.balanceOf(addr2.address)
      const depositedAmount2 = await wfCash.depositedBy(addr2.address)

      expect((await wfCash.activeMarketsOf(addr1.address)).length).to.equal(1)
      expect((await wfCash.activeMarketsOf(addr2.address)).length).to.equal(1)

      await wfCash.connect(addr1).transfer(addr2.address, balanceRwfCash1.div(2))

      // assert
      const balanceToSend = balanceRwfCash1.div(2)
      expect(await wfCash.balanceOf(addr1.address)).to.equal(balanceToSend)
      expect(await wfCash.balanceOf(addr2.address)).to.equal(balanceRwfCash2.add(balanceToSend))

      expect(await wfCash.depositedBy(addr1.address)).to.closeTo(depositedAmount1.div(2), bn(1e2))
      expect(await wfCash.depositedBy(addr2.address)).to.equal(
        depositedAmount2.add(depositedAmount1.div(2))
      )

      expect((await wfCash.activeMarketsOf(addr1.address)).length).to.equal(1)
      expect((await wfCash.activeMarketsOf(addr2.address)).length).to.equal(2)
    })

    it('Should transfer single position to account with the same maturity', async () => {
      const amount = bn('100e6')
      const markets = await wfCash.activeMarkets()

      // address 1 deposit
      await usdc.connect(addr1).approve(wfCash.address, amount)
      await wfCash.connect(addr1).depositTo(amount, markets[0].maturity)
      const balanceRwfCash1 = await wfCash.balanceOf(addr1.address)
      const depositedAmount1 = await wfCash.depositedBy(addr1.address)

      // address 2 deposit
      await usdc.connect(addr2).approve(wfCash.address, amount)
      await wfCash.connect(addr2).depositTo(amount, markets[0].maturity)
      const balanceRwfCash2 = await wfCash.balanceOf(addr2.address)
      const depositedAmount2 = await wfCash.depositedBy(addr2.address)

      expect((await wfCash.activeMarketsOf(addr1.address)).length).to.equal(1)
      expect((await wfCash.activeMarketsOf(addr2.address)).length).to.equal(1)

      // transfer
      const balanceToSend = balanceRwfCash1.div(2)
      await wfCash.connect(addr1).transfer(addr2.address, balanceToSend)

      // assert
      expect(await wfCash.balanceOf(addr1.address)).to.equal(balanceToSend)
      expect(await wfCash.balanceOf(addr2.address)).to.equal(balanceRwfCash2.add(balanceToSend))

      expect(await wfCash.depositedBy(addr1.address)).to.closeTo(depositedAmount1.div(2), bn(1e2))
      expect(await wfCash.depositedBy(addr2.address)).to.equal(
        depositedAmount2.add(depositedAmount1.div(2))
      )

      expect((await wfCash.activeMarketsOf(addr1.address)).length).to.equal(1)
      expect((await wfCash.activeMarketsOf(addr2.address)).length).to.equal(1)
    })

    it('Should transfer multiple positions to empty account', async () => {
      const amount = bn('100e6')
      const markets = await wfCash.activeMarkets()

      // address 1 deposit
      await usdc.connect(addr1).approve(wfCash.address, amount)
      await wfCash.connect(addr1).depositTo(amount, markets[0].maturity)
      await usdc.connect(addr1).approve(wfCash.address, amount)
      await wfCash.connect(addr1).depositTo(amount, markets[1].maturity)

      const balanceRwfCash1 = await wfCash.balanceOf(addr1.address)
      const depositedAmount1 = await wfCash.depositedBy(addr1.address)

      expect((await wfCash.activeMarketsOf(addr1.address)).length).to.equal(2)
      expect((await wfCash.activeMarketsOf(addr2.address)).length).to.equal(0)

      await wfCash.connect(addr1).transfer(addr2.address, balanceRwfCash1)

      // assert
      expect(await wfCash.balanceOf(addr1.address)).to.equal(0)
      expect(await wfCash.balanceOf(addr2.address)).to.equal(balanceRwfCash1)

      expect(await wfCash.depositedBy(addr1.address)).to.equal(0)
      expect(await wfCash.depositedBy(addr2.address)).to.equal(depositedAmount1)

      expect((await wfCash.activeMarketsOf(addr1.address)).length).to.equal(0)
      expect((await wfCash.activeMarketsOf(addr2.address)).length).to.equal(2)
    })

    it('Should transfer multiple positions to account with same maturities', async () => {
      const amount = bn('100e6')
      const markets = await wfCash.activeMarkets()

      // address 1 deposit
      await usdc.connect(addr1).approve(wfCash.address, amount)
      await wfCash.connect(addr1).depositTo(amount, markets[0].maturity)
      await usdc.connect(addr1).approve(wfCash.address, amount)
      await wfCash.connect(addr1).depositTo(amount, markets[1].maturity)

      const balanceRwfCash1 = await wfCash.balanceOf(addr1.address)
      const depositedAmount1 = await wfCash.depositedBy(addr1.address)

      // address 2 deposit
      await usdc.connect(addr2).approve(wfCash.address, amount)
      await wfCash.connect(addr2).depositTo(amount, markets[1].maturity)
      await usdc.connect(addr2).approve(wfCash.address, amount)
      await wfCash.connect(addr2).depositTo(amount, markets[2].maturity)

      const balanceRwfCash2 = await wfCash.balanceOf(addr2.address)
      const depositedAmount2 = await wfCash.depositedBy(addr2.address)

      expect((await wfCash.activeMarketsOf(addr1.address)).length).to.equal(2)
      expect((await wfCash.activeMarketsOf(addr2.address)).length).to.equal(2)

      // transfer
      const halfStack = balanceRwfCash1.div(2)
      await wfCash.connect(addr1).transfer(addr2.address, halfStack)

      // assert
      expect(await wfCash.balanceOf(addr1.address)).to.equal(halfStack)
      expect(await wfCash.balanceOf(addr2.address)).to.equal(balanceRwfCash2.add(halfStack))

      expect(await wfCash.depositedBy(addr1.address)).to.closeTo(depositedAmount1.div(2), bn(1))
      expect(await wfCash.depositedBy(addr2.address)).to.closeTo(
        depositedAmount2.add(depositedAmount1.div(2)),
        bn(1)
      )

      expect((await wfCash.activeMarketsOf(addr1.address)).length).to.equal(2)
      expect((await wfCash.activeMarketsOf(addr2.address)).length).to.equal(3)
    })
  })

  describe('Underlying value', () => {
    it('Should return an initial refPerTok below 1', async () => {
      const amount = bn('100e6')
      const markets = await wfCash.activeMarkets()

      await usdc.connect(addr1).approve(wfCash.address, amount)
      await wfCash.connect(addr1).depositTo(amount, markets[0].maturity)
      await usdc.connect(addr1).approve(wfCash.address, amount)
      await wfCash.connect(addr1).depositTo(amount, markets[0].maturity)

      const refPerTok1 = await wfCash.refPerTok(addr1.address)

      expect(refPerTok1).to.be.lt(bn('1e8')) // because of entry market fee
    })

    it('Should have an increasing refPerTok', async () => {
      const amount = bn('100e6')

      await usdc.connect(addr1).approve(wfCash.address, amount)
      await wfCash.connect(addr1).deposit(amount)
      let lastRefPerTok = await wfCash.refPerTok(addr1.address)

      for (let i = 0; i < 10; i++) {
        await advanceTime(1000)
        await advanceBlocks(1000)
        const refPerTok = await wfCash.refPerTok(addr1.address)
        expect(refPerTok).to.be.gt(lastRefPerTok)
        lastRefPerTok = refPerTok
      }
    })
  })

  describe('Reinvest', () => {
    const SPAN_UNTIL_MATURE = 3300000

    it('Should reinvest position into a new market', async () => {
      const amount = bn('100e6')
      const snapshotId = await evmSnapshot()

      await usdc.connect(addr1).approve(wfCash.address, amount)
      await wfCash.connect(addr1).deposit(amount)
      const balanceRwfCash1 = await wfCash.balanceOf(addr1.address)
      const depositedAmount1 = await wfCash.depositedBy(addr1.address)

      expect(await wfCash.connect(addr1).hasMatured()).to.be.false
      expect((await wfCash.activeMarketsOf(addr1.address)).length).to.equal(1)

      await advanceTime(SPAN_UNTIL_MATURE)
      await advanceBlocks(SPAN_UNTIL_MATURE)

      expect(await wfCash.connect(addr1).hasMatured()).to.be.true

      await wfCash.connect(addr1).reinvest()

      expect(await wfCash.connect(addr1).hasMatured()).to.be.false
      expect((await wfCash.activeMarketsOf(addr1.address)).length).to.equal(1)
      expect(await wfCash.depositedBy(addr1.address)).to.equal(depositedAmount1)
      expect(await wfCash.balanceOf(addr1.address)).to.gt(balanceRwfCash1)

      await evmRevert(snapshotId)
    })

    it('Should reinvest position into an existing market', async () => {
      const amount = bn('100e6')
      const markets = await wfCash.activeMarkets()
      const snapshotId = await evmSnapshot()

      await usdc.connect(addr1).approve(wfCash.address, amount)
      await wfCash.connect(addr1).depositTo(amount, markets[0].maturity)
      await usdc.connect(addr1).approve(wfCash.address, amount)
      await wfCash.connect(addr1).depositTo(amount, markets[1].maturity)
      const balanceRwfCash1 = await wfCash.balanceOf(addr1.address)
      const depositedAmount1 = await wfCash.depositedBy(addr1.address)

      expect(await wfCash.connect(addr1).hasMatured()).to.be.false
      expect((await wfCash.activeMarketsOf(addr1.address)).length).to.equal(2)

      await advanceTime(SPAN_UNTIL_MATURE)
      await advanceBlocks(SPAN_UNTIL_MATURE)

      expect(await wfCash.connect(addr1).hasMatured()).to.be.true

      await wfCash.connect(addr1).reinvest()

      expect(await wfCash.connect(addr1).hasMatured()).to.be.false
      expect((await wfCash.activeMarketsOf(addr1.address)).length).to.equal(1)
      expect(await wfCash.depositedBy(addr1.address)).to.equal(depositedAmount1)
      expect(await wfCash.balanceOf(addr1.address)).to.gt(balanceRwfCash1)

      await evmRevert(snapshotId)
    })

    it('Should reinvest position into an existing market when multiple open', async () => {
      const amount = bn('100e6')
      const markets = await wfCash.activeMarkets()
      const snapshotId = await evmSnapshot()

      await usdc.connect(addr1).approve(wfCash.address, amount)
      await wfCash.connect(addr1).depositTo(amount, markets[0].maturity)
      await usdc.connect(addr1).approve(wfCash.address, amount)
      await wfCash.connect(addr1).depositTo(amount, markets[1].maturity)
      await usdc.connect(addr1).approve(wfCash.address, amount)
      await wfCash.connect(addr1).depositTo(amount, markets[2].maturity)
      const balanceRwfCash1 = await wfCash.balanceOf(addr1.address)
      const depositedAmount1 = await wfCash.depositedBy(addr1.address)

      expect(await wfCash.connect(addr1).hasMatured()).to.be.false
      expect((await wfCash.activeMarketsOf(addr1.address)).length).to.equal(3)

      await advanceTime(SPAN_UNTIL_MATURE)
      await advanceBlocks(SPAN_UNTIL_MATURE)

      expect(await wfCash.connect(addr1).hasMatured()).to.be.true

      await wfCash.connect(addr1).reinvest()

      expect(await wfCash.connect(addr1).hasMatured()).to.be.false
      expect((await wfCash.activeMarketsOf(addr1.address)).length).to.equal(2)
      expect(await wfCash.depositedBy(addr1.address)).to.equal(depositedAmount1)
      expect(await wfCash.balanceOf(addr1.address)).to.gt(balanceRwfCash1)

      await evmRevert(snapshotId)
    })

    it('Should lose a bit of value when reinvest due to entering market fee', async () => {
      const amount = bn('100e6')
      const snapshotId = await evmSnapshot()

      await usdc.connect(addr1).approve(wfCash.address, amount)
      await wfCash.connect(addr1).deposit(amount)
      const balanceRwfCash1 = await wfCash.balanceOf(addr1.address)
      const depositedAmount1 = await wfCash.depositedBy(addr1.address)
      const refPerTok1 = await wfCash.refPerTok(addr1.address)

      expect(await wfCash.connect(addr1).hasMatured()).to.be.false
      expect((await wfCash.activeMarketsOf(addr1.address)).length).to.equal(1)

      await advanceTime(SPAN_UNTIL_MATURE)
      await advanceBlocks(SPAN_UNTIL_MATURE)

      expect(await wfCash.connect(addr1).hasMatured()).to.be.true
      const refPerTok2 = await wfCash.refPerTok(addr1.address)

      await wfCash.connect(addr1).reinvest()

      const refPerTok3 = await wfCash.refPerTok(addr1.address)

      expect(await wfCash.connect(addr1).hasMatured()).to.be.false
      expect((await wfCash.activeMarketsOf(addr1.address)).length).to.equal(1)
      expect(await wfCash.depositedBy(addr1.address)).to.equal(depositedAmount1)
      expect(await wfCash.balanceOf(addr1.address)).to.gt(balanceRwfCash1)
      expect(refPerTok2).to.be.gt(refPerTok1)
      expect(refPerTok3).to.be.lt(refPerTok2)
      expect(refPerTok3).to.be.closeTo(refPerTok2, bn('0.03e8'))

      await evmRevert(snapshotId)
    })
  })
})
