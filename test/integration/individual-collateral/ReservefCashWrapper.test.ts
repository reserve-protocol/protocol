import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, ContractFactory } from 'ethers'
import hre, { ethers } from 'hardhat'
import { IMPLEMENTATION } from '../../fixtures'
import { getChainId } from '#/common/blockchain-utils'
import { bn, fp, toBNDecimals } from '#/common/numbers'
import { ERC20Mock, ReservefCashWrapper } from '#/typechain'
import { whileImpersonating } from '../../utils/impersonation'
import { networkConfig } from '#/common/configuration'
import { advanceBlocks, advanceTime } from '../../utils/time'
import { evmRevert, evmSnapshot } from '../utils'
import { ZERO_ADDRESS } from '#/common/constants'
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
      expect(await wfCash.name()).to.equal('Reserve Wrapped fCash (Vault USD Coin)')
      expect(await wfCash.symbol()).to.equal('rwfCash:3')
      expect(await wfCash.decimals()).to.equal(18)
      expect(await wfCash.refPerTok()).to.equal(fp('1'))
      expect(await wfCash.totalSupply()).to.equal(0)
      expect(await wfCash.positionsAmount()).to.equal(0)
      expect(await wfCash.hasMatured()).to.be.false
      expect(await wfCash.activeMarkets()).to.length(0)
      expect(await wfCash.underlying()).to.equal(networkConfig[chainId].tokens.USDC)
    })

    it('Should return active markets', async () => {
      const markets = await wfCash.availableMarkets()

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
      ).to.be.reverted

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
      const balance1 = await usdc.balanceOf(addr1.address)
      const refPerTok1 = await wfCash.refPerTok()

      expect(balanceRwfCash1).to.be.closeTo(fp('100'), fp('0.6'))
      expect(await wfCash.activeMarkets()).to.length(1)

      await wfCash.connect(addr1).withdraw(balanceRwfCash1)

      const balanceRwfCash2 = await wfCash.balanceOf(addr1.address)
      const balance2 = await usdc.balanceOf(addr1.address)
      const refPerTok2 = await wfCash.refPerTok()

      expect(balanceRwfCash2).to.equal(0)
      expect(balance2.sub(balance1)).to.be.lt(amount) // due to premature redeeming is less
      expect(await wfCash.activeMarkets()).to.length(0)
      expect(refPerTok2).to.be.equal(refPerTok1)
    })

    it('Should deposit and withdraw half of it', async () => {
      const amount = bn('100e6')

      await usdc.connect(addr1).approve(wfCash.address, amount)
      await wfCash.connect(addr1).deposit(amount)

      const balanceRwfCash1 = await wfCash.balanceOf(addr1.address)
      const balance1 = await usdc.balanceOf(addr1.address)
      const refPerTok1 = await wfCash.refPerTok()

      expect(balanceRwfCash1).to.be.gt(toBNDecimals(amount, 18))
      expect(await wfCash.activeMarkets()).to.length(1)

      await wfCash.connect(addr1).withdraw(balanceRwfCash1.div(2))

      const balanceRwfCash2 = await wfCash.balanceOf(addr1.address)
      const balance2 = await usdc.balanceOf(addr1.address)
      const refPerTok2 = await wfCash.refPerTok()

      expect(balanceRwfCash2).to.equal(balanceRwfCash1.div(2))
      expect(balance2.sub(balance1)).to.be.lt(amount) // due to premature redeeming is less
      expect(await wfCash.activeMarkets()).to.length(1)
      expect(await wfCash.refPerTok()).to.equal(refPerTok1)
      expect(refPerTok2).to.equal(refPerTok1)
    })

    it('Should deposit and withdraw different maturities correctly', async () => {
      const amount = bn('100e6')
      const markets = await wfCash.availableMarkets()

      // maturity 1 deposit
      await usdc.connect(addr1).approve(wfCash.address, amount)
      await wfCash.connect(addr1).depositTo(amount, markets[0].maturity)

      // maturity 2 deposit
      await usdc.connect(addr1).approve(wfCash.address, amount)
      await wfCash.connect(addr1).depositTo(amount, markets[1].maturity)

      const balanceRwfCash = await wfCash.balanceOf(addr1.address)
      const refPerTok = await wfCash.refPerTok()

      expect(balanceRwfCash).to.be.gt(amount.mul(2))
      expect(await wfCash.activeMarkets()).to.length(2)

      await wfCash.connect(addr1).withdraw(balanceRwfCash)

      expect(await wfCash.balanceOf(addr1.address)).to.equal(0)
      expect(await wfCash.activeMarkets()).to.length(0)

      // should be equal but there is times that it shows this small deviation, but it does so randomly :/
      expect(await wfCash.refPerTok()).to.be.closeTo(refPerTok, fp('0.000000005'))
    })

    it('Should manage multiple deposits correctly', async () => {
      const amount = bn('100e6')
      const markets = await wfCash.availableMarkets()

      await usdc.connect(addr1).approve(wfCash.address, amount)
      await wfCash.connect(addr1).depositTo(amount, markets[0].maturity)
      await usdc.connect(addr1).approve(wfCash.address, amount)
      await wfCash.connect(addr1).depositTo(amount, markets[0].maturity)

      const balanceRwfCash = await wfCash.balanceOf(addr1.address)

      expect(balanceRwfCash).to.be.gt(amount.mul(2))
    })
  })

  describe('Transfers', () => {
    it('Should transfer single position to an empty address', async () => {
      const amount = bn('100e6')

      await usdc.connect(addr1).approve(wfCash.address, amount)
      await wfCash.connect(addr1).deposit(amount)

      const balanceRwfCash1 = await wfCash.balanceOf(addr1.address)

      expect(balanceRwfCash1).to.closeTo(bn('100.56426e18'), bn('0.00001e18'))
      expect(await wfCash.activeMarkets()).to.length(1)

      await wfCash.connect(addr1).transfer(addr2.address, balanceRwfCash1.div(2))

      const balanceRwfCash2 = await wfCash.balanceOf(addr2.address)

      expect(balanceRwfCash2).to.closeTo(bn('50.2821e18'), bn('0.0001e18'))
      expect(await wfCash.activeMarkets()).to.length(1)
    })

    it('Should transfer single position to account with different maturity', async () => {
      const amount = bn('100e6')
      const markets = await wfCash.availableMarkets()

      // address 1 deposit
      await usdc.connect(addr1).approve(wfCash.address, amount)
      await wfCash.connect(addr1).depositTo(amount, markets[0].maturity)
      const balanceRwfCash1 = await wfCash.balanceOf(addr1.address)

      // address 2 deposit
      await usdc.connect(addr2).approve(wfCash.address, amount)
      await wfCash.connect(addr2).depositTo(amount, markets[1].maturity)
      const balanceRwfCash2 = await wfCash.balanceOf(addr2.address)

      expect(await wfCash.activeMarkets()).to.length(2)

      await wfCash.connect(addr1).transfer(addr2.address, balanceRwfCash1.div(2))

      // assert
      const balanceToSend = balanceRwfCash1.div(2)
      expect(await wfCash.balanceOf(addr1.address)).to.equal(balanceToSend)
      expect(await wfCash.balanceOf(addr2.address)).to.equal(balanceRwfCash2.add(balanceToSend))

      expect(await wfCash.activeMarkets()).to.length(2)
    })

    it('Should transfer single position to account with the same maturity', async () => {
      const amount = bn('100e6')
      const markets = await wfCash.availableMarkets()

      // address 1 deposit
      await usdc.connect(addr1).approve(wfCash.address, amount)
      await wfCash.connect(addr1).depositTo(amount, markets[0].maturity)
      const balanceRwfCash1 = await wfCash.balanceOf(addr1.address)

      // address 2 deposit
      await usdc.connect(addr2).approve(wfCash.address, amount)
      await wfCash.connect(addr2).depositTo(amount, markets[0].maturity)
      const balanceRwfCash2 = await wfCash.balanceOf(addr2.address)

      expect(await wfCash.activeMarkets()).to.length(1)

      // transfer
      const balanceToSend = balanceRwfCash1.div(2)
      await wfCash.connect(addr1).transfer(addr2.address, balanceToSend)

      // assert
      expect(await wfCash.balanceOf(addr1.address)).to.equal(balanceToSend)
      expect(await wfCash.balanceOf(addr2.address)).to.equal(balanceRwfCash2.add(balanceToSend))

      expect(await wfCash.activeMarkets()).to.length(1)
    })

    it('Should transfer multiple positions to empty account', async () => {
      const amount = bn('100e6')
      const markets = await wfCash.availableMarkets()

      // address 1 deposit
      await usdc.connect(addr1).approve(wfCash.address, amount)
      await wfCash.connect(addr1).depositTo(amount, markets[0].maturity)
      await usdc.connect(addr1).approve(wfCash.address, amount)
      await wfCash.connect(addr1).depositTo(amount, markets[1].maturity)

      const balanceRwfCash1 = await wfCash.balanceOf(addr1.address)

      expect(await wfCash.activeMarkets()).to.length(2)

      await wfCash.connect(addr1).transfer(addr2.address, balanceRwfCash1)

      // assert
      expect(await wfCash.balanceOf(addr1.address)).to.equal(0)
      expect(await wfCash.balanceOf(addr2.address)).to.equal(balanceRwfCash1)

      expect(await wfCash.activeMarkets()).to.length(2)
    })

    it('Should transfer multiple positions to account with same maturities', async () => {
      const amount = bn('100e6')
      const markets = await wfCash.availableMarkets()

      // address 1 deposit
      await usdc.connect(addr1).approve(wfCash.address, amount)
      await wfCash.connect(addr1).depositTo(amount, markets[0].maturity)
      await usdc.connect(addr1).approve(wfCash.address, amount)
      await wfCash.connect(addr1).depositTo(amount, markets[1].maturity)

      const balanceRwfCash1 = await wfCash.balanceOf(addr1.address)

      // address 2 deposit
      await usdc.connect(addr2).approve(wfCash.address, amount)
      await wfCash.connect(addr2).depositTo(amount, markets[1].maturity)
      await usdc.connect(addr2).approve(wfCash.address, amount)
      await wfCash.connect(addr2).depositTo(amount, markets[2].maturity)

      const balanceRwfCash2 = await wfCash.balanceOf(addr2.address)

      expect(await wfCash.activeMarkets()).to.length(3)

      // transfer
      const halfStack = balanceRwfCash1.div(2)
      await wfCash.connect(addr1).transfer(addr2.address, halfStack)

      // assert
      expect(await wfCash.balanceOf(addr1.address)).to.equal(halfStack)
      expect(await wfCash.balanceOf(addr2.address)).to.equal(balanceRwfCash2.add(halfStack))

      expect(await wfCash.activeMarkets()).to.length(3)
    })
  })

  describe('RefPerTok', () => {
    it('Should use prevRefPerTok to compute current', async () => {
      const amount = bn('1000e6')
      const markets = await wfCash.availableMarkets()
      // prevRefPerTok is default to 1
      expect(await wfCash.refPerTok()).to.equal(fp('1'))

      await usdc.connect(addr1).approve(wfCash.address, amount)
      await wfCash.connect(addr1).depositTo(amount, markets[0].maturity)

      // it falls a bit when depositing market because of entering fee
      expect(await wfCash.refPerTok()).to.be.closeTo(fp('0.99'), fp('0.01'))

      await usdc.connect(addr1).approve(wfCash.address, amount)
      await wfCash.connect(addr1).depositTo(amount, markets[0].maturity)

      expect(await wfCash.refPerTok()).to.be.closeTo(fp('0.99'), fp('0.01'))
    })

    it('Should have an increasing refPerTok', async () => {
      const amount = bn('100e6')

      await usdc.connect(addr1).approve(wfCash.address, amount)
      await wfCash.connect(addr1).deposit(amount)
      let lastRefPerTok = await wfCash.refPerTok()

      for (let i = 0; i < 10; i++) {
        await advanceTime(1000)
        await advanceBlocks(1000)
        const refPerTok = await wfCash.refPerTok()
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

      expect(await wfCash.connect(addr1).hasMatured()).to.be.false
      expect(await wfCash.activeMarkets()).to.length(1)

      await advanceTime(SPAN_UNTIL_MATURE)
      await advanceBlocks(SPAN_UNTIL_MATURE)

      expect(await wfCash.connect(addr1).hasMatured()).to.be.true

      await wfCash.connect(addr1).reinvest()

      expect(await wfCash.connect(addr1).hasMatured()).to.be.false
      expect(await wfCash.activeMarkets()).to.length(1)
      expect(await wfCash.balanceOf(addr1.address)).to.equal(balanceRwfCash1)

      await evmRevert(snapshotId)
    })

    it('Should reinvest position into an existing market', async () => {
      const amount = bn('100e6')
      const markets = await wfCash.availableMarkets()
      const snapshotId = await evmSnapshot()

      await usdc.connect(addr1).approve(wfCash.address, amount)
      await wfCash.connect(addr1).depositTo(amount, markets[0].maturity)
      await usdc.connect(addr1).approve(wfCash.address, amount)
      await wfCash.connect(addr1).depositTo(amount, markets[1].maturity)
      const balanceRwfCash1 = await wfCash.balanceOf(addr1.address)

      expect(await wfCash.connect(addr1).hasMatured()).to.be.false
      expect(await wfCash.activeMarkets()).to.length(2)

      await advanceTime(SPAN_UNTIL_MATURE)
      await advanceBlocks(SPAN_UNTIL_MATURE)

      expect(await wfCash.connect(addr1).hasMatured()).to.be.true

      await wfCash.connect(addr1).reinvest()

      expect(await wfCash.connect(addr1).hasMatured()).to.be.false
      expect(await wfCash.activeMarkets()).to.length(1)
      expect(await wfCash.balanceOf(addr1.address)).to.equal(balanceRwfCash1)

      await evmRevert(snapshotId)
    })

    it('Should reinvest position into an existing market when multiple open', async () => {
      const amount = bn('100e6')
      const markets = await wfCash.availableMarkets()
      const snapshotId = await evmSnapshot()

      await usdc.connect(addr1).approve(wfCash.address, amount)
      await wfCash.connect(addr1).depositTo(amount, markets[0].maturity)
      await usdc.connect(addr1).approve(wfCash.address, amount)
      await wfCash.connect(addr1).depositTo(amount, markets[1].maturity)
      await usdc.connect(addr1).approve(wfCash.address, amount)
      await wfCash.connect(addr1).depositTo(amount, markets[2].maturity)
      const balanceRwfCash1 = await wfCash.balanceOf(addr1.address)

      expect(await wfCash.connect(addr1).hasMatured()).to.be.false
      expect(await wfCash.activeMarkets()).to.length(3)

      await advanceTime(SPAN_UNTIL_MATURE)
      await advanceBlocks(SPAN_UNTIL_MATURE)

      expect(await wfCash.connect(addr1).hasMatured()).to.be.true

      await wfCash.connect(addr1).reinvest()

      expect(await wfCash.connect(addr1).hasMatured()).to.be.false
      expect(await wfCash.activeMarkets()).to.length(2)
      expect(await wfCash.balanceOf(addr1.address)).to.equal(balanceRwfCash1)

      await evmRevert(snapshotId)
    })

    it('Should lose a bit of value when reinvest due to entering market fee', async () => {
      const amount = bn('100e6')
      const snapshotId = await evmSnapshot()

      await usdc.connect(addr1).approve(wfCash.address, amount)
      await wfCash.connect(addr1).deposit(amount)
      const balanceRwfCash1 = await wfCash.balanceOf(addr1.address)
      const refPerTok1 = await wfCash.refPerTok()

      expect(await wfCash.connect(addr1).hasMatured()).to.be.false
      expect(await wfCash.activeMarkets()).to.length(1)

      await advanceTime(SPAN_UNTIL_MATURE)
      await advanceBlocks(SPAN_UNTIL_MATURE)

      expect(await wfCash.connect(addr1).hasMatured()).to.be.true
      const refPerTok2 = await wfCash.refPerTok()

      // refPerTok is 1 when the first cycle matures (1 fCash == 1 underlying token)
      expect(refPerTok2).to.equal(fp('1'))

      const position1 = await wfCash.positionsAmount()

      await wfCash.connect(addr1).reinvest()

      const refPerTok3 = await wfCash.refPerTok()
      const position2 = await wfCash.positionsAmount()

      expect(await wfCash.connect(addr1).hasMatured()).to.be.false
      expect(await wfCash.activeMarkets()).to.length(1)
      expect(await wfCash.balanceOf(addr1.address)).to.equal(balanceRwfCash1)
      expect(refPerTok2).to.be.gt(refPerTok1)
      expect(refPerTok3).to.be.lt(refPerTok2)
      expect(refPerTok3).to.be.closeTo(refPerTok2, bn('0.03e18'))
      expect(position2).to.be.gt(position1)

      await evmRevert(snapshotId)
    })
  })
})
