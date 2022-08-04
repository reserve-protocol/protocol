import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { ContractFactory, Wallet } from 'ethers'
import { ethers, waffle } from 'hardhat'
import { IConfig, IGovParams, IRTokenConfig, IRTokenSetup } from '../common/configuration'
import {
  CollateralStatus,
  FREEZE_STARTER,
  FREEZE_EXTENDER,
  MAX_UINT256,
  OWNER,
  PAUSER,
  ZERO_ADDRESS,
} from '../common/constants'
import { expectInIndirectReceipt, expectInReceipt } from '../common/events'
import { bn, fp } from '../common/numbers'
import { setOraclePrice } from './utils/oracles'
import { advanceTime } from './utils/time'
import snapshotGasCost from './utils/snapshotGasCost'

import {
  Asset,
  CTokenFiatCollateral,
  CTokenMock,
  ERC20Mock,
  IBasketHandler,
  Facade,
  FacadeWrite,
  FiatCollateral,
  Governance,
  IAssetRegistry,
  RTokenAsset,
  TestIBackingManager,
  TestIBroker,
  TestIDeployer,
  TestIDistributor,
  TestIFurnace,
  TestIMain,
  TestIRevenueTrader,
  TestIStRSR,
  TestIRToken,
  TimelockController,
  USDCMock,
} from '../typechain'
import { Collateral, Implementation, IMPLEMENTATION, defaultFixture } from './fixtures'

const createFixtureLoader = waffle.createFixtureLoader

const describeGas =
  IMPLEMENTATION == Implementation.P1 && process.env.REPORT_GAS ? describe : describe.skip

