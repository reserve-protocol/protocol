import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber } from 'ethers'
import hre, { ethers } from 'hardhat'
import { IMPLEMENTATION } from '../../fixtures'
import { getChainId } from '../../../common/blockchain-utils'
import { bn, toBNDecimals } from '../../../common/numbers'
import { ERC20Mock, ReserveWrappedFCash } from '../../../typechain'
import { whileImpersonating } from '../../utils/impersonation'
import { networkConfig } from '../../../common/configuration'
import { advanceBlocks, advanceTime } from '../../utils/time'

const describeFork = process.env.FORK ? describe : describe.skip

const holderUSDC = '0x0A59649758aa4d66E25f08Dd01271e891fe52199'

describeFork(`ReserveWrappedfCash - Mainnet Forking P${IMPLEMENTATION}`, function () {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress
  let addr2: SignerWithAddress

  let usdc: ERC20Mock
  let wfCash: ReserveWrappedFCash

  let chainId: number
  let initialBalance: BigNumber

  before(async () => {
    chainId = await getChainId(hre)
    if (!networkConfig[chainId]) {
      throw new Error(`Missing network configuration for ${hre.network.name}`)
    }
  })

  beforeEach(async () => {
    ;[owner, addr1, addr2] = await ethers.getSigners()

    const WrappedFCashFactory = await ethers.getContractFactory('ReserveWrappedFCash')
    wfCash = <ReserveWrappedFCash>(
      await WrappedFCashFactory.deploy(
        '0x1344A36A1B56144C3Bc62E7757377D288fDE0369',
        '0x5D051DeB5db151C2172dCdCCD42e6A2953E27261',
        networkConfig[chainId].tokens.USDC || '',
        3
      )
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
    it('Should setup RToken, Assets, and Collateral correctly', async () => {
      expect(await wfCash.decimals()).to.equal(8)
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
      expect(depositedAmount1).to.equal('99936667')

      await wfCash.connect(addr1).withdraw(balanceRwfCash1)

      const balanceRwfCash2 = await wfCash.balanceOf(addr1.address)
      const depositedAmount2 = await wfCash.depositedBy(addr1.address)
      const balance2 = await usdc.balanceOf(addr1.address)

      expect(depositedAmount2).to.equal(0)
      expect(balanceRwfCash2).to.equal(0)
      expect(balance2.sub(balance1)).to.be.lt(amount) // due to premature redeeming is less
    })

    it('Should deposit and withdraw half of it', async () => {
      const amount = bn('100e6')

      await usdc.connect(addr1).approve(wfCash.address, amount)
      await wfCash.connect(addr1).deposit(amount)

      const balanceRwfCash1 = await wfCash.balanceOf(addr1.address)
      const depositedAmount1 = await wfCash.depositedBy(addr1.address)
      const balance1 = await usdc.balanceOf(addr1.address)

      expect(balanceRwfCash1).to.be.gt(toBNDecimals(amount, 8))
      expect(depositedAmount1).to.closeTo(bn('99.9366e6'), bn('1e2'))

      await wfCash.connect(addr1).withdraw(balanceRwfCash1.div(2))

      const balanceRwfCash2 = await wfCash.balanceOf(addr1.address)
      const depositedAmount2 = await wfCash.depositedBy(addr1.address)
      const balance2 = await usdc.balanceOf(addr1.address)

      expect(depositedAmount2).to.closeTo(bn('49.9683e6'), bn('1e2'))
      expect(balanceRwfCash2).to.equal(balanceRwfCash1.div(2))
      expect(balance2.sub(balance1)).to.be.lt(amount) // due to premature redeeming is less
    })
  })

  describe('Transfers', () => {
    it('Should transfer correctly to an empty address', async () => {
      const amount = bn('100e6')

      await usdc.connect(addr1).approve(wfCash.address, amount)
      await wfCash.connect(addr1).deposit(amount)

      const balanceRwfCash1 = await wfCash.balanceOf(addr1.address)
      const depositedAmount1 = await wfCash.depositedBy(addr1.address)

      expect(balanceRwfCash1).to.closeTo(bn('100.56427e8'), bn('1e4'))
      expect(depositedAmount1).to.closeTo(bn('99.9366e6'), bn('1e2'))

      await wfCash.connect(addr1).transfer(addr2.address, balanceRwfCash1.div(2))

      const balanceRwfCash2 = await wfCash.balanceOf(addr2.address)
      const depositedAmount2 = await wfCash.depositedBy(addr2.address)

      expect(balanceRwfCash2).to.closeTo(bn('50.2821e8'), bn('1e4'))
      expect(depositedAmount2).to.closeTo(bn('49.9683e6'), bn('1e2'))
    })

    it('Should fail to transfer to a different maturity', async () => {
      const amount = bn('100e6')

      // address 1 deposit
      await usdc.connect(addr1).approve(wfCash.address, amount)
      await wfCash.connect(addr1).depositTo(amount, 0)
      const balanceRwfCash1 = await wfCash.balanceOf(addr1.address)

      // address 2 deposit
      await usdc.connect(addr2).approve(wfCash.address, amount)
      await wfCash.connect(addr2).depositTo(amount, 1)

      await expect(
        wfCash.connect(addr1).transfer(addr2.address, balanceRwfCash1.div(2))
      ).to.be.revertedWith('different maturities')
    })

    it('Should allow to transfer to the same maturity', async () => {
      const amount = bn('100e6')

      // address 1 deposit
      await usdc.connect(addr1).approve(wfCash.address, amount)
      await wfCash.connect(addr1).depositTo(amount, 0)
      const balanceRwfCash1 = await wfCash.balanceOf(addr1.address)
      const depositedAmount1 = await wfCash.depositedBy(addr1.address)

      // address 2 deposit
      await usdc.connect(addr2).approve(wfCash.address, amount)
      await wfCash.connect(addr2).depositTo(amount, 0)
      const balanceRwfCash2 = await wfCash.balanceOf(addr2.address)
      const depositedAmount2 = await wfCash.depositedBy(addr2.address)

      // transfer
      const balanceToSend = balanceRwfCash1.div(2)
      await wfCash.connect(addr1).transfer(addr2.address, balanceToSend)

      // assert
      expect(await wfCash.balanceOf(addr1.address)).to.equal(balanceToSend)
      expect(await wfCash.balanceOf(addr2.address)).to.equal(balanceRwfCash2.add(balanceToSend))

      expect(await wfCash.depositedBy(addr1.address)).to.closeTo(depositedAmount1.div(2), bn(1e2))
      expect(await wfCash.depositedBy(addr2.address)).to.equal(
        depositedAmount2.add(depositedAmount2.div(2))
      )
    })
  })

  describe('RefPerTok compute', () => {
    it('Should return an initial refPerTok below 1', async () => {
      const amount = bn('100e6')

      await usdc.connect(addr1).approve(wfCash.address, amount)
      await wfCash.connect(addr1).deposit(amount)

      const refPerTok1 = await wfCash.connect(addr1).refPerTok()

      expect(refPerTok1).to.be.lt(bn('1e8'))
    })

    it('Should have an increasing refPerTok', async () => {
      const amount = bn('100e6')

      await usdc.connect(addr1).approve(wfCash.address, amount)
      await wfCash.connect(addr1).deposit(amount)
      let lastRefPerTok = await wfCash.connect(addr1).refPerTok()

      for (let i = 0; i < 50; i++) {
        await advanceTime(1000)
        await advanceBlocks(1000)
        const refPerTok = await wfCash.connect(addr1).refPerTok()
        expect(refPerTok).to.be.gt(lastRefPerTok)
        lastRefPerTok = refPerTok
      }
    })
  })

  describe('Reinvest', () => {
    it('Should mature after a while', async () => {
      const amount = bn('100e6')

      await usdc.connect(addr1).approve(wfCash.address, amount)
      await wfCash.connect(addr1).deposit(amount)

      expect(await wfCash.connect(addr1).hasMatured()).to.be.false

      while (!(await wfCash.connect(addr1).hasMatured())) {
        await advanceTime(100000)
        await advanceBlocks(100000)
      }

      expect(await wfCash.connect(addr1).hasMatured()).to.be.true
    })
  })
})
