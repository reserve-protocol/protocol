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

    initialBalance = bn('1000e6')
    await whileImpersonating(holderUSDC, async (usdcSigner) => {
      await usdc.connect(usdcSigner).transfer(addr1.address, initialBalance)
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
      expect(depositedAmount1).to.equal('99736669')

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
      expect(depositedAmount1).to.equal('99736669')

      await wfCash.connect(addr1).withdraw(balanceRwfCash1.div(2))

      const balanceRwfCash2 = await wfCash.balanceOf(addr1.address)
      const depositedAmount2 = await wfCash.depositedBy(addr1.address)
      const balance2 = await usdc.balanceOf(addr1.address)

      expect(depositedAmount2).to.equal('49868335')
      expect(balanceRwfCash2).to.equal(balanceRwfCash1.div(2))
      expect(balance2.sub(balance1)).to.be.lt(amount) // due to premature redeeming is less
    })
  })

  describe('Transfers', () => {
    it('Should transfer half the stack correctly', async () => {
      const amount = bn('100e6')

      await usdc.connect(addr1).approve(wfCash.address, amount)
      await wfCash.connect(addr1).deposit(amount)

      const balanceRwfCash1 = await wfCash.balanceOf(addr1.address)
      const depositedAmount1 = await wfCash.depositedBy(addr1.address)

      expect(balanceRwfCash1).to.equal('10332924990')
      expect(depositedAmount1).to.equal('99736669')

      await wfCash.connect(addr1).transfer(addr2.address, balanceRwfCash1.div(2))

      const balanceRwfCash2 = await wfCash.balanceOf(addr2.address)
      const depositedAmount2 = await wfCash.depositedBy(addr2.address)

      expect(balanceRwfCash2).to.equal('5166462495')
      expect(depositedAmount2).to.equal('49868334')
    })
  })

  describe('RefPerTok compute', () => {
    it('Should return an initial refPerTok below 1', async () => {
      const amount = bn('100e6')

      await usdc.connect(addr1).approve(wfCash.address, amount)
      await wfCash.connect(addr1).deposit(amount)

      const refPerTok = await wfCash.connect(addr1).refPerTok()

      expect(refPerTok).to.be.closeTo(bn('1e8'), bn('5e6'))
    })
  })
})