describe('FacadeWrite contract', () => {
  let deployerUser: SignerWithAddress
  let owner: SignerWithAddress
  let addr1: SignerWithAddress
  let addr2: SignerWithAddress

  // RSR
  let rsr: ERC20Mock
  let rsrAsset: Asset

  // Tokens
  let token: ERC20Mock
  let usdc: USDCMock
  let cToken: CTokenMock
  let basket: Collateral[]

  // Aave / Comp
  let compToken: ERC20Mock

  // Assets
  let tokenAsset: FiatCollateral
  let usdcAsset: FiatCollateral
  let cTokenAsset: CTokenFiatCollateral
  let compAsset: Asset
  let rTokenAsset: RTokenAsset

  // Config
  let config: IConfig

  // Deployer
  let deployer: TestIDeployer

  // Governor
  let governor: Governance
  let timelock: TimelockController

  // Facade
  let facade: Facade

  // Core contracts
  let main: TestIMain
  let assetRegistry: IAssetRegistry
  let backingManager: TestIBackingManager
  let basketHandler: IBasketHandler
  let broker: TestIBroker
  let distributor: TestIDistributor
  let furnace: TestIFurnace
  let rToken: TestIRToken
  let rTokenTrader: TestIRevenueTrader
  let rsrTrader: TestIRevenueTrader
  let stRSR: TestIStRSR

  let facadeWrite: FacadeWrite
  let rTokenConfig: IRTokenConfig
  let rTokenSetup: IRTokenSetup
  let govParams: IGovParams

  let loadFixture: ReturnType<typeof createFixtureLoader>
  let wallet: Wallet

  before('create fixture loader', async () => {
    ;[wallet] = (await ethers.getSigners()) as unknown as Wallet[]
    loadFixture = createFixtureLoader([wallet])
  })

  beforeEach(async () => {
    ;[deployerUser, owner, addr1, addr2] = await ethers.getSigners()

    // Deploy fixture
    ;({ rsr, compToken, compAsset, basket, config, facade, deployer } = await loadFixture(
      defaultFixture
    ))

    // Get assets and tokens
    tokenAsset = <FiatCollateral>basket[0]
    usdcAsset = <FiatCollateral>basket[1]
    cTokenAsset = <CTokenFiatCollateral>basket[3]

    token = <ERC20Mock>await ethers.getContractAt('ERC20Mock', await tokenAsset.erc20())
    usdc = <USDCMock>await ethers.getContractAt('USDCMock', await usdcAsset.erc20())
    cToken = <CTokenMock>await ethers.getContractAt('CTokenMock', await cTokenAsset.erc20())

    // Deploy Facade
    const FacadeFactory: ContractFactory = await ethers.getContractFactory('FacadeWrite')
    facadeWrite = <FacadeWrite>await FacadeFactory.deploy(deployer.address)

    // Set parameters
    rTokenConfig = {
      name: 'RTKN RToken',
      symbol: 'RTKN',
      manifestoURI: 'manifesto',
      params: config,
    }

    rTokenSetup = {
      assets: [compAsset.address],
      primaryBasket: [tokenAsset.address, usdcAsset.address],
      weights: [fp('0.5'), fp('0.5')],
      backups: [
        {
          backupUnit: ethers.utils.formatBytes32String('USD'),
          diversityFactor: bn(1),
          backupCollateral: [cTokenAsset.address],
        },
      ],
    }

    // Set governance params
    govParams = {
      votingDelay: bn(5), // 5 blocks
      votingPeriod: bn(100), // 100 blocks
      proposalThresholdAsMicroPercent: bn(1e6), // 1%
      quorumPercent: bn(4), // 4%
      minDelay: bn(60 * 60 * 24), // 1 day
    }
  })

  it('Should validate parameters', async () => {
    const FacadeFactory: ContractFactory = await ethers.getContractFactory('FacadeWrite')
    await expect(FacadeFactory.deploy(ZERO_ADDRESS)).to.be.revertedWith('invalid address')
  })

  it('Should setup values correctly', async () => {
    expect(await facadeWrite.deployer()).to.equal(deployer.address)
  })

  it('Should perform validations', async () => {
    // Set parameters
    rTokenConfig = {
      name: 'RTKN RToken',
      symbol: 'RTKN',
      manifestoURI: 'manifesto',
      params: config,
    }

    rTokenSetup = {
      assets: [compAsset.address],
      primaryBasket: [tokenAsset.address, usdcAsset.address],
      weights: [fp('0.5'), fp('0.5')],
      backups: [
        {
          backupUnit: ethers.utils.formatBytes32String('USD'),
          diversityFactor: bn(1),
          backupCollateral: [cTokenAsset.address],
        },
      ],
    }

    // Cannot deploy with no basket
    rTokenSetup.primaryBasket = []
    await expect(
      facadeWrite.connect(deployerUser).deployRToken(rTokenConfig, rTokenSetup)
    ).to.be.revertedWith('no collateral')

    // Cannot deploy with invalid length in weights
    rTokenSetup.primaryBasket = [tokenAsset.address, usdcAsset.address]
    rTokenSetup.weights = [fp('1')]
    await expect(
      facadeWrite.connect(deployerUser).deployRToken(rTokenConfig, rTokenSetup)
    ).to.be.revertedWith('invalid length')

    // Cannot deploy backup info with no collateral tokens
    rTokenSetup.primaryBasket = [tokenAsset.address, usdcAsset.address]
    rTokenSetup.weights = [fp('0.5'), fp('0.5')]
    rTokenSetup.backups[0].backupCollateral = []
    await expect(
      facadeWrite.connect(deployerUser).deployRToken(rTokenConfig, rTokenSetup)
    ).to.be.revertedWith('no backup collateral')
  })

  describe('Deployment Process', () => {
    beforeEach(async () => {
      // Deploy RToken via FacadeWrite
      const receipt = await (
        await facadeWrite.connect(deployerUser).deployRToken(rTokenConfig, rTokenSetup)
      ).wait()

      const mainAddr = expectInIndirectReceipt(receipt, deployer.interface, 'RTokenCreated').args
        .main
      main = <TestIMain>await ethers.getContractAt('TestIMain', mainAddr)

      // Get Core
      assetRegistry = <IAssetRegistry>(
        await ethers.getContractAt('IAssetRegistry', await main.assetRegistry())
      )
      backingManager = <TestIBackingManager>(
        await ethers.getContractAt('TestIBackingManager', await main.backingManager())
      )
      basketHandler = <IBasketHandler>(
        await ethers.getContractAt('IBasketHandler', await main.basketHandler())
      )

      broker = <TestIBroker>await ethers.getContractAt('TestIBroker', await main.broker())

      distributor = <TestIDistributor>(
        await ethers.getContractAt('TestIDistributor', await main.distributor())
      )

      furnace = <TestIFurnace>await ethers.getContractAt('TestIFurnace', await main.furnace())

      rToken = <TestIRToken>await ethers.getContractAt('TestIRToken', await main.rToken())

      rTokenTrader = <TestIRevenueTrader>(
        await ethers.getContractAt('TestIRevenueTrader', await main.rTokenTrader())
      )
      rsrTrader = <TestIRevenueTrader>(
        await ethers.getContractAt('TestIRevenueTrader', await main.rsrTrader())
      )

      stRSR = <TestIStRSR>await ethers.getContractAt('TestIStRSR', await main.stRSR())

      // Assets
      rTokenAsset = <RTokenAsset>(
        await ethers.getContractAt('RTokenAsset', await assetRegistry.toAsset(rToken.address))
      )

      rsrAsset = <Asset>(
        await ethers.getContractAt('Asset', await assetRegistry.toAsset(rsr.address))
      )
    })

    describe('Phase 1 - Deploy RToken', () => {
      it('Should deploy required contracts', async () => {
        expect(main.address).to.not.equal(ZERO_ADDRESS)
        // Assets
        expect(rsrAsset.address).to.not.equal(ZERO_ADDRESS)
        expect(compAsset.address).to.not.equal(ZERO_ADDRESS)
        expect(rTokenAsset.address).to.not.equal(ZERO_ADDRESS)

        // Core
        expect(assetRegistry.address).to.not.equal(ZERO_ADDRESS)
        expect(basketHandler.address).to.not.equal(ZERO_ADDRESS)
        expect(backingManager.address).to.not.equal(ZERO_ADDRESS)
        expect(broker.address).to.not.equal(ZERO_ADDRESS)
        expect(distributor.address).to.not.equal(ZERO_ADDRESS)
        expect(furnace.address).to.not.equal(ZERO_ADDRESS)
        expect(rToken.address).to.not.equal(ZERO_ADDRESS)
        expect(rTokenTrader.address).to.not.equal(ZERO_ADDRESS)
        expect(rsrTrader.address).to.not.equal(ZERO_ADDRESS)
        expect(stRSR.address).to.not.equal(ZERO_ADDRESS)
      })

      it('Should register deployer correctly', async () => {
        expect(await main.hasRole(OWNER, deployerUser.address)).to.equal(true)
      })

      it('Should setup RToken correctly', async () => {
        // Owner/Pauser
        expect(await main.hasRole(OWNER, deployerUser.address)).to.equal(true)
        expect(await main.hasRole(FREEZE_STARTER, deployerUser.address)).to.equal(false)
        expect(await main.hasRole(FREEZE_EXTENDER, deployerUser.address)).to.equal(false)
        expect(await main.hasRole(PAUSER, deployerUser.address)).to.equal(false)

        expect(await main.hasRole(OWNER, facadeWrite.address)).to.equal(true)
        expect(await main.hasRole(FREEZE_STARTER, facadeWrite.address)).to.equal(true)
        expect(await main.hasRole(FREEZE_EXTENDER, facadeWrite.address)).to.equal(true)
        expect(await main.hasRole(PAUSER, facadeWrite.address)).to.equal(true)
        expect(await main.frozen()).to.equal(true)

        // RToken
        expect(await assetRegistry.toAsset(rToken.address)).to.equal(rTokenAsset.address)
        expect(await rTokenAsset.erc20()).to.equal(rToken.address)
        expect(await main.rToken()).to.equal(rToken.address)
        expect(await rToken.name()).to.equal('RTKN RToken')
        expect(await rToken.symbol()).to.equal('RTKN')
        expect(await rToken.decimals()).to.equal(18)
        expect(await rToken.totalSupply()).to.equal(bn(0))
        expect(await rToken.main()).to.equal(main.address)

        // Components
        expect(await assetRegistry.main()).to.equal(main.address)
        expect(await backingManager.main()).to.equal(main.address)
        expect(await basketHandler.main()).to.equal(main.address)
        expect(await broker.main()).to.equal(main.address)
        expect(await distributor.main()).to.equal(main.address)
        expect(await furnace.main()).to.equal(main.address)
        expect(await rTokenTrader.main()).to.equal(main.address)
        expect(await rsrTrader.main()).to.equal(main.address)

        // StRSR
        expect(await stRSR.name()).to.equal('stRTKNRSR Token')
        expect(await stRSR.symbol()).to.equal('stRTKNRSR')
        expect(await stRSR.decimals()).to.equal(18)
        expect(await stRSR.totalSupply()).to.equal(0)
        expect(await stRSR.main()).to.equal(main.address)
      })

      it('Should register Assets/Collateral correctly', async () => {
        // RSR
        expect(await assetRegistry.toAsset(rsr.address)).to.equal(rsrAsset.address)
        expect(await rsrAsset.erc20()).to.equal(rsr.address)
        expect(await main.rsr()).to.equal(rsr.address)

        // Check assets/collateral
        const ERC20s = await assetRegistry.erc20s()
        expect(ERC20s[0]).to.equal(rToken.address)
        expect(ERC20s[1]).to.equal(rsr.address)
        expect(ERC20s[2]).to.equal(compToken.address)

        // Assets
        const erc20s = await assetRegistry.erc20s()
        expect(await assetRegistry.toAsset(erc20s[0])).to.equal(rTokenAsset.address)
        expect(await assetRegistry.toAsset(erc20s[1])).to.equal(rsrAsset.address)
        expect(await assetRegistry.toAsset(erc20s[2])).to.equal(compAsset.address)
        expect(await assetRegistry.toAsset(erc20s[3])).to.equal(tokenAsset.address)
        expect(await assetRegistry.toAsset(erc20s[4])).to.equal(usdcAsset.address)
        expect(await assetRegistry.toAsset(erc20s[5])).to.equal(cTokenAsset.address) // Backup token
        expect(erc20s.length).to.eql((await facade.basketTokens(rToken.address)).length + 4)

        // Collaterals
        expect(await assetRegistry.toColl(ERC20s[3])).to.equal(tokenAsset.address)
        expect(await assetRegistry.toColl(ERC20s[4])).to.equal(usdcAsset.address)
        expect(await assetRegistry.toColl(ERC20s[5])).to.equal(cTokenAsset.address)
      })

      it('Should grant allowances to RToken correctly', async () => {
        // Basket
        const backing = await facade.basketTokens(rToken.address)
        expect(backing[0]).to.equal(token.address)
        expect(backing[1]).to.equal(usdc.address)

        expect(await token.allowance(backingManager.address, rToken.address)).to.equal(MAX_UINT256)
        expect(await usdc.allowance(backingManager.address, rToken.address)).to.equal(MAX_UINT256)
      })

      it('Should not allow to complete setup if not deployer', async () => {
        await expect(
          facadeWrite
            .connect(addr1)
            .setupGovernance(
              rToken.address,
              false,
              false,
              govParams,
              owner.address,
              ZERO_ADDRESS,
              ZERO_ADDRESS
            )
        ).to.be.revertedWith('not initial deployer')
      })

      it('Should validate owner param when deploying governance in final setup', async () => {
        await expect(
          facadeWrite
            .connect(deployerUser)
            .setupGovernance(
              rToken.address,
              true,
              false,
              govParams,
              owner.address,
              ZERO_ADDRESS,
              ZERO_ADDRESS
            )
        ).to.be.revertedWith('owner should be empty')
      })
    })

    describe('Phase 2 - Complete Setup', () => {
      context('Without deploying Governance - Paused', function () {
        beforeEach(async () => {
          await facadeWrite
            .connect(deployerUser)
            .setupGovernance(
              rToken.address,
              false,
              false,
              govParams,
              owner.address,
              ZERO_ADDRESS,
              ZERO_ADDRESS
            )
        })

        it('Should register Basket correctly', async () => {
          // Unpause
          await main.connect(owner).unfreeze()

          // Basket
          expect(await basketHandler.fullyCapitalized()).to.equal(true)
          const backing = await facade.basketTokens(rToken.address)
          expect(backing[0]).to.equal(token.address)
          expect(backing[1]).to.equal(usdc.address)

          expect(backing.length).to.equal(2)

          // Check other values
          expect((await basketHandler.lastSet())[0]).to.be.gt(bn(0))
          expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
          expect(await basketHandler.price()).to.equal(fp('1'))
          expect(await facade.callStatic.totalAssetValue(rToken.address)).to.equal(0)

          // Check BU price
          expect(await basketHandler.price()).to.equal(fp('1'))
        })

        it('Should setup backup basket correctly', async () => {
          // Check initial state
          expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)

          // Check backing
          let tokens = await facade.basketTokens(rToken.address)
          expect(tokens).to.eql([token.address, usdc.address])

          // Set Usdc to default - 50% price reduction
          await setOraclePrice(usdcAsset.address, bn('0.5e8'))

          // Mark default as probable
          await usdcAsset.refresh()

          // Check state - No changes
          expect(await basketHandler.status()).to.equal(CollateralStatus.IFFY)

          // Advance time post delayUntilDefault
          await advanceTime((await usdcAsset.delayUntilDefault()).toString())

          // Confirm default
          await usdcAsset.refresh()

          // Check state
          expect(await basketHandler.status()).to.equal(CollateralStatus.DISABLED)

          // Backing did not change
          tokens = await facade.basketTokens(rToken.address)
          expect(tokens).to.eql([token.address, usdc.address])

          // Basket switch
          await expect(basketHandler.connect(owner).refreshBasket()).to.emit(
            basketHandler,
            'BasketSet'
          )

          // Check new state - backing updated
          expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
          tokens = await facade.basketTokens(rToken.address)
          expect(tokens).to.eql([token.address, cToken.address])
        })

        it('Should setup roles correctly', async () => {
          expect(await main.hasRole(OWNER, owner.address)).to.equal(true)
          expect(await main.hasRole(FREEZE_STARTER, owner.address)).to.equal(true)
          expect(await main.hasRole(FREEZE_EXTENDER, owner.address)).to.equal(true)
          expect(await main.hasRole(PAUSER, owner.address)).to.equal(true)

          expect(await main.hasRole(OWNER, facadeWrite.address)).to.equal(false)
          expect(await main.hasRole(FREEZE_STARTER, facadeWrite.address)).to.equal(false)
          expect(await main.hasRole(FREEZE_EXTENDER, facadeWrite.address)).to.equal(false)
          expect(await main.hasRole(PAUSER, facadeWrite.address)).to.equal(false)

          expect(await main.hasRole(OWNER, deployerUser.address)).to.equal(false)
          expect(await main.hasRole(FREEZE_STARTER, deployerUser.address)).to.equal(false)
          expect(await main.hasRole(FREEZE_EXTENDER, deployerUser.address)).to.equal(false)
          expect(await main.hasRole(PAUSER, deployerUser.address)).to.equal(false)

          expect(await main.frozen()).to.equal(true)
        })

        it('Should not allow to complete setup again if already complete', async () => {
          await expect(
            facadeWrite
              .connect(deployerUser)
              .setupGovernance(
                rToken.address,
                false,
                false,
                govParams,
                owner.address,
                ZERO_ADDRESS,
                ZERO_ADDRESS
              )
          ).to.be.revertedWith('ownership already transferred')
        })
      })

      context('Without deploying Governance - Unpaused', function () {
        beforeEach(async () => {
          // Deploy RToken via FacadeWrite
          await facadeWrite
            .connect(deployerUser)
            .setupGovernance(
              rToken.address,
              false,
              true,
              govParams,
              owner.address,
              addr1.address,
              addr2.address
            )
        })

        it('Should setup owner, freezer and pauser correctly', async () => {
          expect(await main.hasRole(OWNER, owner.address)).to.equal(true)
          expect(await main.hasRole(FREEZE_STARTER, owner.address)).to.equal(true)
          expect(await main.hasRole(FREEZE_EXTENDER, owner.address)).to.equal(true)
          expect(await main.hasRole(PAUSER, owner.address)).to.equal(true)

          expect(await main.hasRole(OWNER, addr1.address)).to.equal(false)
          expect(await main.hasRole(FREEZE_STARTER, addr1.address)).to.equal(true)
          expect(await main.hasRole(FREEZE_EXTENDER, addr1.address)).to.equal(true)
          expect(await main.hasRole(PAUSER, addr1.address)).to.equal(true)

          expect(await main.hasRole(OWNER, addr2.address)).to.equal(false)
          expect(await main.hasRole(FREEZE_STARTER, addr2.address)).to.equal(false)
          expect(await main.hasRole(FREEZE_EXTENDER, addr2.address)).to.equal(false)
          expect(await main.hasRole(PAUSER, addr2.address)).to.equal(true)

          expect(await main.hasRole(OWNER, facadeWrite.address)).to.equal(false)
          expect(await main.hasRole(FREEZE_STARTER, facadeWrite.address)).to.equal(false)
          expect(await main.hasRole(FREEZE_EXTENDER, facadeWrite.address)).to.equal(false)
          expect(await main.hasRole(PAUSER, facadeWrite.address)).to.equal(false)

          expect(await main.hasRole(OWNER, deployerUser.address)).to.equal(false)
          expect(await main.hasRole(FREEZE_STARTER, deployerUser.address)).to.equal(false)
          expect(await main.hasRole(FREEZE_EXTENDER, deployerUser.address)).to.equal(false)
          expect(await main.hasRole(PAUSER, deployerUser.address)).to.equal(false)

          expect(await main.frozen()).to.equal(false)
        })
      })

      context('Deploying Governance - Paused', function () {
        beforeEach(async () => {
          // Deploy RToken via FacadeWrite
          const receipt = await (
            await facadeWrite
              .connect(deployerUser)
              .setupGovernance(
                rToken.address,
                true,
                false,
                govParams,
                ZERO_ADDRESS,
                addr1.address,
                ZERO_ADDRESS
              )
          ).wait()

          // Get Governor and Timelock
          const governanceAddr = expectInReceipt(receipt, 'GovernanceCreated').args.governance
          const timelockAddr = expectInReceipt(receipt, 'GovernanceCreated').args.timelock
          governor = <Governance>await ethers.getContractAt('Governance', governanceAddr)
          timelock = <TimelockController>(
            await ethers.getContractAt('TimelockController', timelockAddr)
          )
        })

        it('Should setup owner, freezer and pauser correctly', async () => {
          expect(await main.hasRole(OWNER, timelock.address)).to.equal(true)
          expect(await main.hasRole(FREEZE_STARTER, timelock.address)).to.equal(true)
          expect(await main.hasRole(FREEZE_EXTENDER, timelock.address)).to.equal(true)
          expect(await main.hasRole(PAUSER, timelock.address)).to.equal(true)

          expect(await main.hasRole(OWNER, addr1.address)).to.equal(false)
          expect(await main.hasRole(FREEZE_STARTER, addr1.address)).to.equal(true)
          expect(await main.hasRole(FREEZE_EXTENDER, addr1.address)).to.equal(true)
          expect(await main.hasRole(PAUSER, addr1.address)).to.equal(true)

          expect(await main.hasRole(OWNER, addr2.address)).to.equal(false)
          expect(await main.hasRole(FREEZE_STARTER, addr2.address)).to.equal(false)
          expect(await main.hasRole(FREEZE_EXTENDER, addr2.address)).to.equal(false)
          expect(await main.hasRole(PAUSER, addr2.address)).to.equal(false)

          expect(await main.hasRole(OWNER, facadeWrite.address)).to.equal(false)
          expect(await main.hasRole(FREEZE_STARTER, facadeWrite.address)).to.equal(false)
          expect(await main.hasRole(FREEZE_EXTENDER, facadeWrite.address)).to.equal(false)
          expect(await main.hasRole(PAUSER, facadeWrite.address)).to.equal(false)

          expect(await main.hasRole(OWNER, deployerUser.address)).to.equal(false)
          expect(await main.hasRole(FREEZE_STARTER, deployerUser.address)).to.equal(false)
          expect(await main.hasRole(FREEZE_EXTENDER, deployerUser.address)).to.equal(false)
          expect(await main.hasRole(PAUSER, deployerUser.address)).to.equal(false)

          expect(await main.frozen()).to.equal(true)
        })

        it('Should deploy Governor correctly', async () => {
          expect(await governor.votingDelay()).to.equal(govParams.votingDelay)
          expect(await governor.votingPeriod()).to.equal(govParams.votingPeriod)
          expect(await governor.proposalThreshold()).to.equal(
            govParams.proposalThresholdAsMicroPercent
          )
          expect(await governor.name()).to.equal('Reserve Governor')
          // Quorum
          expect(await governor.quorumNumerator()).to.equal(govParams.quorumPercent)
          expect(await governor.timelock()).to.equal(timelock.address)
          expect(await governor.token()).to.equal(stRSR.address)
        })
      })

      context('Deploying Governance - Unpaused', function () {
        beforeEach(async () => {
          const receipt = await (
            await facadeWrite
              .connect(deployerUser)
              .setupGovernance(
                rToken.address,
                true,
                true,
                govParams,
                ZERO_ADDRESS,
                ZERO_ADDRESS,
                ZERO_ADDRESS
              )
          ).wait()

          // Get Governor and Timelock
          const governanceAddr = expectInReceipt(receipt, 'GovernanceCreated').args.governance
          const timelockAddr = expectInReceipt(receipt, 'GovernanceCreated').args.timelock
          governor = <Governance>await ethers.getContractAt('Governance', governanceAddr)
          timelock = <TimelockController>(
            await ethers.getContractAt('TimelockController', timelockAddr)
          )
        })

        it('Should setup owner, freezer and pauser correctly', async () => {
          expect(await main.hasRole(OWNER, timelock.address)).to.equal(true)
          expect(await main.hasRole(FREEZE_STARTER, timelock.address)).to.equal(true)
          expect(await main.hasRole(FREEZE_EXTENDER, timelock.address)).to.equal(true)
          expect(await main.hasRole(PAUSER, timelock.address)).to.equal(true)

          expect(await main.hasRole(OWNER, addr1.address)).to.equal(false)
          expect(await main.hasRole(FREEZE_STARTER, addr1.address)).to.equal(false)
          expect(await main.hasRole(FREEZE_EXTENDER, addr1.address)).to.equal(false)
          expect(await main.hasRole(PAUSER, addr1.address)).to.equal(false)

          expect(await main.hasRole(OWNER, addr2.address)).to.equal(false)
          expect(await main.hasRole(FREEZE_STARTER, addr2.address)).to.equal(false)
          expect(await main.hasRole(FREEZE_EXTENDER, addr2.address)).to.equal(false)
          expect(await main.hasRole(PAUSER, addr2.address)).to.equal(false)

          expect(await main.hasRole(OWNER, facadeWrite.address)).to.equal(false)
          expect(await main.hasRole(FREEZE_STARTER, facadeWrite.address)).to.equal(false)
          expect(await main.hasRole(FREEZE_EXTENDER, facadeWrite.address)).to.equal(false)
          expect(await main.hasRole(PAUSER, facadeWrite.address)).to.equal(false)

          expect(await main.hasRole(OWNER, deployerUser.address)).to.equal(false)
          expect(await main.hasRole(FREEZE_STARTER, deployerUser.address)).to.equal(false)
          expect(await main.hasRole(FREEZE_EXTENDER, deployerUser.address)).to.equal(false)
          expect(await main.hasRole(PAUSER, deployerUser.address)).to.equal(false)

          expect(await main.frozen()).to.equal(false)
        })
      })
    })

    describeGas('Gas Reporting', () => {
      it('Phase 1 - RToken Deployment', async () => {
        await snapshotGasCost(
          await facadeWrite.connect(deployerUser).deployRToken(rTokenConfig, rTokenSetup)
        )
      })

      it('Phase 2 - Without governance', async () => {
        // Deploy RToken via FacadeWrite
        await snapshotGasCost(
          await facadeWrite
            .connect(deployerUser)
            .setupGovernance(
              rToken.address,
              false,
              false,
              govParams,
              owner.address,
              addr1.address,
              addr2.address
            )
        )
      })

      it('Phase 2 - Deploy governance', async () => {
        // Deploy RToken via FacadeWrite
        await snapshotGasCost(
          await facadeWrite
            .connect(deployerUser)
            .setupGovernance(
              rToken.address,
              true,
              true,
              govParams,
              ZERO_ADDRESS,
              addr1.address,
              addr2.address
            )
        )
      })
    })
  })
})
