import { ethers } from 'hardhat'
import { expect } from 'chai'
import { ZERO_ADDRESS, BN_SCALE_FACTOR } from '../../common/constants'
import { bn, divCeil } from '../../common/numbers'
import { advanceTime } from '../utils/time'
import { BigNumber, BigNumberish, ContractFactory } from 'ethers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { ERC20Mock } from '../../typechain/ERC20Mock.d'
import { CircuitBreaker } from '../../typechain/CircuitBreaker.d'
import { ReserveRightsTokenMock } from '../../typechain/ReserveRightsTokenMock.d'
import { RSR } from '../../typechain/RSR.d'
import { RTokenMock } from '../../typechain/RTokenMock.d'
import { TXFeeCalculatorMock } from '../../typechain/TXFeeCalculatorMock.d'
import { IBasketToken, IRTokenConfig, IRSRConfig, IRTokenParams } from '../../common/configuration'

// Sample Values for Configuration
const stakingDepositDelay = 3600 // seconds
const stakingWithdrawalDelay = 4800 // seconds
const issuanceRate = BigNumber.from(25000)
const maxSupply = BigNumber.from(100000)
const minMintingSize = BigNumber.from(50)
const spread = BigNumber.from(10)
const rebalancingFreezeCost = BigNumber.from(50000)

