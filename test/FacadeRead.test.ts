import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber } from 'ethers'
import { ethers } from 'hardhat'
import { bn, fp } from '../common/numbers'
import { setOraclePrice } from './utils/oracles'
import {
  Asset,
  CTokenMock,
  ERC20Mock,
  FacadeRead,
  FacadeTest,
  MockV3Aggregator,
  StaticATokenMock,
  StRSRP1,
  IBasketHandler,
  TestIMain,
  TestIStRSR,
  TestIRToken,
  USDCMock,
} from '../typechain'
import {
  Collateral,
  Implementation,
  IMPLEMENTATION,
  defaultFixture,
  ORACLE_ERROR,
} from './fixtures'
import { getLatestBlockTimestamp, setNextBlockTimestamp } from './utils/time'
import { CollateralStatus, MAX_UINT256 } from '#/common/constants'

describe('FacadeRead contract', () => {
  let owner: SignerWithAddress
  let addr1: SignerWithAddress
  let addr2: SignerWithAddress
  let other: SignerWithAddress

  // Tokens
  let initialBal: BigNumber
  let token: ERC20Mock
  let usdc: USDCMock
  let aToken: StaticATokenMock
  let cToken: CTokenMock
  let rsr: ERC20Mock
  let basket: Collateral[]

  // Assets
  let tokenAsset: Collateral
  let usdcAsset: Collateral
  let aTokenAsset: Collateral
  let cTokenAsset: Collateral

  // Facade
  let facade: FacadeRead
  let facadeTest: FacadeTest

  // Main
  let rToken: TestIRToken
  let main: TestIMain
  let stRSR: TestIStRSR
  let basketHandler: IBasketHandler

  // RSR
  let rsrAsset: Asset

  beforeEach(async () => {
    ;[owner, addr1, addr2, other] = await ethers.getSigners()

    // Deploy fixture
    ;({ stRSR, rsr, rsrAsset, basket, facade, facadeTest, rToken, main, basketHandler } =
      await loadFixture(defaultFixture))

    // Get assets and tokens
    ;[tokenAsset, usdcAsset, aTokenAsset, cTokenAsset] = basket

    token = <ERC20Mock>await ethers.getContractAt('ERC20Mock', await tokenAsset.erc20())
    usdc = <USDCMock>await ethers.getContractAt('USDCMock', await usdcAsset.erc20())
    aToken = <StaticATokenMock>(
      await ethers.getContractAt('StaticATokenMock', await aTokenAsset.erc20())
    )
    cToken = <CTokenMock>await ethers.getContractAt('CTokenMock', await cTokenAsset.erc20())
  })

  describe('Views', () => {
    let issueAmount: BigNumber

    const expectValidBasketBreakdown = async (rToken: TestIRToken) => {
      const [erc20s, breakdown, targets] = await facade.callStatic.basketBreakdown(rToken.address)
      expect(erc20s.length).to.equal(4)
      expect(breakdown.length).to.equal(4)
      expect(targets.length).to.equal(4)
      expect(erc20s[0]).to.equal(token.address)
      expect(erc20s[1]).to.equal(usdc.address)
      expect(erc20s[2]).to.equal(aToken.address)
      expect(erc20s[3]).to.equal(cToken.address)
      expect(breakdown[0]).to.be.closeTo(fp('0.25'), 10)
      expect(breakdown[1]).to.be.closeTo(fp('0.25'), 10)
      expect(breakdown[2]).to.be.closeTo(fp('0.25'), 10)
      expect(breakdown[3]).to.be.closeTo(fp('0.25'), 10)
      expect(targets[0]).to.equal(ethers.utils.formatBytes32String('USD'))
      expect(targets[1]).to.equal(ethers.utils.formatBytes32String('USD'))
      expect(targets[2]).to.equal(ethers.utils.formatBytes32String('USD'))
      expect(targets[3]).to.equal(ethers.utils.formatBytes32String('USD'))
    }

    beforeEach(async () => {
      // Mint Tokens
      initialBal = bn('10000000000e18')
      await token.connect(owner).mint(addr1.address, initialBal)
      await usdc.connect(owner).mint(addr1.address, initialBal)
      await aToken.connect(owner).mint(addr1.address, initialBal)
      await cToken.connect(owner).mint(addr1.address, initialBal)

      await token.connect(owner).mint(addr2.address, initialBal)
      await usdc.connect(owner).mint(addr2.address, initialBal)
      await aToken.connect(owner).mint(addr2.address, initialBal)
      await cToken.connect(owner).mint(addr2.address, initialBal)

      // Issue some RTokens
      issueAmount = bn('100e18')

      // Provide approvals
      await token.connect(addr1).approve(rToken.address, initialBal)
      await usdc.connect(addr1).approve(rToken.address, initialBal)
      await aToken.connect(addr1).approve(rToken.address, initialBal)
      await cToken.connect(addr1).approve(rToken.address, initialBal)

      // Issue rTokens
      await rToken.connect(addr1).issue(issueAmount)
    })

    it('should return the correct facade address', async () => {
      expect(await facade.stToken(rToken.address)).to.equal(stRSR.address)
    })

    it('Should return maxIssuable correctly', async () => {
      // Check values
      expect(await facade.callStatic.maxIssuable(rToken.address, addr1.address)).to.equal(
        bn('39999999900e18')
      )
      expect(await facade.callStatic.maxIssuable(rToken.address, addr2.address)).to.equal(
        bn('40000000000e18')
      )
      expect(await facade.callStatic.maxIssuable(rToken.address, other.address)).to.equal(0)

      // Redeem all RTokens
      await rToken.connect(addr1).redeem(issueAmount, await basketHandler.nonce())

      // With 0 baskets needed - Returns correct value
      expect(await facade.callStatic.maxIssuable(rToken.address, addr2.address)).to.equal(
        bn('40000000000e18')
      )
    })

    it('Should return issuable quantities correctly', async () => {
      const [toks, quantities, uoas] = await facade.callStatic.issue(rToken.address, issueAmount)
      expect(toks.length).to.equal(4)
      expect(toks[0]).to.equal(token.address)
      expect(toks[1]).to.equal(usdc.address)
      expect(toks[2]).to.equal(aToken.address)
      expect(toks[3]).to.equal(cToken.address)
      expect(quantities.length).to.equal(4)
      expect(quantities[0]).to.equal(issueAmount.div(4))
      expect(quantities[1]).to.equal(issueAmount.div(4).div(bn('1e12')))
      expect(quantities[2]).to.equal(issueAmount.div(4))
      expect(quantities[3]).to.equal(issueAmount.div(4).mul(50).div(bn('1e10')))
      expect(uoas.length).to.equal(4)
      expect(uoas[0]).to.equal(issueAmount.div(4))
      expect(uoas[1]).to.equal(issueAmount.div(4))
      expect(uoas[2]).to.equal(issueAmount.div(4))
      expect(uoas[3]).to.equal(issueAmount.div(4))
    })

    it('Should return redeemable quantities correctly', async () => {
      const nonce = await basketHandler.nonce()
      const [toks, quantities, isProrata] = await facade.callStatic.redeem(
        rToken.address,
        issueAmount,
        nonce
      )
      expect(toks.length).to.equal(4)
      expect(toks[0]).to.equal(token.address)
      expect(toks[1]).to.equal(usdc.address)
      expect(toks[2]).to.equal(aToken.address)
      expect(toks[3]).to.equal(cToken.address)
      expect(quantities[0]).to.equal(issueAmount.div(4))
      expect(quantities[1]).to.equal(issueAmount.div(4).div(bn('1e12')))
      expect(quantities[2]).to.equal(issueAmount.div(4))
      expect(quantities[3]).to.equal(issueAmount.div(4).mul(50).div(bn('1e10')))
      expect(isProrata).to.equal(false)

      // Prorata case -- burn half
      await token.burn(await main.backingManager(), issueAmount.div(8))
      const [newToks, newQuantities, newIsProrata] = await facade.callStatic.redeem(
        rToken.address,
        issueAmount,
        nonce
      )
      expect(newToks[0]).to.equal(token.address)
      expect(newQuantities[0]).to.equal(issueAmount.div(8))
      expect(newIsProrata).to.equal(true)

      // Wrong nonce
      await expect(
        facade.callStatic.redeem(rToken.address, issueAmount, nonce - 1)
      ).to.be.revertedWith('non-current basket nonce')
    })

    it('Should return backingOverview correctly', async () => {
      let [backing, overCollateralization] = await facade.callStatic.backingOverview(rToken.address)

      // Check values - Fully collateralized and no over-collateralization
      expect(backing).to.equal(fp('1'))
      expect(overCollateralization).to.equal(0)

      // Mint some RSR
      const stakeAmount = bn('50e18') // Half in value compared to issued RTokens
      await rsr.connect(owner).mint(addr1.address, stakeAmount.mul(2))

      // Stake some RSR
      await rsr.connect(addr1).approve(stRSR.address, stakeAmount)
      await stRSR.connect(addr1).stake(stakeAmount)
      ;[backing, overCollateralization] = await facade.callStatic.backingOverview(rToken.address)

      // Check values - Fully collateralized and fully over-collateralized
      expect(backing).to.equal(fp('1'))
      expect(overCollateralization).to.be.closeTo(fp('0.5'), 10)

      // Stake more RSR
      await rsr.connect(addr1).approve(stRSR.address, stakeAmount)
      await stRSR.connect(addr1).stake(stakeAmount)
      ;[backing, overCollateralization] = await facade.callStatic.backingOverview(rToken.address)

      expect(backing).to.equal(fp('1'))
      expect(overCollateralization).to.equal(fp('1'))

      // Redeem all RTokens
      await rToken.connect(addr1).redeem(issueAmount, await basketHandler.nonce())

      // Check values = 0 (no supply)
      ;[backing, overCollateralization] = await facade.callStatic.backingOverview(rToken.address)

      // Check values - No supply, returns 0
      expect(backing).to.equal(0)
      expect(overCollateralization).to.equal(0)
    })

    it('Should return backingOverview backing correctly when undercollateralized', async () => {
      const backingManager = await main.backingManager()
      await usdc.burn(backingManager, (await usdc.balanceOf(backingManager)).div(2))
      await basketHandler.refreshBasket()
      const [backing, overCollateralization] = await facade.callStatic.backingOverview(
        rToken.address
      )

      // Check values - Fully collateralized and no over-collateralization
      expect(backing).to.equal(fp('0.875'))
      expect(overCollateralization).to.equal(0)
    })

    it('Should return backingOverview backing correctly when an asset price is 0', async () => {
      await setOraclePrice(tokenAsset.address, bn(0))
      const [backing, overCollateralization] = await facade.callStatic.backingOverview(
        rToken.address
      )

      // Check values - Fully collateralized and no over-collateralization
      expect(backing).to.equal(fp('1'))
      expect(overCollateralization).to.equal(0)
    })

    it('Should return backingOverview backing correctly when basket collateral is UNPRICED', async () => {
      await setOraclePrice(tokenAsset.address, MAX_UINT256.div(2).sub(1))
      await basketHandler.refreshBasket()
      const [backing, overCollateralization] = await facade.callStatic.backingOverview(
        rToken.address
      )

      // Check values - Fully collateralized and no over-collateralization
      expect(backing).to.equal(fp('1')) // since price is unknown for uoaHeldInBaskets
      expect(overCollateralization).to.equal(0)
    })

    it('Should return backingOverview backing correctly when RSR is UNPRICED', async () => {
      await setOraclePrice(tokenAsset.address, MAX_UINT256.div(2).sub(1))
      await basketHandler.refreshBasket()
      const [backing, overCollateralization] = await facade.callStatic.backingOverview(
        rToken.address
      )

      // Check values - Fully collateralized and no over-collateralization
      expect(backing).to.equal(fp('1'))
      expect(overCollateralization).to.equal(0)
    })

    it('Should return backingOverview over-collateralization correctly when RSR price is 0', async () => {
      // Mint some RSR
      const stakeAmount = bn('50e18') // Half in value compared to issued RTokens
      await rsr.connect(owner).mint(addr1.address, stakeAmount.mul(2))

      // Stake some RSR
      await rsr.connect(addr1).approve(stRSR.address, stakeAmount)
      await stRSR.connect(addr1).stake(stakeAmount)

      const [backing, overCollateralization] = await facade.callStatic.backingOverview(
        rToken.address
      )

      // Check values - Fully collateralized and no over-collateralization
      expect(backing).to.equal(fp('1'))
      expect(overCollateralization).to.equal(fp('0.5'))

      // Set price to 0
      await setOraclePrice(rsrAsset.address, bn(0))

      const [backing2, overCollateralization2] = await facade.callStatic.backingOverview(
        rToken.address
      )

      // Check values - Fully collateralized and no over-collateralization
      expect(backing2).to.equal(fp('1'))
      expect(overCollateralization2).to.equal(0)
    })

    it('Should return backingOverview backing correctly when RSR is UNPRICED', async () => {
      // Mint some RSR
      const stakeAmount = bn('50e18') // Half in value compared to issued RTokens
      await rsr.connect(owner).mint(addr1.address, stakeAmount.mul(2))

      // Stake some RSR
      await rsr.connect(addr1).approve(stRSR.address, stakeAmount)
      await stRSR.connect(addr1).stake(stakeAmount)

      // Check values - Fully collateralized and with 50%-collateralization
      let [backing, overCollateralization] = await facade.callStatic.backingOverview(rToken.address)
      expect(backing).to.equal(fp('1'))
      expect(overCollateralization).to.equal(fp('0.5'))

      await setOraclePrice(rsrAsset.address, MAX_UINT256.div(2).sub(1))
      ;[backing, overCollateralization] = await facade.callStatic.backingOverview(rToken.address)

      // Check values - Fully collateralized and no over-collateralization
      expect(backing).to.equal(fp('1'))
      expect(overCollateralization).to.equal(0)
    })

    it('Should return traderBalances correctly', async () => {
      // BackingManager
      const backingManager = await ethers.getContractAt(
        'TestIBackingManager',
        await main.backingManager()
      )
      let [erc20s, balances, balancesNeeded] = await facade.traderBalances(
        rToken.address,
        backingManager.address
      )
      expect(erc20s.length).to.equal(8)
      expect(balances.length).to.equal(8)
      expect(balancesNeeded.length).to.equal(8)

      const backingBuffer = await backingManager.backingBuffer()
      for (let i = 0; i < 8; i++) {
        let bal = bn('0')
        if (erc20s[i] == token.address) bal = issueAmount.div(4)
        if (erc20s[i] == usdc.address) bal = issueAmount.div(4).div(bn('1e12'))
        if (erc20s[i] == aToken.address) bal = issueAmount.div(4)
        if (erc20s[i] == cToken.address) bal = issueAmount.div(4).mul(50).div(bn('1e10'))
        expect(balances[i]).to.equal(bal)

        const balNeeded = bal.add(bal.mul(backingBuffer).div(fp('1')))
        expect(balancesNeeded[i]).to.equal(balNeeded)
      }

      // RTokenTrader
      ;[erc20s, balances, balancesNeeded] = await facade.traderBalances(
        rToken.address,
        await main.rTokenTrader()
      )
      expect(erc20s.length).to.equal(8)
      expect(balances.length).to.equal(8)
      expect(balancesNeeded.length).to.equal(8)
      for (let i = 0; i < 8; i++) {
        expect(balances[i]).to.equal(0)
        expect(balancesNeeded[i]).to.equal(0)
      }

      // RSRTrader
      ;[erc20s, balances, balancesNeeded] = await facade.traderBalances(
        rToken.address,
        await main.rsrTrader()
      )
      expect(erc20s.length).to.equal(8)
      expect(balances.length).to.equal(8)
      expect(balancesNeeded.length).to.equal(8)
      for (let i = 0; i < 8; i++) {
        expect(balances[i]).to.equal(0)
        expect(balancesNeeded[i]).to.equal(0)
      }
    })

    it('Should return basketBreakdown correctly for paused token', async () => {
      await main.connect(owner).pause()
      await expectValidBasketBreakdown(rToken)
    })

    it('Should return basketBreakdown correctly when RToken supply = 0', async () => {
      // Redeem all RTokens
      await rToken.connect(addr1).redeem(issueAmount, await basketHandler.nonce())

      expect(await rToken.totalSupply()).to.equal(bn(0))

      await expectValidBasketBreakdown(rToken)
    })

    it('Should return basketBreakdown correctly for tokens with (0, FIX_MAX) price', async () => {
      const chainlinkFeed: MockV3Aggregator = <MockV3Aggregator>(
        await ethers.getContractAt('MockV3Aggregator', await tokenAsset.chainlinkFeed())
      )
      // set price of dai to 0
      await chainlinkFeed.updateAnswer(0)
      await main.connect(owner).pause()
      const [erc20s, breakdown, targets] = await facade.callStatic.basketBreakdown(rToken.address)
      expect(erc20s.length).to.equal(4)
      expect(breakdown.length).to.equal(4)
      expect(targets.length).to.equal(4)
      expect(erc20s[0]).to.equal(token.address)
      expect(erc20s[1]).to.equal(usdc.address)
      expect(erc20s[2]).to.equal(aToken.address)
      expect(erc20s[3]).to.equal(cToken.address)
      expect(breakdown[0]).to.equal(fp('0')) // dai
      expect(breakdown[1]).to.equal(fp('1')) // usdc
      expect(breakdown[2]).to.equal(fp('0')) // adai
      expect(breakdown[3]).to.equal(fp('0')) // cdai
      expect(targets[0]).to.equal(ethers.utils.formatBytes32String('USD'))
      expect(targets[1]).to.equal(ethers.utils.formatBytes32String('USD'))
      expect(targets[2]).to.equal(ethers.utils.formatBytes32String('USD'))
      expect(targets[3]).to.equal(ethers.utils.formatBytes32String('USD'))
    })

    it('Should return totalAssetValue correctly - FacadeTest', async () => {
      expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(issueAmount)
    })

    it('Should return RToken price correctly', async () => {
      const avgPrice = fp('1')
      const [lowPrice, highPrice] = await facade.price(rToken.address)
      const delta = avgPrice.mul(ORACLE_ERROR).div(fp('1'))
      const expectedLow = avgPrice.sub(delta)
      const expectedHigh = avgPrice.add(delta)
      expect(lowPrice).to.equal(expectedLow)
      expect(highPrice).to.equal(expectedHigh)
    })

    // P1 only
    if (IMPLEMENTATION == Implementation.P1) {
      let stRSRP1: StRSRP1

      beforeEach(async () => {
        stRSRP1 = await ethers.getContractAt('StRSRP1', stRSR.address)
      })

      it('Should return pending unstakings', async () => {
        const unstakeAmount = bn('10000e18')
        await rsr.connect(owner).mint(addr1.address, unstakeAmount.mul(10))

        // Stake
        await rsr.connect(addr1).approve(stRSR.address, unstakeAmount.mul(10))
        await stRSRP1.connect(addr1).stake(unstakeAmount.mul(10))
        await stRSRP1.connect(addr1).unstake(unstakeAmount)
        await stRSRP1.connect(addr1).unstake(unstakeAmount.add(1))

        const pendings = await facade.pendingUnstakings(rToken.address, addr1.address)
        expect(pendings.length).to.eql(2)
        expect(pendings[0][0]).to.eql(bn(0)) // index
        expect(pendings[0][2]).to.eql(unstakeAmount) // amount

        expect(pendings[1][0]).to.eql(bn(1)) // index
        expect(pendings[1][2]).to.eql(unstakeAmount.add(1)) // amount
      })

      it('Should return prime basket', async () => {
        const [erc20s, targetNames, targetAmts] = await facade.primeBasket(rToken.address)
        expect(erc20s.length).to.equal(4)
        expect(targetNames.length).to.equal(4)
        expect(targetAmts.length).to.equal(4)
        const expectedERC20s = [token.address, usdc.address, aToken.address, cToken.address]
        for (let i = 0; i < 4; i++) {
          expect(erc20s[i]).to.equal(expectedERC20s[i])
          expect(targetNames[i]).to.equal(ethers.utils.formatBytes32String('USD'))
          expect(targetAmts[i]).to.equal(fp('0.25'))
        }
      })

      it('Should return prime basket after a default', async () => {
        // Set a backup config
        await basketHandler
          .connect(owner)
          .setBackupConfig(ethers.utils.formatBytes32String('USD'), bn(1), [token.address])

        // Set up DISABLED collateral (USDC)
        await setOraclePrice(usdcAsset.address, bn('0.5'))
        const delayUntiDefault = await usdcAsset.delayUntilDefault()
        const currentTimestamp = await getLatestBlockTimestamp()
        await usdcAsset.refresh()
        await setNextBlockTimestamp(currentTimestamp + delayUntiDefault + 1)
        await usdcAsset.refresh()
        expect(await usdcAsset.status()).to.equal(CollateralStatus.DISABLED)

        // switch basket, removing USDC
        await basketHandler.refreshBasket()
        expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)

        // prime basket should still be all 4 tokens
        const [erc20s, targetNames, targetAmts] = await facade.primeBasket(rToken.address)
        expect(erc20s.length).to.equal(4)
        expect(targetNames.length).to.equal(4)
        expect(targetAmts.length).to.equal(4)
        const expectedERC20s = [token.address, usdc.address, aToken.address, cToken.address]
        for (let i = 0; i < 4; i++) {
          expect(erc20s[i]).to.equal(expectedERC20s[i])
          expect(targetNames[i]).to.equal(ethers.utils.formatBytes32String('USD'))
          expect(targetAmts[i]).to.equal(fp('0.25'))
        }
      })

      it('Should return backup config', async () => {
        // Set a backup config
        await basketHandler
          .connect(owner)
          .setBackupConfig(ethers.utils.formatBytes32String('USD'), bn(1), [
            token.address,
            usdc.address,
          ])

        // Expect that config
        let [erc20s, max] = await facade.backupConfig(
          rToken.address,
          ethers.utils.formatBytes32String('USD')
        )
        expect(erc20s.length).to.equal(2)
        expect(erc20s[0]).to.equal(token.address)
        expect(erc20s[1]).to.equal(usdc.address)
        expect(max).to.equal(1)

        // Expect empty config for non-USD
        ;[erc20s, max] = await facade.backupConfig(
          rToken.address,
          ethers.utils.formatBytes32String('EUR')
        )
        expect(erc20s.length).to.equal(0)
        expect(max).to.equal(0)
      })
    }
  })
})