describe('RToken contract', function () {
  let CircuitBreakerFactory: ContractFactory
  let owner: SignerWithAddress
  let addr1: SignerWithAddress
  let addr2: SignerWithAddress
  let bskToken: ERC20Mock
  let cb: CircuitBreaker
  let prevRSRToken: ReserveRightsTokenMock
  let rsrToken: RSR
  let rToken: RTokenMock
  let config: IRTokenParams
  let basketTokens: IBasketToken[]
  let rsrTokenInfo: IRSRConfig
  let ERC20: ContractFactory
  let bskToken2: ERC20Mock
  let bskToken3: ERC20Mock
  let newTokens: IBasketToken[] = []

  beforeEach(async function () {
    ;[owner, addr1, addr2] = await ethers.getSigners()

    CircuitBreakerFactory = await ethers.getContractFactory('CircuitBreaker')
    cb = <CircuitBreaker>await CircuitBreakerFactory.deploy(owner.address)

    ERC20 = await ethers.getContractFactory('ERC20Mock')
    bskToken = <ERC20Mock>await ERC20.deploy('Basket Token', 'BSK')

    // RToken Configuration and setup
    config = {
      stakingDepositDelay,
      stakingWithdrawalDelay: stakingWithdrawalDelay,
      maxSupply: maxSupply,
      minMintingSize: minMintingSize,
      issuanceRate: issuanceRate,
      rebalancingFreezeCost: rebalancingFreezeCost,
      insurancePaymentPeriod: 0,
      expansionPerSecond: 0,
      expenditureFactor: 0,
      spread: spread,
      exchange: ZERO_ADDRESS,
      circuitBreaker: cb.address,
      txFeeCalculator: ZERO_ADDRESS,
      insurancePool: ZERO_ADDRESS,
      protocolFund: ZERO_ADDRESS,
    }

    basketTokens = [
      {
        tokenAddress: bskToken.address,
        genesisQuantity: bn(1e18),
        rateLimit: 1,
        maxTrade: 1,
        priceInRToken: 0,
        slippageTolerance: 0,
      },
    ]
    // RSR (Insurance token)
    const PrevRSR = await ethers.getContractFactory('ReserveRightsTokenMock')
    const NewRSR = await ethers.getContractFactory('RSR')
    prevRSRToken = <ReserveRightsTokenMock>await PrevRSR.deploy('Reserve Rights', 'RSR')
    await prevRSRToken.mint(owner.address, bn(100000))
    await prevRSRToken.mint(addr1.address, bn(50000))
    await prevRSRToken.mint(addr2.address, bn(50000))
    await prevRSRToken.connect(owner).pause()
    rsrToken = <RSR>await NewRSR.connect(owner).deploy(prevRSRToken.address, ZERO_ADDRESS, ZERO_ADDRESS)
    // Set RSR token info
    rsrTokenInfo = {
      tokenAddress: rsrToken.address,
      genesisQuantity: 0,
      rateLimit: 1,
      maxTrade: 1,
      priceInRToken: 0,
      slippageTolerance: 0,
    }

    // External math lib
    const CompoundMath = await ethers.getContractFactory('CompoundMath')
    const math = await CompoundMath.deploy()

    // Deploy RToken and InsurancePool implementations
    const RToken = await ethers.getContractFactory('RTokenMock', {
      libraries: {
        CompoundMath: math.address,
      },
    })
    // Deploy RToken
    rToken = <RTokenMock>await RToken.connect(owner).deploy()
    await rToken.connect(owner).initialize('RToken', 'RTKN', config, basketTokens, rsrTokenInfo)
  })

  describe('Deployment', function () {
    it('Deployment should setup initial values correctly', async function () {
      expect(await rToken.issuanceRate()).to.equal(issuanceRate)
      expect(await rToken.circuitBreaker()).to.equal(cb.address)
      expect(await rToken.stakingDepositDelay()).to.equal(stakingDepositDelay)
      expect(await rToken.stakingWithdrawalDelay()).to.equal(stakingWithdrawalDelay)
      expect(await rToken.maxSupply()).to.equal(maxSupply)
      expect(await rToken.rebalancingFreezeCost()).to.equal(rebalancingFreezeCost)
    })

    it('Should deploy with no tokens', async function () {
      const ownerBalance = await rToken.balanceOf(owner.address)
      expect(await rToken.totalSupply()).to.equal(ownerBalance)
      expect(await rToken.totalSupply()).to.equal(0)
    })

    it('Should setup basket tokens correctly', async function () {
      expect(await rToken.basketSize()).to.equal(1)
      const bskTokenInfo = await rToken.basketToken(0)
      expect(bskTokenInfo.tokenAddress).to.equal(bskToken.address)
      expect(bskTokenInfo.genesisQuantity).to.equal(bn(1e18))
      expect(bskTokenInfo.rateLimit).to.equal(1)
    })
  })

  describe('Updates/Changes to Configuration', function () {
    let currentValue: BigNumberish
    let newValue: number
    let newConfig: IRTokenParams

    describe('stakingDepositDelay', function () {
      beforeEach(async function () {
        currentValue = stakingDepositDelay
        newValue = 1000
        newConfig = config
      })

      it('Should update correctly if Owner', async function () {
        expect(await rToken.stakingDepositDelay()).to.equal(currentValue)

        // Update individual field
        newConfig.stakingDepositDelay = newValue
        await expect(rToken.connect(owner).updateConfig(newConfig)).to.emit(rToken, 'ConfigUpdated')

        expect(await rToken.stakingDepositDelay()).to.equal(newValue)
      })

      it('Should not allow to update if not Owner', async function () {
        expect(await rToken.stakingDepositDelay()).to.equal(currentValue)

        // Update individual field
        newConfig.stakingDepositDelay = newValue
        await expect(rToken.connect(addr1).updateConfig(newConfig)).to.be.revertedWith(
          'Ownable: caller is not the owner'
        )

        expect(await rToken.stakingDepositDelay()).to.equal(currentValue)
      })
    })

    describe('stakingWithdrawalDelay', function () {
      beforeEach(async function () {
        currentValue = stakingWithdrawalDelay
        newValue = 1000
        newConfig = config
      })

      it('Should update correctly if Owner', async function () {
        expect(await rToken.stakingWithdrawalDelay()).to.equal(currentValue)

        // Update individual field
        newConfig.stakingWithdrawalDelay = newValue
        await expect(rToken.connect(owner).updateConfig(newConfig)).to.emit(rToken, 'ConfigUpdated')

        expect(await rToken.stakingWithdrawalDelay()).to.equal(newValue)
      })

      it('Should not allow to update if not Owner', async function () {
        expect(await rToken.stakingWithdrawalDelay()).to.equal(currentValue)

        // Update individual field
        newConfig.stakingWithdrawalDelay = newValue
        await expect(rToken.connect(addr1).updateConfig(newConfig)).to.be.revertedWith(
          'Ownable: caller is not the owner'
        )

        expect(await rToken.stakingWithdrawalDelay()).to.equal(currentValue)
      })
    })

    describe('maxSupply', function () {
      let newValue: BigNumber

      beforeEach(async function () {
        currentValue = maxSupply
        newValue = BigNumber.from(500000)
        newConfig = config
      })

      it('Should update correctly if Owner', async function () {
        expect(await rToken.maxSupply()).to.equal(currentValue)

        // Update individual field
        newConfig.maxSupply = newValue
        await expect(rToken.connect(owner).updateConfig(newConfig)).to.emit(rToken, 'ConfigUpdated')

        expect(await rToken.maxSupply()).to.equal(newValue)
      })

      it('Should not allow to update if not Owner', async function () {
        expect(await rToken.maxSupply()).to.equal(currentValue)

        // Update individual field
        newConfig.maxSupply = newValue
        await expect(rToken.connect(addr1).updateConfig(newConfig)).to.be.revertedWith(
          'Ownable: caller is not the owner'
        )

        expect(await rToken.maxSupply()).to.equal(currentValue)
      })
    })

    describe('issuanceRate', function () {
      let newValue: BigNumber

      beforeEach(async function () {
        currentValue = issuanceRate
        newValue = BigNumber.from(10000)
        newConfig = config
      })

      it('Should update correctly if Owner', async function () {
        expect(await rToken.issuanceRate()).to.equal(currentValue)

        // Update individual field
        newConfig.issuanceRate = newValue
        await expect(rToken.connect(owner).updateConfig(newConfig)).to.emit(rToken, 'ConfigUpdated')

        expect(await rToken.issuanceRate()).to.equal(newValue)
      })

      it('Should not allow to update if not Owner', async function () {
        expect(await rToken.issuanceRate()).to.equal(currentValue)

        // Update individual field
        newConfig.issuanceRate = newValue
        await expect(rToken.connect(addr1).updateConfig(newConfig)).to.be.revertedWith(
          'Ownable: caller is not the owner'
        )

        expect(await rToken.issuanceRate()).to.equal(currentValue)
      })
    })

    describe('spread', function () {
      let newValue: BigNumber

      beforeEach(async function () {
        currentValue = spread
        newValue = BigNumber.from(15)
        newConfig = config
      })

      it('Should update correctly if Owner', async function () {
        expect(await rToken.spread()).to.equal(currentValue)

        // Update individual field
        newConfig.spread = newValue
        await expect(rToken.connect(owner).updateConfig(newConfig)).to.emit(rToken, 'ConfigUpdated')

        expect(await rToken.spread()).to.equal(newValue)
      })

      it('Should not allow to update if not Owner', async function () {
        expect(await rToken.spread()).to.equal(currentValue)

        // Update individual field
        newConfig.spread = newValue
        await expect(rToken.connect(addr1).updateConfig(newConfig)).to.be.revertedWith(
          'Ownable: caller is not the owner'
        )

        expect(await rToken.spread()).to.equal(currentValue)
      })
    })

    describe('rebalancingFreezeCost', function () {
      let newValue: BigNumber

      beforeEach(async function () {
        currentValue = rebalancingFreezeCost
        newValue = BigNumber.from(30000)
        newConfig = config
      })

      it('Should update correctly if Owner', async function () {
        expect(await rToken.rebalancingFreezeCost()).to.equal(currentValue)

        // Update individual field
        newConfig.rebalancingFreezeCost = newValue
        await expect(rToken.connect(owner).updateConfig(newConfig)).to.emit(rToken, 'ConfigUpdated')

        expect(await rToken.rebalancingFreezeCost()).to.equal(newValue)
      })

      it('Should not allow to update if not Owner', async function () {
        expect(await rToken.rebalancingFreezeCost()).to.equal(currentValue)

        // Update individual field
        newConfig.rebalancingFreezeCost = newValue
        await expect(rToken.connect(addr1).updateConfig(newConfig)).to.be.revertedWith(
          'Ownable: caller is not the owner'
        )

        expect(await rToken.rebalancingFreezeCost()).to.equal(currentValue)
      })
    })

    describe('circuitBreaker', function () {
      let cbNew: CircuitBreaker
      let newValue: string

      beforeEach(async function () {
        currentValue = cb.address
        cbNew = <CircuitBreaker>await CircuitBreakerFactory.deploy(owner.address)
        newValue = cbNew.address
        newConfig = config
      })

      it('Should update correctly if Owner', async function () {
        expect(await rToken.circuitBreaker()).to.equal(currentValue)

        // Update individual field
        newConfig.circuitBreaker = newValue
        await expect(rToken.connect(owner).updateConfig(newConfig)).to.emit(rToken, 'ConfigUpdated')

        expect(await rToken.circuitBreaker()).to.equal(newValue)
      })

      it('Should not allow to update if not Owner', async function () {
        expect(await rToken.circuitBreaker()).to.equal(currentValue)

        // Update individual field
        newConfig.circuitBreaker = newValue
        await expect(rToken.connect(addr1).updateConfig(newConfig)).to.be.revertedWith(
          'Ownable: caller is not the owner'
        )

        expect(await rToken.circuitBreaker()).to.equal(currentValue)
      })
    })

    describe('txFeeCalculator', function () {
      let txFeeNew: TXFeeCalculatorMock
      let newValue: string

      beforeEach(async function () {
        currentValue = ZERO_ADDRESS
        const TxFeeCalculator = await ethers.getContractFactory('TXFeeCalculatorMock')
        txFeeNew = <TXFeeCalculatorMock>await TxFeeCalculator.deploy()
        newValue = txFeeNew.address
        newConfig = config
      })

      it('Should update correctly if Owner', async function () {
        expect(await rToken.txFeeCalculator()).to.equal(currentValue)

        // Update individual field
        newConfig.txFeeCalculator = newValue
        await expect(rToken.connect(owner).updateConfig(newConfig)).to.emit(rToken, 'ConfigUpdated')

        expect(await rToken.txFeeCalculator()).to.equal(newValue)
      })

      it('Should not allow to update if not Owner', async function () {
        expect(await rToken.txFeeCalculator()).to.equal(currentValue)

        // Update individual field
        newConfig.txFeeCalculator = newValue
        await expect(rToken.connect(addr1).updateConfig(newConfig)).to.be.revertedWith(
          'Ownable: caller is not the owner'
        )

        expect(await rToken.txFeeCalculator()).to.equal(currentValue)
      })
    })
  })

  describe('Updates/Changes to Basket', function () {
    let newTokens: IBasketToken[]

    beforeEach(async function () {
      bskToken2 = <ERC20Mock>await ERC20.deploy('Basket Token 2', 'BSK2')
      bskToken3 = <ERC20Mock>await ERC20.deploy('Basket Token 3', 'BSK3')
      newTokens = [
        // We always need to keep previous tokens but set Qty to 0 to remove
        {
          tokenAddress: bskToken.address,
          genesisQuantity: 0,
          rateLimit: 1,
          maxTrade: 1,
          priceInRToken: 0,
          slippageTolerance: 0,
        },
        {
          tokenAddress: bskToken2.address,
          genesisQuantity: 2,
          rateLimit: 1,
          maxTrade: 1,
          priceInRToken: 0,
          slippageTolerance: 0,
        },
        {
          tokenAddress: bskToken3.address,
          genesisQuantity: 3,
          rateLimit: 1,
          maxTrade: 1,
          priceInRToken: 0,
          slippageTolerance: 0,
        },
      ]
    })

    it('Should update basket correctly if Owner', async function () {
      expect(await rToken.basketSize()).to.equal(basketTokens.length)
      let result = await rToken.basketToken(0)
      expect(result.tokenAddress).to.equal(bskToken.address)

      // Update basket
      await expect(rToken.connect(owner).updateBasket(newTokens))
        .to.emit(rToken, 'BasketUpdated')
        .withArgs(basketTokens.length, newTokens.length)

      // Check basket was set properly
      expect(await rToken.basketSize()).to.equal(newTokens.length)

      result = await rToken.basketToken(0)
      expect(result.tokenAddress).to.equal(bskToken.address)

      result = await rToken.basketToken(1)
      expect(result.tokenAddress).to.equal(bskToken2.address)

      result = await rToken.basketToken(2)
      expect(result.tokenAddress).to.equal(bskToken3.address)
    })

    it('Should not allow to update basket if not Owner', async function () {
      expect(await rToken.basketSize()).to.equal(basketTokens.length)
      let result = await rToken.basketToken(0)
      expect(result.tokenAddress).to.equal(bskToken.address)

      // Update basket
      await expect(rToken.connect(addr1).updateBasket(newTokens)).to.be.revertedWith('Ownable: caller is not the owner')

      // Check basket was not updated
      expect(await rToken.basketSize()).to.equal(basketTokens.length)
      result = await rToken.basketToken(0)
      expect(result.tokenAddress).to.equal(bskToken.address)
    })

    it('Should validate slippage tolerance', async function () {
      // Set invalid value in one of the tokens
      newTokens[0].slippageTolerance = BN_SCALE_FACTOR.add(1).toString()
      // Update basket
      await expect(rToken.connect(owner).updateBasket(newTokens)).to.be.revertedWith('SlippageToleranceTooBig()')

      // Check basket was not updated
      expect(await rToken.basketSize()).to.equal(basketTokens.length)
      const result = await rToken.basketToken(0)
      expect(result.tokenAddress).to.equal(bskToken.address)
      expect(result.genesisQuantity).to.equal(bn(1e18))
    })

    it('Should validate correct initialization', async function () {
      // Set invalid value in rateLimit
      newTokens[1].rateLimit = 0

      // Update basket
      await expect(rToken.connect(owner).updateBasket(newTokens)).to.be.revertedWith('UninitializedTokens()')

      // Set invalid value in maxTrade
      newTokens[1].rateLimit = 1
      newTokens[1].maxTrade = 0

      // Update basket
      await expect(rToken.connect(owner).updateBasket(newTokens)).to.be.revertedWith('UninitializedTokens()')

      // Check basket was not updated
      expect(await rToken.basketSize()).to.equal(basketTokens.length)
      const result = await rToken.basketToken(0)
      expect(result.tokenAddress).to.equal(bskToken.address)
      expect(result.genesisQuantity).to.equal(bn(1e18))
    })

    it('Should set price in RToken for basket tokens and RSR if Owner', async function () {
      const newPrice = BigNumber.from(100)

      // Update price in RSR for Basket token
      let result = await rToken.basketToken(0)
      expect(result.priceInRToken).to.equal(0)

      await rToken.connect(owner).setBasketTokenPriceInRToken(0, newPrice)

      result = await rToken.basketToken(0)
      expect(result.priceInRToken).to.equal(newPrice)

      // Update price in RSR for RSR token
      result = await rToken.rsr()
      expect(result.priceInRToken).to.equal(0)

      await rToken.connect(owner).setRSRPriceInRToken(newPrice)

      result = await rToken.rsr()
      expect(result.priceInRToken).to.equal(newPrice)
    })

    it('Should not allow to set price in RToken for basket tokens and RSR if not owner Owner', async function () {
      const newPrice = BigNumber.from(100)

      // Update price in RSR for Basket token
      let result = await rToken.basketToken(0)
      expect(result.priceInRToken).to.equal(0)

      await expect(rToken.connect(addr1).setBasketTokenPriceInRToken(0, newPrice)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )

      result = await rToken.basketToken(0)
      expect(result.priceInRToken).to.equal(0)

      // Update price in RSR for RSR token
      result = await rToken.rsr()
      expect(result.priceInRToken).to.equal(0)

      await expect(rToken.connect(addr1).setRSRPriceInRToken(newPrice)).to.be.revertedWith(
        'Ownable: caller is not the owner'
      )

      result = await rToken.rsr()
      expect(result.priceInRToken).to.equal(0)
    })
  })

  describe('Slow Minting', function () {
    it('Should start minting', async function () {
      let amount = BigNumber.from(1000)
      await expect(rToken.startMinting(owner.address, amount))
        .to.emit(rToken, 'SlowMintingInitiated')
        .withArgs(owner.address, amount)
    })

    it('Should process Mintings in one attempt for amounts smaller than issuance rate', async function () {
      let amount = BigNumber.from(1000)
      await expect(rToken.startMinting(owner.address, amount))
        .to.emit(rToken, 'SlowMintingInitiated')
        .withArgs(owner.address, amount)

      // No Tokens minted yet
      expect(await rToken.balanceOf(owner.address)).to.equal(0)
      expect(await rToken.totalSupply()).to.equal(0)

      // Process Mintings
      await rToken.tryProcessMintings()

      // Check Tokens were minted
      expect(await rToken.balanceOf(owner.address)).to.equal(amount)
      expect(await rToken.totalSupply()).to.equal(amount)

      // Minting again has no impact as queue is empty
      await rToken.tryProcessMintings()

      // Check Tokens were minted
      expect(await rToken.balanceOf(owner.address)).to.equal(amount)
      expect(await rToken.totalSupply()).to.equal(amount)
    })

    it('Should process Mintings in multiple attempts (2 blocks)', async function () {
      let amount = BigNumber.from(50000)
      let issuanceRate = await rToken.issuanceRate()
      let blocks = divCeil(amount, issuanceRate)

      await expect(rToken.startMinting(owner.address, amount))
        .to.emit(rToken, 'SlowMintingInitiated')
        .withArgs(owner.address, amount)

      // Get block number when minting started
      const mintingBlock = (await ethers.provider.getBlock('latest')).number

      // No Tokens minted yet
      expect(await rToken.balanceOf(owner.address)).to.equal(0)
      expect(await rToken.totalSupply()).to.equal(0)

      // Process Mintings
      await rToken.tryProcessMintings()

      //  Tokens not minted until two blocks have passed
      expect(await rToken.balanceOf(owner.address)).to.equal(0)
      expect(await rToken.totalSupply()).to.equal(0)

      // Process Mintings
      await rToken.tryProcessMintings()

      // Tokens minted in the expected number of blocks
      expect(await rToken.balanceOf(owner.address)).to.equal(amount)
      expect(await rToken.totalSupply()).to.equal(amount)
      const currentBlock = (await ethers.provider.getBlock('latest')).number
      expect(currentBlock).to.equal(bn(mintingBlock).add(blocks))
    })

    it('Should process Mintings in multiple attempts (3 blocks)', async function () {
      let amount = BigNumber.from(74000)
      let issuanceRate = await rToken.issuanceRate()
      let blocks = divCeil(amount, issuanceRate)

      await expect(rToken.startMinting(owner.address, amount))
        .to.emit(rToken, 'SlowMintingInitiated')
        .withArgs(owner.address, amount)

      // Get block number when minting started
      const mintingBlock = (await ethers.provider.getBlock('latest')).number

      // No Tokens minted yet
      expect(await rToken.balanceOf(owner.address)).to.equal(0)
      expect(await rToken.totalSupply()).to.equal(0)

      // Process Mintings
      await rToken.tryProcessMintings()

      // Tokens not minted until three blocks have passed
      expect(await rToken.balanceOf(owner.address)).to.equal(0)
      expect(await rToken.totalSupply()).to.equal(0)

      // Process Mintings
      await rToken.tryProcessMintings()

      // Tokens not minted until three blocks have passed
      expect(await rToken.balanceOf(owner.address)).to.equal(0)
      expect(await rToken.totalSupply()).to.equal(0)

      // Process Mintings
      await rToken.tryProcessMintings()

      // Tokens minted in the expected number of blocks
      expect(await rToken.balanceOf(owner.address)).to.equal(amount)
      expect(await rToken.totalSupply()).to.equal(amount)
      const currentBlock = (await ethers.provider.getBlock('latest')).number
      expect(currentBlock).to.equal(bn(mintingBlock).add(blocks))
    })

    it('Should process multiple Mintings in queue in single issuance', async function () {
      let amount1 = BigNumber.from(2000)
      let amount2 = BigNumber.from(3000)
      let amount3 = BigNumber.from(5000)
      let amount4 = BigNumber.from(6000)

      await expect(rToken.startMinting(owner.address, amount1))
        .to.emit(rToken, 'SlowMintingInitiated')
        .withArgs(owner.address, amount1)

      await expect(rToken.startMinting(owner.address, amount2))
        .to.emit(rToken, 'SlowMintingInitiated')
        .withArgs(owner.address, amount2)

      await expect(rToken.startMinting(owner.address, amount3))
        .to.emit(rToken, 'SlowMintingInitiated')
        .withArgs(owner.address, amount3)

      await expect(rToken.startMinting(owner.address, amount4))
        .to.emit(rToken, 'SlowMintingInitiated')
        .withArgs(owner.address, amount4)

      // No Tokens minted yet
      expect(await rToken.balanceOf(owner.address)).to.equal(0)
      expect(await rToken.totalSupply()).to.equal(0)

      // Process Mintings
      await rToken.tryProcessMintings()

      //  Tokens minted in single issuance
      expect(await rToken.balanceOf(owner.address)).to.equal(amount1.add(amount2).add(amount3).add(amount4))
      expect(await rToken.totalSupply()).to.equal(amount1.add(amount2).add(amount3).add(amount4))
    })

    it('Should process multiple Mintings in queue until exceeding rate', async function () {
      let amount1 = BigNumber.from(10000)
      let amount2 = BigNumber.from(15000)
      let amount3 = BigNumber.from(20000)

      await expect(rToken.startMinting(owner.address, amount1))
        .to.emit(rToken, 'SlowMintingInitiated')
        .withArgs(owner.address, amount1)

      await expect(rToken.startMinting(owner.address, amount2))
        .to.emit(rToken, 'SlowMintingInitiated')
        .withArgs(owner.address, amount2)

      await expect(rToken.startMinting(owner.address, amount3))
        .to.emit(rToken, 'SlowMintingInitiated')
        .withArgs(owner.address, amount3)

      // No Tokens minted yet
      expect(await rToken.balanceOf(owner.address)).to.equal(0)
      expect(await rToken.totalSupply()).to.equal(0)

      // Process Mintings
      await rToken.tryProcessMintings()

      //  Tokens minted in single issuance
      expect(await rToken.balanceOf(owner.address)).to.equal(amount1.add(amount2))
      expect(await rToken.totalSupply()).to.equal(amount1.add(amount2))
    })

    it('Should process multiple Mintings in multiple issuances', async function () {
      let amount1 = BigNumber.from(60000)
      let amount2 = BigNumber.from(20000)

      await expect(rToken.startMinting(owner.address, amount1))
        .to.emit(rToken, 'SlowMintingInitiated')
        .withArgs(owner.address, amount1)

      await expect(rToken.startMinting(owner.address, amount2))
        .to.emit(rToken, 'SlowMintingInitiated')
        .withArgs(owner.address, amount2)

      // No Tokens minted yet
      expect(await rToken.balanceOf(owner.address)).to.equal(0)
      expect(await rToken.totalSupply()).to.equal(0)

      // Process Mintings
      await rToken.tryProcessMintings()

      //  No tokens minted yet
      expect(await rToken.balanceOf(owner.address)).to.equal(0)
      expect(await rToken.totalSupply()).to.equal(0)

      // Process Mintings
      await rToken.tryProcessMintings()

      //  Tokens minted for first mint
      expect(await rToken.balanceOf(owner.address)).to.equal(amount1)
      expect(await rToken.totalSupply()).to.equal(amount1)

      // Process Mintings
      await rToken.tryProcessMintings()

      //  Tokens minted for second mint
      expect(await rToken.balanceOf(owner.address)).to.equal(amount1.add(amount2))
      expect(await rToken.totalSupply()).to.equal(amount1.add(amount2))
    })

    it('Should process Mintings and count all mined blocks in between', async function () {
      let amount = BigNumber.from(80000)

      // Mine block
      await advanceTime(60)

      await expect(rToken.startMinting(owner.address, amount))
        .to.emit(rToken, 'SlowMintingInitiated')
        .withArgs(owner.address, amount)

      // Mine block
      await advanceTime(60)

      // Mine another block
      await advanceTime(60)

      // Mine a third  block
      await advanceTime(60)

      // Process Mintings - Now its the 4th block - Should mint
      await rToken.tryProcessMintings()

      // Mine block
      advanceTime(60)

      //  Tokens minted for first mint
      expect(await rToken.balanceOf(owner.address)).to.equal(amount)
      expect(await rToken.totalSupply()).to.equal(amount)
    })

    it('Should not process Mintings if it exceeds max allowed supply', async function () {
      let amount = maxSupply
      let extraAmount = bn(100)

      await expect(rToken.startMinting(owner.address, amount))
        .to.emit(rToken, 'SlowMintingInitiated')
        .withArgs(owner.address, amount)

      // Should mine a few blocks to process the large amount
      await advanceTime(60)
      await advanceTime(60)
      await advanceTime(60)
      await advanceTime(60)

      // Process Mintings
      await rToken.tryProcessMintings()

      // Check Tokens were minted
      expect(await rToken.balanceOf(owner.address)).to.equal(amount)
      expect(await rToken.totalSupply()).to.equal(amount)

      // Attempt to mint additional amount
      await expect(rToken.startMinting(owner.address, extraAmount))
        .to.emit(rToken, 'SlowMintingInitiated')
        .withArgs(owner.address, extraAmount)

      // Process Mintings
      await expect(rToken.tryProcessMintings()).to.emit(rToken, 'MaxSupplyExceeded')

      // Check no additional Tokens were minted
      expect(await rToken.balanceOf(owner.address)).to.equal(amount)
      expect(await rToken.totalSupply()).to.equal(amount)
    })

    // TODO: Remove is this will not be enabled again
    // it("Should process Mintings on transfer", async function () {
    //     const amount = BigNumber.from(10000);
    //     const transferAmount = BigNumber.from(500);

    //     await expect(rToken.startMinting(owner.address, amount))
    //         .to.emit(rToken, 'SlowMintingInitiated')
    //         .withArgs(owner.address, amount);

    //     // No Tokens minted yet
    //     expect(await rToken.balanceOf(owner.address)).to.equal(0);
    //     expect(await rToken.totalSupply()).to.equal(0);

    //     // Perform transfer
    //     await rToken.connect(owner).transfer(addr1.address, transferAmount);

    //     //  Tokens minted
    //     expect(await rToken.balanceOf(owner.address)).to.equal(amount.sub(transferAmount));
    //     expect(await rToken.balanceOf(addr1.address)).to.equal(transferAmount);
    //     expect(await rToken.totalSupply()).to.equal(amount);
    // });

    // TODO: Remove is this will not be enabled again
    // it("Should process Mintings on transferFrom", async function () {
    //     const amount1 = BigNumber.from(10000);
    //     const amount2 = BigNumber.from(10000);
    //     const transferAmount = BigNumber.from(500);

    //     await expect(rToken.startMinting(owner.address, amount1))
    //         .to.emit(rToken, 'SlowMintingInitiated')
    //         .withArgs(owner.address, amount1);

    //     await expect(rToken.startMinting(owner.address, amount2))
    //         .to.emit(rToken, 'SlowMintingInitiated')
    //         .withArgs(owner.address, amount2);

    //     // No Tokens minted yet
    //     expect(await rToken.balanceOf(owner.address)).to.equal(0);
    //     expect(await rToken.totalSupply()).to.equal(0);

    //     // Set allowance and transfer
    //     await rToken.connect(owner).approve(addr1.address, transferAmount);
    //     await rToken.connect(addr1).transferFrom(owner.address, addr2.address, transferAmount);

    //     //  Tokens minted
    //     expect(await rToken.balanceOf(owner.address)).to.equal(amount1.add(amount2).sub(transferAmount));
    //     expect(await rToken.balanceOf(addr2.address)).to.equal(transferAmount);
    //     expect(await rToken.totalSupply()).to.equal(amount1.add(amount2));
    // });

    // TODO: Reimplement once RelayERC20 is integrated with RToken
    // it("Should process Mintings on relayedTransfer", async function () {
    //     const amount = BigNumber.from(10000);
    //     const transferAmount = BigNumber.from(500);

    //     await expect(rToken.startMinting(owner.address, amount))
    //         .to.emit(rToken, 'SlowMintingInitiated')
    //         .withArgs(owner.address, amount);;

    //     // No Tokens minted yet
    //     expect(await rToken.balanceOf(owner.address)).to.equal(0);
    //     expect(await rToken.totalSupply()).to.equal(0);

    //     // Perform Relayed transfer
    //     // Transfer 50 tokens from owner to addr1, relayed by another account
    //     const nonce = await rToken.metaNonces(owner.address);
    //     const hash = ethers.utils.solidityKeccak256(
    //         ["string", "address", "address", "address", "uint256", "uint256", "uint256"],
    //         ["relayedTransfer", rToken.address, owner.address, addr1.address, transferAmount, 0, nonce]
    //     );
    //     const sigHashBytes = ethers.utils.arrayify(hash);
    //     const sig = await owner.signMessage(sigHashBytes)

    //     await expect(rToken.connect(addr2).relayedTransfer(sig, owner.address, addr1.address, transferAmount, 0))
    //         .to.emit(rToken, 'TransferForwarded')
    //         .withArgs(sig, owner.address, addr1.address, transferAmount, 0);

    //     //  Tokens minted
    //     expect(await rToken.balanceOf(owner.address)).to.equal(amount.sub(transferAmount));
    //     expect(await rToken.balanceOf(addr1.address)).to.equal(transferAmount);
    //     expect(await rToken.totalSupply()).to.equal(amount);
    // });
  })

  describe('Issuance', function () {
    it('Should not issue RTokens if circuit breaker is paused', async function () {
      const mintAmount = bn(100)

      // Pause circuit breaker
      await cb.connect(owner).pause()

      await expect(rToken.issue(mintAmount)).to.be.revertedWith('CircuitPaused()')

      expect(await rToken.totalSupply()).to.equal(bn(0))
    })

    it('Should not issue RTokens if amount is below minMintingSize', async function () {
      const mintAmount = bn(10)

      await expect(rToken.issue(mintAmount)).to.be.revertedWith('MintingAmountTooLow()')

      expect(await rToken.totalSupply()).to.equal(bn(0))
    })

    it('Should not issue RTokens if basket is empty', async function () {
      const mintAmount = bn(100)

      // Update to empty basket
      await expect(rToken.connect(owner).updateBasket(newTokens))
        .to.emit(rToken, 'BasketUpdated')
        .withArgs(basketTokens.length, newTokens.length)

      await expect(rToken.issue(mintAmount)).to.be.revertedWith('EmptyBasket()')

      expect(await rToken.totalSupply()).to.equal(bn(0))
    })

    it('Should revert if user did not provide approval for Token transfer', async function () {
      const mintAmount = bn(1000)
      await bskToken.mint(addr1.address, mintAmount)
      await expect(rToken.connect(addr1).issue(mintAmount)).to.be.revertedWith(
        'ERC20: transfer amount exceeds allowance'
      )

      expect(await rToken.totalSupply()).to.equal(bn(0))
    })

    it('Should revert if user does not have the required Tokens', async function () {
      const mintAmount = bn(1000)
      await expect(rToken.connect(addr1).issue(mintAmount)).to.be.revertedWith('ERC20: transfer amount exceeds balance')

      expect(await rToken.totalSupply()).to.equal(bn(0))
    })

    it('Should issue RTokens correctly', async function () {
      const mintAmount = bn(1000)
      await bskToken.mint(addr1.address, mintAmount)
      await bskToken.connect(addr1).approve(rToken.address, mintAmount)

      // Check no balance in contract
      expect(await bskToken.balanceOf(rToken.address)).to.equal(bn(0))
      expect(await bskToken.balanceOf(addr1.address)).to.equal(mintAmount)

      // Issue rTokens
      await expect(rToken.connect(addr1).issue(mintAmount))
        .to.emit(rToken, 'SlowMintingInitiated')
        .withArgs(addr1.address, mintAmount)

      // Check funds were transferred
      expect(await bskToken.balanceOf(rToken.address)).to.equal(mintAmount)
      expect(await bskToken.balanceOf(addr1.address)).to.equal(bn(0))

      expect(await rToken.totalSupply()).to.equal(0)

      // Process Mintings and check RTokens issued
      await rToken.tryProcessMintings()
      expect(await rToken.balanceOf(addr1.address)).to.equal(mintAmount)
      expect(await rToken.totalSupply()).to.equal(mintAmount)
    })

    it('Should issue RTokens correctly for multiple basket tokens and users', async function () {
      const mintAmount = bn(10000)
      const mintAmount_tkn2 = mintAmount.mul(2)
      const mintAmount_tkn3 = mintAmount.div(2)

      bskToken2 = <ERC20Mock>await ERC20.deploy('Basket Token 2', 'BSK2')
      await bskToken2.mint(addr1.address, mintAmount_tkn2)
      await bskToken2.mint(addr2.address, mintAmount_tkn2)
      await bskToken2.connect(addr1).approve(rToken.address, mintAmount_tkn2)
      await bskToken2.connect(addr2).approve(rToken.address, mintAmount_tkn2)

      bskToken3 = <ERC20Mock>await ERC20.deploy('Basket Token 2', 'BSK2')
      await bskToken3.mint(addr1.address, mintAmount_tkn3)
      await bskToken3.mint(addr2.address, mintAmount_tkn3)
      await bskToken3.connect(addr1).approve(rToken.address, mintAmount_tkn3)
      await bskToken3.connect(addr2).approve(rToken.address, mintAmount_tkn3)

      newTokens = [
        // We always need to keep previous tokens but set Qty to 0 to remove
        {
          tokenAddress: bskToken.address,
          genesisQuantity: 0,
          rateLimit: 1,
          maxTrade: 1,
          priceInRToken: 0,
          slippageTolerance: 0,
        },
        {
          tokenAddress: bskToken2.address,
          genesisQuantity: bn(2e18),
          rateLimit: 1,
          maxTrade: 1,
          priceInRToken: 0,
          slippageTolerance: 0,
        },
        {
          tokenAddress: bskToken3.address,
          genesisQuantity: bn(0.5e18),
          rateLimit: 1,
          maxTrade: 1,
          priceInRToken: 0,
          slippageTolerance: 0,
        },
      ]

      // Update basket
      await expect(rToken.connect(owner).updateBasket(newTokens))
        .to.emit(rToken, 'BasketUpdated')
        .withArgs(basketTokens.length, newTokens.length)

      // Check no balance in contract
      expect(await bskToken.balanceOf(rToken.address)).to.equal(bn(0))
      expect(await bskToken.balanceOf(addr1.address)).to.equal(bn(0))
      expect(await bskToken.balanceOf(addr2.address)).to.equal(bn(0))

      expect(await bskToken2.balanceOf(rToken.address)).to.equal(bn(0))
      expect(await bskToken2.balanceOf(addr1.address)).to.equal(mintAmount_tkn2)
      expect(await bskToken2.balanceOf(addr2.address)).to.equal(mintAmount_tkn2)

      expect(await bskToken3.balanceOf(rToken.address)).to.equal(bn(0))
      expect(await bskToken3.balanceOf(addr1.address)).to.equal(mintAmount_tkn3)
      expect(await bskToken3.balanceOf(addr2.address)).to.equal(mintAmount_tkn3)

      // Issue rTokens
      await expect(rToken.connect(addr1).issue(mintAmount))
        .to.emit(rToken, 'SlowMintingInitiated')
        .withArgs(addr1.address, mintAmount)

      await expect(rToken.connect(addr2).issue(mintAmount))
        .to.emit(rToken, 'SlowMintingInitiated')
        .withArgs(addr2.address, mintAmount)

      // Check funds were transferred
      expect(await bskToken.balanceOf(rToken.address)).to.equal(bn(0))
      expect(await bskToken.balanceOf(addr1.address)).to.equal(bn(0))
      expect(await bskToken.balanceOf(addr2.address)).to.equal(bn(0))

      expect(await bskToken2.balanceOf(rToken.address)).to.equal(mintAmount_tkn2.mul(2))
      expect(await bskToken2.balanceOf(addr1.address)).to.equal(bn(0))
      expect(await bskToken2.balanceOf(addr2.address)).to.equal(bn(0))

      expect(await bskToken3.balanceOf(rToken.address)).to.equal(mintAmount_tkn3.mul(2))
      expect(await bskToken3.balanceOf(addr1.address)).to.equal(bn(0))
      expect(await bskToken3.balanceOf(addr2.address)).to.equal(bn(0))

      // Process Mintings and check RTokens issued
      await rToken.tryProcessMintings()
      expect(await rToken.balanceOf(addr1.address)).to.equal(mintAmount)
      expect(await rToken.balanceOf(addr2.address)).to.equal(mintAmount)
      expect(await rToken.totalSupply()).to.equal(mintAmount.mul(2))
    })

    it('Should not allow to exceed max supply on issuance', async function () {
      const mintAmount = maxSupply
      const extraAmount = bn(100)
      await bskToken.mint(addr1.address, mintAmount.add(extraAmount))
      await bskToken.connect(addr1).approve(rToken.address, mintAmount.add(extraAmount))

      // Issue rTokens
      await expect(rToken.connect(addr1).issue(mintAmount))
        .to.emit(rToken, 'SlowMintingInitiated')
        .withArgs(addr1.address, mintAmount)

      // Need to mine multiple blocks for slow minting to process large amount
      await advanceTime(60)
      await advanceTime(60)
      await advanceTime(60)
      await advanceTime(60)

      // Process Mintings
      await rToken.tryProcessMintings()

      // Ensure max supply was minted
      expect(await rToken.totalSupply()).to.equal(mintAmount)
      expect(await bskToken.balanceOf(rToken.address)).to.equal(mintAmount)
      expect(await bskToken.balanceOf(addr1.address)).to.equal(extraAmount)

      // Try to issue more RTokens
      await expect(rToken.connect(addr1).issue(extraAmount))
        .to.emit(rToken, 'SlowMintingInitiated')
        .withArgs(addr1.address, extraAmount)

      // Process Mintings
      await expect(rToken.tryProcessMintings()).to.emit(rToken, 'MaxSupplyExceeded')

      expect(await rToken.totalSupply()).to.equal(mintAmount)
      // Funds in basket token were already received by contract
      expect(await bskToken.balanceOf(rToken.address)).to.equal(mintAmount.add(extraAmount))
      expect(await bskToken.balanceOf(addr1.address)).to.equal(0)

      // Attempt to process again
      await expect(rToken.tryProcessMintings()).to.emit(rToken, 'MaxSupplyExceeded')

      expect(await rToken.totalSupply()).to.equal(mintAmount)

      // Increase max and process again
      const newConfig = config
      newConfig.maxSupply = maxSupply.add(extraAmount)
      await expect(rToken.connect(owner).updateConfig(newConfig)).to.emit(rToken, 'ConfigUpdated')

      // Process again - Should process minting
      await rToken.tryProcessMintings()

      expect(await rToken.totalSupply()).to.equal(mintAmount.add(extraAmount))
      // Funds in basket token were already received by contract
      expect(await bskToken.balanceOf(rToken.address)).to.equal(mintAmount.add(extraAmount))
      expect(await bskToken.balanceOf(addr1.address)).to.equal(0)
    })
  })

  describe('Redeem', function () {
    it('Should revert if there is no supply of RToken', async function () {
      const redeemAmount = BigNumber.from(1000)

      await expect(rToken.connect(addr1).redeem(redeemAmount)).to.be.revertedWith('ERC20: burn amount exceeds balance')
    })

    context('With issued RTokens', async function () {
      let mintAmount: BigNumber

      beforeEach(async function () {
        // Issue some RTokens to user
        mintAmount = bn(5000)
        await bskToken.mint(addr1.address, mintAmount)
        await bskToken.connect(addr1).approve(rToken.address, mintAmount)

        await expect(rToken.connect(addr1).issue(mintAmount))
          .to.emit(rToken, 'SlowMintingInitiated')
          .withArgs(addr1.address, mintAmount)

        // Process Minting
        await rToken.tryProcessMintings()
        expect(await rToken.balanceOf(addr1.address)).to.equal(mintAmount)
        expect(await rToken.totalSupply()).to.equal(mintAmount)
      })

      it('Should not redeem RTokens if amount is 0', async function () {
        const redeemAmount = bn(0)

        await expect(rToken.redeem(redeemAmount)).to.be.revertedWith('RedeemAmountCannotBeZero()')
      })

      it('Should not redeem RTokens if basket is empty', async function () {
        const redeemAmount = bn(100)
        const newTokens: IBasketToken[] = []

        // Update to empty basket
        await expect(rToken.connect(owner).updateBasket(newTokens))
          .to.emit(rToken, 'BasketUpdated')
          .withArgs(basketTokens.length, newTokens.length)

        await expect(rToken.redeem(redeemAmount)).to.be.revertedWith('EmptyBasket()')
      })

      it('Should revert if users does not have enough RTokens', async function () {
        const redeemAmount = bn(10000)

        await expect(rToken.connect(addr1).issue(redeemAmount)).to.be.revertedWith(
          'ERC20: transfer amount exceeds balance'
        )
      })

      it('Should redeem RTokens correctly', async function () {
        const redeemAmount = bn(500)

        // Check balances
        expect(await rToken.balanceOf(addr1.address)).to.equal(mintAmount)
        expect(await bskToken.balanceOf(rToken.address)).to.equal(mintAmount)
        expect(await bskToken.balanceOf(addr1.address)).to.equal(bn(0))

        // Redeem rTokens
        await expect(rToken.connect(addr1).redeem(redeemAmount))
          .to.emit(rToken, 'Redemption')
          .withArgs(addr1.address, redeemAmount)

        // Check funds were transferred
        expect(await rToken.balanceOf(addr1.address)).to.equal(mintAmount.sub(redeemAmount))
        expect(await rToken.totalSupply()).to.equal(mintAmount.sub(redeemAmount))
        expect(await bskToken.balanceOf(rToken.address)).to.equal(mintAmount.sub(redeemAmount))
        expect(await bskToken.balanceOf(addr1.address)).to.equal(redeemAmount)
      })
    })

    it('Should redeem RTokens correctly for multiple basket tokens and users', async function () {
      const mintAmount = bn(10000)
      const mintAmount_tkn2 = mintAmount.mul(2)
      const mintAmount_tkn3 = mintAmount.div(2)

      const redeemAmount = bn(2000)
      const redeemAmount_tkn2 = redeemAmount.mul(2)
      const redeemAmount_tkn3 = redeemAmount.div(2)

      bskToken2 = <ERC20Mock>await ERC20.deploy('Basket Token 2', 'BSK2')
      await bskToken2.mint(addr1.address, mintAmount_tkn2)
      await bskToken2.mint(addr2.address, mintAmount_tkn2)
      await bskToken2.connect(addr1).approve(rToken.address, mintAmount_tkn2)
      await bskToken2.connect(addr2).approve(rToken.address, mintAmount_tkn2)

      bskToken3 = <ERC20Mock>await ERC20.deploy('Basket Token 2', 'BSK2')
      await bskToken3.mint(addr1.address, mintAmount_tkn3)
      await bskToken3.mint(addr2.address, mintAmount_tkn3)
      await bskToken3.connect(addr1).approve(rToken.address, mintAmount_tkn3)
      await bskToken3.connect(addr2).approve(rToken.address, mintAmount_tkn3)

      newTokens = [
        // We always need to keep previous tokens but set Qty to 0 to remove
        {
          tokenAddress: bskToken.address,
          genesisQuantity: 0,
          rateLimit: 1,
          maxTrade: 1,
          priceInRToken: 0,
          slippageTolerance: 0,
        },
        {
          tokenAddress: bskToken2.address,
          genesisQuantity: bn(2e18),
          rateLimit: 1,
          maxTrade: 1,
          priceInRToken: 0,
          slippageTolerance: 0,
        },
        {
          tokenAddress: bskToken3.address,
          genesisQuantity: bn(0.5e18),
          rateLimit: 1,
          maxTrade: 1,
          priceInRToken: 0,
          slippageTolerance: 0,
        },
      ]

      // Update basket
      await expect(rToken.connect(owner).updateBasket(newTokens))
        .to.emit(rToken, 'BasketUpdated')
        .withArgs(basketTokens.length, newTokens.length)

      // Issue rTokens
      await expect(rToken.connect(addr1).issue(mintAmount))
        .to.emit(rToken, 'SlowMintingInitiated')
        .withArgs(addr1.address, mintAmount)

      await expect(rToken.connect(addr2).issue(mintAmount))
        .to.emit(rToken, 'SlowMintingInitiated')
        .withArgs(addr2.address, mintAmount)

      // Process Mintings and check RTokens issued
      await rToken.tryProcessMintings()

      expect(await rToken.balanceOf(addr1.address)).to.equal(mintAmount)
      expect(await rToken.balanceOf(addr2.address)).to.equal(mintAmount)
      expect(await rToken.totalSupply()).to.equal(mintAmount.mul(2))

      expect(await bskToken2.balanceOf(rToken.address)).to.equal(mintAmount_tkn2.mul(2))
      expect(await bskToken2.balanceOf(addr1.address)).to.equal(bn(0))
      expect(await bskToken2.balanceOf(addr2.address)).to.equal(bn(0))

      expect(await bskToken3.balanceOf(rToken.address)).to.equal(mintAmount_tkn3.mul(2))
      expect(await bskToken3.balanceOf(addr1.address)).to.equal(bn(0))
      expect(await bskToken3.balanceOf(addr2.address)).to.equal(bn(0))

      // Redeem RTokens
      await expect(rToken.connect(addr1).redeem(redeemAmount))
        .to.emit(rToken, 'Redemption')
        .withArgs(addr1.address, redeemAmount)

      await expect(rToken.connect(addr2).redeem(redeemAmount))
        .to.emit(rToken, 'Redemption')
        .withArgs(addr2.address, redeemAmount)

      expect(await rToken.balanceOf(addr1.address)).to.equal(mintAmount.sub(redeemAmount))
      expect(await rToken.balanceOf(addr2.address)).to.equal(mintAmount.sub(redeemAmount))
      expect(await rToken.totalSupply()).to.equal(mintAmount.mul(2).sub(redeemAmount.mul(2)))

      expect(await bskToken2.balanceOf(rToken.address)).to.equal(mintAmount_tkn2.mul(2).sub(redeemAmount_tkn2.mul(2)))
      expect(await bskToken2.balanceOf(addr1.address)).to.equal(redeemAmount_tkn2)
      expect(await bskToken2.balanceOf(addr2.address)).to.equal(redeemAmount_tkn2)

      expect(await bskToken3.balanceOf(rToken.address)).to.equal(mintAmount_tkn3.mul(2).sub(redeemAmount_tkn3.mul(2)))
      expect(await bskToken3.balanceOf(addr1.address)).to.equal(redeemAmount_tkn3)
      expect(await bskToken3.balanceOf(addr2.address)).to.equal(redeemAmount_tkn3)
    })
  })

  describe('Rebalancing', function () {
    it('Should allow rebalancing by default', async function () {
      expect(await rToken.rebalancingFrozen()).to.equal(false)
      expect(await rToken.freezer()).to.equal(ZERO_ADDRESS)
    })

    it('Should not allow to freeze rebalancing if not enough RSR', async function () {
      // Increase required amount
      const newConfig = config
      newConfig.rebalancingFreezeCost = bn(2000000)
      await expect(rToken.connect(owner).updateConfig(newConfig)).to.emit(rToken, 'ConfigUpdated')

      // Attempt to freeze rebalancing
      await expect(rToken.connect(addr1).freezeRebalancing()).to.be.revertedWith(
        'ERC20: transfer amount exceeds balance'
      )

      expect(await rToken.rebalancingFrozen()).to.equal(false)
      expect(await rToken.freezer()).to.equal(ZERO_ADDRESS)
    })

    it('Should not allow to freeze rebalancing if RSR not approved to transfer', async function () {
      // Attempt to freeze rebalancing without approval
      await expect(rToken.connect(addr1).freezeRebalancing()).to.be.revertedWith(
        'ERC20: transfer amount exceeds allowance'
      )

      expect(await rToken.rebalancingFrozen()).to.equal(false)
      expect(await rToken.freezer()).to.equal(ZERO_ADDRESS)
    })

    it('Should allow to freeze rebalancing', async function () {
      const freezeCost = config.rebalancingFreezeCost
      const prevRSRBalanceAddr1 = await rsrToken.balanceOf(addr1.address)
      const prevRSRBalanceRToken = await rsrToken.balanceOf(rToken.address)

      // Approve transfer
      await rsrToken.connect(addr1).approve(rToken.address, freezeCost)

      // Freeze rebalancing
      await expect(rToken.connect(addr1).freezeRebalancing())
        .to.emit(rToken, 'RebalancingFrozen')
        .withArgs(addr1.address)

      // Check rebalancing is frozen
      expect(await rToken.rebalancingFrozen()).to.equal(true)
      expect(await rToken.freezer()).to.equal(addr1.address)
      expect(await rsrToken.balanceOf(addr1.address)).to.equal(prevRSRBalanceAddr1.sub(freezeCost))
      expect(await rsrToken.balanceOf(rToken.address)).to.equal(prevRSRBalanceRToken.add(freezeCost))
    })

    it('Should not allow to unfreeze if not frozen', async function () {
      // Attempt to unfreeze rebalancing
      expect(await rToken.rebalancingFrozen()).to.equal(false)

      await expect(rToken.connect(addr1).unfreezeRebalancing()).to.be.revertedWith('RebalancingAlreadyUnfrozen()')

      expect(await rToken.rebalancingFrozen()).to.equal(false)
    })

    context('With frozen rebalancing', async function () {
      let freezeCost: BigNumberish

      beforeEach(async function () {
        // Freeze rebalancing
        freezeCost = config.rebalancingFreezeCost
        await rsrToken.connect(addr1).approve(rToken.address, freezeCost)

        await expect(rToken.connect(addr1).freezeRebalancing())
          .to.emit(rToken, 'RebalancingFrozen')
          .withArgs(addr1.address)

        expect(await rToken.rebalancingFrozen()).to.equal(true)
        expect(await rToken.freezer()).to.equal(addr1.address)
      })

      it('Should not allow to unfreeze rebalancing if not freezer', async function () {
        // Attempt to unfreeze with different user
        await expect(rToken.connect(addr2).unfreezeRebalancing()).to.be.revertedWith('Unauthorized()')

        expect(await rToken.rebalancingFrozen()).to.equal(true)
        expect(await rToken.freezer()).to.equal(addr1.address)
      })

      it('Should allow freezer to unfreeze rebalancing', async function () {
        const prevRSRBalanceAddr1 = await rsrToken.balanceOf(addr1.address)
        const prevRSRBalanceRToken = await rsrToken.balanceOf(rToken.address)

        // Unfreeze rebalancing
        await expect(rToken.connect(addr1).unfreezeRebalancing())
          .to.emit(rToken, 'RebalancingUnfrozen')
          .withArgs(addr1.address)

        expect(await rToken.rebalancingFrozen()).to.equal(false)
        expect(await rToken.freezer()).to.equal(ZERO_ADDRESS)
        expect(await rsrToken.balanceOf(addr1.address)).to.equal(prevRSRBalanceAddr1.add(freezeCost))
        expect(await rsrToken.balanceOf(rToken.address)).to.equal(prevRSRBalanceRToken.sub(freezeCost))
      })

      it('Should allow to freeze rebalancing even if already frozen', async function () {
        const prevRSRBalanceAddr1 = await rsrToken.balanceOf(addr1.address)
        const prevRSRBalanceAddr2 = await rsrToken.balanceOf(addr2.address)
        const prevRSRBalanceRToken = await rsrToken.balanceOf(rToken.address)

        // New Freezer (addr2)
        await rsrToken.connect(addr2).approve(rToken.address, freezeCost)

        await expect(rToken.connect(addr2).freezeRebalancing())
          .to.emit(rToken, 'RebalancingFrozen')
          .withArgs(addr2.address)

        // Check new freezer was assigned
        expect(await rToken.rebalancingFrozen()).to.equal(true)
        expect(await rToken.freezer()).to.equal(addr2.address)
        expect(await rsrToken.balanceOf(addr2.address)).to.equal(prevRSRBalanceAddr2.sub(freezeCost))
        expect(await rsrToken.balanceOf(rToken.address)).to.equal(prevRSRBalanceRToken)

        // Funds returned to previous freezer
        expect(await rsrToken.balanceOf(addr1.address)).to.equal(prevRSRBalanceAddr1.add(freezeCost))
      })
    })
  })

  describe('Tx Fees', function () {
    let txFeeCalc: TXFeeCalculatorMock
    let newTxFeeConfig: IRTokenParams

    beforeEach(async function () {
      // Mint initial tokens
      await rToken.mint(owner.address, BigNumber.from(1000))

      // Deploy TxFeeCalculator
      const TxFeeCalculator = await ethers.getContractFactory('TXFeeCalculatorMock')
      txFeeCalc = <TXFeeCalculatorMock>await TxFeeCalculator.deploy()
      newTxFeeConfig = config
      newTxFeeConfig.txFeeCalculator = txFeeCalc.address
    })

    it('Should not apply fees by default', async function () {
      // Transfer 50 tokens from owner to addr1
      const amount = BigNumber.from(50)

      expect(await rToken.balanceOf(rToken.address)).to.equal(0)
      expect(await rToken.balanceOf(addr1.address)).to.equal(0)

      // Perform transfer
      await rToken.connect(owner).transfer(addr1.address, amount)

      // No fee taken, correct amount received
      expect(await rToken.balanceOf(addr1.address)).to.equal(amount)
      expect(await rToken.balanceOf(rToken.address)).to.equal(0)
    })

    it('Should apply fees if TxFee calculator is defined', async function () {
      // Transfer 50 tokens from owner to addr1
      const amount = BigNumber.from(50)
      const fee = amount.mul(10).div(100)

      // Setup TxFee Calculator
      await rToken.connect(owner).updateConfig(newTxFeeConfig)

      expect(await rToken.balanceOf(rToken.address)).to.equal(0)
      expect(await rToken.balanceOf(addr1.address)).to.equal(0)

      // Perform transfer
      await rToken.connect(owner).transfer(addr1.address, amount)

      // Should take a 10% fee, correct amount received
      expect(await rToken.balanceOf(addr1.address)).to.equal(amount)
      expect(await rToken.balanceOf(rToken.address)).to.equal(fee)
    })

    it('Should cap TxFee to the total amount (max)', async function () {
      // Transfer 50 tokens from owner to addr1
      const amount = BigNumber.from(50)

      // Set new percentage to 200%
      await txFeeCalc.setFeePct(200)
      await rToken.connect(owner).updateConfig(newTxFeeConfig)

      expect(await rToken.balanceOf(rToken.address)).to.equal(0)

      // Perform transfer
      await rToken.connect(owner).transfer(addr1.address, amount)

      // Should take a 10% fee, correct amount received
      expect(await rToken.balanceOf(addr1.address)).to.equal(amount)
      expect(await rToken.balanceOf(rToken.address)).to.equal(amount)
    })

    it('Should not allow transfer if user cannot pay fee', async function () {
      // Transfer all balance from owner to addr1
      const amount = BigNumber.from(1000)

      // Setup TxFee Calculator
      await rToken.connect(owner).updateConfig(newTxFeeConfig)

      expect(await rToken.balanceOf(rToken.address)).to.equal(0)
      expect(await rToken.balanceOf(addr1.address)).to.equal(0)

      await expect(rToken.connect(owner).transfer(addr1.address, amount)).to.be.revertedWith(
        'ERC20: transfer amount exceeds balance'
      )

      // No transfer was processed
      expect(await rToken.balanceOf(addr1.address)).to.equal(0)
      expect(await rToken.balanceOf(rToken.address)).to.equal(0)
    })
  })

  describe('ERC20 functionality', function () {
    beforeEach(async function () {
      // Mint initial tokens
      await rToken.mint(owner.address, bn(1000))
    })

    it('Should transfer tokens between accounts', async function () {
      // Transfer 50 tokens from owner to addr1
      const amount = bn(50)
      const ownerBalancePrev = await rToken.balanceOf(owner.address)
      const addr1BalancePrev = await rToken.balanceOf(addr1.address)
      const previousSupply = await rToken.totalSupply()

      // Perform transfer
      await rToken.connect(owner).transfer(addr1.address, amount)

      expect(await rToken.balanceOf(addr1.address)).to.equal(addr1BalancePrev.add(amount))
      expect(await rToken.balanceOf(owner.address)).to.equal(ownerBalancePrev.sub(amount))

      // Check supply not impacted
      expect(await rToken.totalSupply()).to.equal(previousSupply)
    })

    it('Should not be able to transfer to contract externally', async function () {
      // Transfer 50 tokens from owner to addr1
      const amount = bn(50)
      const ownerBalancePrev = await rToken.balanceOf(owner.address)
      const rTokenBalancePrev = await rToken.balanceOf(rToken.address)
      const previousSupply = await rToken.totalSupply()

      await expect(rToken.connect(owner).transfer(rToken.address, amount)).to.be.revertedWith(
        'TransferToContractAddress()'
      )

      expect(await rToken.balanceOf(rToken.address)).to.equal(rTokenBalancePrev)
      expect(await rToken.balanceOf(owner.address)).to.equal(ownerBalancePrev)

      // Check supply not impacted
      expect(await rToken.totalSupply()).to.equal(previousSupply)
    })

    it('Should transferFrom tokens between accounts', async function () {
      // Transfer 50 tokens from owner to addr1
      const amount = bn(500)
      const ownerBalancePrev = await rToken.balanceOf(owner.address)
      const addr2BalancePrev = await rToken.balanceOf(addr2.address)
      const previousSupply = await rToken.totalSupply()

      // Set allowance and transfer
      await rToken.connect(owner).approve(addr1.address, amount)
      await rToken.connect(addr1).transferFrom(owner.address, addr2.address, amount)

      expect(await rToken.balanceOf(addr2.address)).to.equal(addr2BalancePrev.add(amount))
      expect(await rToken.balanceOf(owner.address)).to.equal(ownerBalancePrev.sub(amount))

      // Check supply not impacted
      expect(await rToken.totalSupply()).to.equal(previousSupply)
    })

    it('Should not be able to transferFrom to contract externally', async function () {
      // Transfer 50 tokens from owner to addr1
      const amount = bn(500)
      const ownerBalancePrev = await rToken.balanceOf(owner.address)
      const rTokenBalancePrev = await rToken.balanceOf(rToken.address)
      const previousSupply = await rToken.totalSupply()

      // Set allowance and transfer
      await rToken.connect(owner).approve(addr1.address, amount)
      await expect(rToken.connect(addr1).transferFrom(owner.address, rToken.address, amount)).to.be.revertedWith(
        'TransferToContractAddress()'
      )

      expect(await rToken.balanceOf(rToken.address)).to.equal(rTokenBalancePrev)
      expect(await rToken.balanceOf(owner.address)).to.equal(ownerBalancePrev)

      // Check supply not impacted
      expect(await rToken.totalSupply()).to.equal(previousSupply)
    })
  })
})
