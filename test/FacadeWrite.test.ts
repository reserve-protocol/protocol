import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { ContractFactory } from 'ethers'
import { ethers } from 'hardhat'
import { cloneDeep } from 'lodash'
import {
  IConfig,
  IGovParams,
  IGovRoles,
  IRevenueShare,
  IRTokenConfig,
  IRTokenSetup,
} from '../common/configuration'
import {
  CollateralStatus,
  SHORT_FREEZER,
  LONG_FREEZER,
  MAX_UINT256,
  OWNER,
  PAUSER,
  ZERO_ADDRESS,
  ONE_DAY,
} from '../common/constants'
import { expectInIndirectReceipt, expectInReceipt } from '../common/events'
import { bn, fp } from '../common/numbers'
import { expectPrice, setOraclePrice } from './utils/oracles'
import { advanceTime, getLatestBlockNumber } from './utils/time'
import snapshotGasCost from './utils/snapshotGasCost'
import {
  Asset,
  CTokenFiatCollateral,
  CTokenMock,
  ERC20Mock,
  FacadeTest,
  FacadeWrite,
  FiatCollateral,
  Governance,
  IAssetRegistry,
  RTokenAsset,
  TestIBackingManager,
  TestIBasketHandler,
  TestIBroker,
  TestIDeployer,
  TestIDistributor,
  TestIFacade,
  TestIFurnace,
  TestIMain,
  TestIRevenueTrader,
  TestIStRSR,
  TestIRToken,
  TimelockController,
  USDCMock,
} from '../typechain'
import {
  Collateral,
  Implementation,
  IMPLEMENTATION,
  defaultFixture,
  ORACLE_ERROR,
} from './fixtures'
import { useEnv } from '#/utils/env'

const describeGas =
  IMPLEMENTATION == Implementation.P1 && useEnv('REPORT_GAS') ? describe.only : describe.skip

describe('FacadeWrite contract', () => {
  let deployerUser: SignerWithAddress
  let owner: SignerWithAddress
  let addr1: SignerWithAddress
  let addr2: SignerWithAddress
  let addr3: SignerWithAddress
  let beneficiary1: SignerWithAddress
  let beneficiary2: SignerWithAddress

  // RSR
  let rsr: ERC20Mock
  let rsrAsset: Asset

  // Tokens
  let token: ERC20Mock
  let usdc: USDCMock
  let cToken: ERC20Mock
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
  let facade: TestIFacade
  let facadeTest: FacadeTest
  let facadeWriteLibAddr: string

  // Core contracts
  let main: TestIMain
  let assetRegistry: IAssetRegistry
  let backingManager: TestIBackingManager
  let basketHandler: TestIBasketHandler
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
  let govRoles: IGovRoles

  let revShare1: IRevenueShare
  let revShare2: IRevenueShare

  beforeEach(async () => {
    ;[deployerUser, owner, addr1, addr2, addr3, beneficiary1, beneficiary2] =
      await ethers.getSigners()

    // Deploy fixture
    ;({ rsr, compToken, compAsset, basket, config, facade, facadeTest, deployer } =
      await loadFixture(defaultFixture))

    // Get assets and tokens
    tokenAsset = <FiatCollateral>basket[0]
    usdcAsset = <FiatCollateral>basket[1]
    cTokenAsset = <CTokenFiatCollateral>basket[3]

    token = <ERC20Mock>await ethers.getContractAt('ERC20Mock', await tokenAsset.erc20())
    usdc = <USDCMock>await ethers.getContractAt('USDCMock', await usdcAsset.erc20())
    cToken = <CTokenMock>await ethers.getContractAt('CTokenMock', await cTokenAsset.erc20())

    // Deploy DFacadeWriteLib lib
    const facadeWriteLib = await (await ethers.getContractFactory('FacadeWriteLib')).deploy()
    facadeWriteLibAddr = facadeWriteLib.address

    // Deploy Facade
    const FacadeFactory: ContractFactory = await ethers.getContractFactory('FacadeWrite', {
      libraries: {
        FacadeWriteLib: facadeWriteLibAddr,
      },
    })
    facadeWrite = <FacadeWrite>await FacadeFactory.deploy(deployer.address)

    revShare1 = { rTokenDist: bn('2'), rsrDist: bn('3') } // 0.5% for beneficiary1
    revShare2 = { rTokenDist: bn('4'), rsrDist: bn('6') } // 1% for beneficiary2

    // Decrease revenue splits for nicer rounding
    const localConfig = cloneDeep(config)
    localConfig.dist.rTokenDist = bn('4000')
    localConfig.dist.rsrDist = bn('6000')

    // Set parameters
    rTokenConfig = {
      name: 'RTKN RToken',
      symbol: 'RTKN',
      mandate: 'mandate',
      params: localConfig,
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
      beneficiaries: [
        { beneficiary: beneficiary1.address, revShare: revShare1 },
        { beneficiary: beneficiary2.address, revShare: revShare2 },
      ],
    }

    // Set governance params
    govParams = {
      votingDelay: ONE_DAY, // 1 day
      votingPeriod: ONE_DAY.mul(3), // 3 days
      proposalThresholdAsMicroPercent: bn(1e6), // 1%
      quorumPercent: bn(4), // 4%
      timelockDelay: bn(60 * 60 * 24), // 1 day
    }

    // Set initial governance roles
    govRoles = {
      owner: owner.address,
      guardian: ZERO_ADDRESS,
      pausers: [],
      shortFreezers: [],
      longFreezers: [],
    }
  })

  it('Should validate parameters', async () => {
    const FacadeFactory: ContractFactory = await ethers.getContractFactory('FacadeWrite', {
      libraries: {
        FacadeWriteLib: facadeWriteLibAddr,
      },
    })
    await expect(FacadeFactory.deploy(ZERO_ADDRESS)).to.be.revertedWith('invalid address')
  })

  it('Should setup values correctly', async () => {
    expect(await facadeWrite.deployer()).to.equal(deployer.address)
  })

  it('Should perform validations', async () => {
    // Cannot deploy with duplicate collateral
    rTokenSetup.primaryBasket = [tokenAsset.address, tokenAsset.address]
    rTokenSetup.weights = [fp('0.5'), fp('0.5')]
    await expect(
      facadeWrite.connect(deployerUser).deployRToken(rTokenConfig, rTokenSetup)
    ).to.be.revertedWith('duplicate collateral')

    // Cannot deploy with duplicate asset
    rTokenSetup.assets = [tokenAsset.address, tokenAsset.address]
    await expect(
      facadeWrite.connect(deployerUser).deployRToken(rTokenConfig, rTokenSetup)
    ).to.be.revertedWith('duplicate asset')

    // Should not accept zero addr beneficiary
    rTokenSetup.beneficiaries = [{ beneficiary: ZERO_ADDRESS, revShare: revShare1 }]
    await expect(
      facadeWrite.connect(deployerUser).deployRToken(rTokenConfig, rTokenSetup)
    ).to.be.revertedWith('beneficiary revShare mismatch')

    // Should not accept empty revShare
    rTokenSetup.beneficiaries = [
      { beneficiary: beneficiary1.address, revShare: { rsrDist: bn(0), rTokenDist: bn(0) } },
    ]
    await expect(
      facadeWrite.connect(deployerUser).deployRToken(rTokenConfig, rTokenSetup)
    ).to.be.revertedWith('beneficiary revShare mismatch')

    // Cannot deploy backup info with no collateral tokens
    rTokenSetup.backups[0].backupCollateral = []
    await expect(
      facadeWrite.connect(deployerUser).deployRToken(rTokenConfig, rTokenSetup)
    ).to.be.revertedWith('no backup collateral')

    // Cannot deploy with invalid length in weights
    rTokenSetup.weights = [fp('1')]
    await expect(
      facadeWrite.connect(deployerUser).deployRToken(rTokenConfig, rTokenSetup)
    ).to.be.revertedWith('invalid length')

    // Cannot deploy with no basket
    rTokenSetup.primaryBasket = []
    await expect(
      facadeWrite.connect(deployerUser).deployRToken(rTokenConfig, rTokenSetup)
    ).to.be.revertedWith('no collateral')
  })

  it('Should allow all rev share to go to RSR stakers', async () => {
    rTokenSetup.beneficiaries = [
      { beneficiary: beneficiary1.address, revShare: { rsrDist: bn(1), rTokenDist: bn(0) } },
    ]
    // Deploy RToken via FacadeWrite
    const receipt = await (
      await facadeWrite.connect(deployerUser).deployRToken(rTokenConfig, rTokenSetup)
    ).wait()

    const mainAddr = expectInIndirectReceipt(receipt, deployer.interface, 'RTokenCreated').args.main
    main = <TestIMain>await ethers.getContractAt('TestIMain', mainAddr)
  })

  it('Should allow all rev share to go to RToken holders', async () => {
    rTokenSetup.beneficiaries = [
      { beneficiary: beneficiary1.address, revShare: { rsrDist: bn(0), rTokenDist: bn(1) } },
    ]
    // Deploy RToken via FacadeWrite
    const receipt = await (
      await facadeWrite.connect(deployerUser).deployRToken(rTokenConfig, rTokenSetup)
    ).wait()

    const mainAddr = expectInIndirectReceipt(receipt, deployer.interface, 'RTokenCreated').args.main
    main = <TestIMain>await ethers.getContractAt('TestIMain', mainAddr)
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
      basketHandler = <TestIBasketHandler>(
        await ethers.getContractAt('TestIBasketHandler', await main.basketHandler())
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
        expect(await main.hasRole(SHORT_FREEZER, deployerUser.address)).to.equal(false)
        expect(await main.hasRole(LONG_FREEZER, deployerUser.address)).to.equal(false)
        expect(await main.hasRole(PAUSER, deployerUser.address)).to.equal(false)

        expect(await main.hasRole(OWNER, facadeWrite.address)).to.equal(true)
        expect(await main.hasRole(SHORT_FREEZER, facadeWrite.address)).to.equal(false)
        expect(await main.hasRole(LONG_FREEZER, facadeWrite.address)).to.equal(false)
        expect(await main.hasRole(PAUSER, facadeWrite.address)).to.equal(false)
        expect(await main.frozen()).to.equal(false)
        expect(await main.tradingPaused()).to.equal(true)
        expect(await main.tradingPausedOrFrozen()).to.equal(true)
        expect(await main.issuancePaused()).to.equal(true)
        expect(await main.issuancePausedOrFrozen()).to.equal(true)

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
        expect(await stRSR.name()).to.equal('rtknRSR Token')
        expect(await stRSR.symbol()).to.equal('rtknRSR')
        expect(await stRSR.decimals()).to.equal(18)
        expect(await stRSR.totalSupply()).to.equal(0)
        expect(await stRSR.main()).to.equal(main.address)

        // Distributor
        const dist1 = await distributor.distribution(beneficiary1.address)
        expect(dist1[0]).to.equal(rTokenSetup.beneficiaries[0].revShare.rTokenDist)
        expect(dist1[1]).to.equal(rTokenSetup.beneficiaries[0].revShare.rsrDist)

        const dist2 = await distributor.distribution(beneficiary2.address)
        expect(dist2[0]).to.equal(rTokenSetup.beneficiaries[1].revShare.rTokenDist)
        expect(dist2[1]).to.equal(rTokenSetup.beneficiaries[1].revShare.rsrDist)
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
        const erc20s = await assetRegistry.erc20s()
        for (const erc20 of erc20s) {
          // Should have allowances for everything except RToken + RSR
          if (erc20 != rToken.address && erc20 != rsr.address) {
            const ERC20 = await ethers.getContractAt('ERC20Mock', erc20)
            expect(await ERC20.allowance(backingManager.address, rToken.address)).to.equal(
              MAX_UINT256
            )
          }
        }
      })

      it('Should not allow to complete setup if not deployer', async () => {
        await expect(
          facadeWrite
            .connect(addr1)
            .setupGovernance(rToken.address, false, false, govParams, govRoles)
        ).to.be.revertedWith('not initial deployer')
      })

      it('Should validate owner param in final setup', async () => {
        await expect(
          facadeWrite
            .connect(deployerUser)
            .setupGovernance(rToken.address, true, false, govParams, govRoles)
        ).to.be.revertedWith('owner should be empty')

        // Remove owner
        const noOwnerGovRoles = { ...govRoles }
        noOwnerGovRoles.owner = ZERO_ADDRESS
        govRoles.owner = await expect(
          facadeWrite
            .connect(deployerUser)
            .setupGovernance(rToken.address, false, false, govParams, noOwnerGovRoles)
        ).to.be.revertedWith('owner not defined')
      })
    })

    describe('Phase 2 - Complete Setup', () => {
      context('Without deploying Governance - Paused', function () {
        beforeEach(async () => {
          // Setup pauser
          const newGovRoles = { ...govRoles }
          newGovRoles.pausers.push(addr1.address)

          await facadeWrite
            .connect(deployerUser)
            .setupGovernance(rToken.address, false, false, govParams, newGovRoles)
        })

        it('Should register Basket correctly', async () => {
          await main.connect(addr1).unpauseTrading()
          await main.connect(addr1).unpauseIssuance()

          // Basket
          expect(await basketHandler.fullyCollateralized()).to.equal(true)
          const backing = await facade.basketTokens(rToken.address)
          expect(backing[0]).to.equal(token.address)
          expect(backing[1]).to.equal(usdc.address)

          expect(backing.length).to.equal(2)

          // Check other values
          expect(await basketHandler.timestamp()).to.be.gt(bn(0))
          expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
          expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(0)

          // Check BU price
          await expectPrice(basketHandler.address, fp('1'), ORACLE_ERROR, true)
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
          expect(await main.hasRole(SHORT_FREEZER, owner.address)).to.equal(false)
          expect(await main.hasRole(LONG_FREEZER, owner.address)).to.equal(false)
          expect(await main.hasRole(PAUSER, owner.address)).to.equal(false)

          // Pauser
          expect(await main.hasRole(OWNER, addr1.address)).to.equal(false)
          expect(await main.hasRole(SHORT_FREEZER, addr1.address)).to.equal(false)
          expect(await main.hasRole(LONG_FREEZER, addr1.address)).to.equal(false)
          expect(await main.hasRole(PAUSER, addr1.address)).to.equal(true)

          expect(await main.hasRole(OWNER, facadeWrite.address)).to.equal(false)
          expect(await main.hasRole(SHORT_FREEZER, facadeWrite.address)).to.equal(false)
          expect(await main.hasRole(LONG_FREEZER, facadeWrite.address)).to.equal(false)
          expect(await main.hasRole(PAUSER, facadeWrite.address)).to.equal(false)

          expect(await main.hasRole(OWNER, deployerUser.address)).to.equal(false)
          expect(await main.hasRole(SHORT_FREEZER, deployerUser.address)).to.equal(false)
          expect(await main.hasRole(LONG_FREEZER, deployerUser.address)).to.equal(false)
          expect(await main.hasRole(PAUSER, deployerUser.address)).to.equal(false)

          expect(await main.frozen()).to.equal(false)
          expect(await main.tradingPaused()).to.equal(true)
          expect(await main.tradingPausedOrFrozen()).to.equal(true)
          expect(await main.issuancePaused()).to.equal(true)
          expect(await main.issuancePausedOrFrozen()).to.equal(true)
        })

        it('Should not allow to complete setup again if already complete', async () => {
          await expect(
            facadeWrite
              .connect(deployerUser)
              .setupGovernance(rToken.address, false, false, govParams, govRoles)
          ).to.be.revertedWith('ownership already transferred')
        })
      })

      context('Without deploying Governance - Unpaused', function () {
        beforeEach(async () => {
          // Setup guardian, pauser, and freezers
          const newGovRoles = { ...govRoles }
          newGovRoles.guardian = addr1.address
          newGovRoles.pausers.push(addr2.address)
          newGovRoles.shortFreezers.push(addr2.address)
          newGovRoles.longFreezers.push(owner.address) // make owner freezer
          newGovRoles.longFreezers.push(addr3.address) // add another long freezer

          // Deploy RToken via FacadeWrite
          await facadeWrite
            .connect(deployerUser)
            .setupGovernance(rToken.address, false, true, govParams, newGovRoles)
        })

        it('Should setup owner, freezer and pauser correctly', async () => {
          expect(await main.hasRole(OWNER, owner.address)).to.equal(true)
          expect(await main.hasRole(SHORT_FREEZER, owner.address)).to.equal(false)
          expect(await main.hasRole(LONG_FREEZER, owner.address)).to.equal(true)
          expect(await main.hasRole(PAUSER, owner.address)).to.equal(false)

          expect(await main.hasRole(OWNER, addr1.address)).to.equal(false)
          expect(await main.hasRole(SHORT_FREEZER, addr1.address)).to.equal(false)
          expect(await main.hasRole(LONG_FREEZER, addr1.address)).to.equal(false)
          expect(await main.hasRole(PAUSER, addr1.address)).to.equal(false)

          expect(await main.hasRole(OWNER, addr2.address)).to.equal(false)
          expect(await main.hasRole(SHORT_FREEZER, addr2.address)).to.equal(true)
          expect(await main.hasRole(LONG_FREEZER, addr2.address)).to.equal(false)
          expect(await main.hasRole(PAUSER, addr2.address)).to.equal(true)

          expect(await main.hasRole(OWNER, addr3.address)).to.equal(false)
          expect(await main.hasRole(SHORT_FREEZER, addr3.address)).to.equal(false)
          expect(await main.hasRole(LONG_FREEZER, addr3.address)).to.equal(true)
          expect(await main.hasRole(PAUSER, addr3.address)).to.equal(false)

          expect(await main.hasRole(OWNER, facadeWrite.address)).to.equal(false)
          expect(await main.hasRole(SHORT_FREEZER, facadeWrite.address)).to.equal(false)
          expect(await main.hasRole(LONG_FREEZER, facadeWrite.address)).to.equal(false)
          expect(await main.hasRole(PAUSER, facadeWrite.address)).to.equal(false)

          expect(await main.hasRole(OWNER, deployerUser.address)).to.equal(false)
          expect(await main.hasRole(SHORT_FREEZER, deployerUser.address)).to.equal(false)
          expect(await main.hasRole(LONG_FREEZER, deployerUser.address)).to.equal(false)
          expect(await main.hasRole(PAUSER, deployerUser.address)).to.equal(false)

          expect(await main.frozen()).to.equal(false)
          expect(await main.tradingPaused()).to.equal(false)
          expect(await main.tradingPausedOrFrozen()).to.equal(false)
          expect(await main.issuancePaused()).to.equal(false)
          expect(await main.issuancePausedOrFrozen()).to.equal(false)
        })
      })

      context('Deploying Governance - Paused', function () {
        beforeEach(async () => {
          // Setup guardian
          const newGovRoles = { ...govRoles }
          newGovRoles.owner = ZERO_ADDRESS
          newGovRoles.guardian = addr1.address
          newGovRoles.pausers.push(addr1.address)
          newGovRoles.pausers.push(addr2.address)
          newGovRoles.shortFreezers.push(addr2.address)
          newGovRoles.shortFreezers.push(addr3.address)

          // Deploy RToken via FacadeWrite
          const receipt = await (
            await facadeWrite
              .connect(deployerUser)
              .setupGovernance(rToken.address, true, false, govParams, newGovRoles)
          ).wait()

          // Get Governor and Timelock
          const governanceAddr = expectInReceipt(receipt, 'GovernanceCreated').args.governance
          const timelockAddr = expectInReceipt(receipt, 'GovernanceCreated').args.timelock
          governor = <Governance>await ethers.getContractAt('Governance', governanceAddr)
          timelock = <TimelockController>(
            await ethers.getContractAt('TimelockController', timelockAddr)
          )
          expect(await timelock.hasRole(await timelock.EXECUTOR_ROLE(), governor.address)).to.equal(
            true
          )
          expect(
            await timelock.hasRole(await timelock.CANCELLER_ROLE(), governor.address)
          ).to.equal(true)
        })

        it('Should setup owner, freezer and pauser correctly', async () => {
          expect(await main.hasRole(OWNER, timelock.address)).to.equal(true)
          expect(await main.hasRole(SHORT_FREEZER, timelock.address)).to.equal(false)
          expect(await main.hasRole(LONG_FREEZER, timelock.address)).to.equal(false)
          expect(await main.hasRole(PAUSER, timelock.address)).to.equal(false)

          expect(await main.hasRole(OWNER, addr1.address)).to.equal(false)
          expect(await main.hasRole(SHORT_FREEZER, addr1.address)).to.equal(false)
          expect(await main.hasRole(LONG_FREEZER, addr1.address)).to.equal(false)
          expect(await main.hasRole(PAUSER, addr1.address)).to.equal(true)

          expect(await main.hasRole(OWNER, addr2.address)).to.equal(false)
          expect(await main.hasRole(SHORT_FREEZER, addr2.address)).to.equal(true)
          expect(await main.hasRole(LONG_FREEZER, addr2.address)).to.equal(false)
          expect(await main.hasRole(PAUSER, addr2.address)).to.equal(true)

          expect(await main.hasRole(OWNER, addr3.address)).to.equal(false)
          expect(await main.hasRole(SHORT_FREEZER, addr3.address)).to.equal(true)
          expect(await main.hasRole(LONG_FREEZER, addr3.address)).to.equal(false)
          expect(await main.hasRole(PAUSER, addr3.address)).to.equal(false)

          expect(await main.hasRole(OWNER, facadeWrite.address)).to.equal(false)
          expect(await main.hasRole(SHORT_FREEZER, facadeWrite.address)).to.equal(false)
          expect(await main.hasRole(LONG_FREEZER, facadeWrite.address)).to.equal(false)
          expect(await main.hasRole(PAUSER, facadeWrite.address)).to.equal(false)

          expect(await main.hasRole(OWNER, deployerUser.address)).to.equal(false)
          expect(await main.hasRole(SHORT_FREEZER, deployerUser.address)).to.equal(false)
          expect(await main.hasRole(LONG_FREEZER, deployerUser.address)).to.equal(false)
          expect(await main.hasRole(PAUSER, deployerUser.address)).to.equal(false)

          expect(await main.frozen()).to.equal(false)
          expect(await main.tradingPaused()).to.equal(true)
          expect(await main.tradingPausedOrFrozen()).to.equal(true)
          expect(await main.issuancePaused()).to.equal(true)
          expect(await main.issuancePausedOrFrozen()).to.equal(true)
        })

        it('Should deploy Governor correctly', async () => {
          expect(await governor.votingDelay()).to.equal(govParams.votingDelay)
          expect(await governor.votingPeriod()).to.equal(govParams.votingPeriod)

          // the proposalThreshold won't work in P0 because it assumes IStRSRVotes
          if (IMPLEMENTATION == Implementation.P1) {
            // At 0 supply it should be 0
            expect(await governor.proposalThreshold()).to.equal(0)
            expect(await governor.quorum((await getLatestBlockNumber()) - 1)).to.equal(0)
          }
          expect(await governor.name()).to.equal('Governor Anastasius')

          // Quorum
          expect(await governor['quorumNumerator()']()).to.equal(govParams.quorumPercent)
          expect(await governor.timelock()).to.equal(timelock.address)
          expect(await governor.token()).to.equal(stRSR.address)
        })
      })

      context('Deploying Governance - Unpaused', function () {
        beforeEach(async () => {
          // Remove owner
          const newGovRoles = { ...govRoles }
          newGovRoles.owner = ZERO_ADDRESS
          newGovRoles.pausers.push(addr1.address)
          newGovRoles.shortFreezers.push(addr1.address)

          // Should handle Zero addresses
          newGovRoles.pausers.push(ZERO_ADDRESS)
          newGovRoles.shortFreezers.push(ZERO_ADDRESS)
          newGovRoles.longFreezers.push(ZERO_ADDRESS)

          const receipt = await (
            await facadeWrite
              .connect(deployerUser)
              .setupGovernance(rToken.address, true, true, govParams, newGovRoles)
          ).wait()

          // Get Governor and Timelock
          const governanceAddr = expectInReceipt(receipt, 'GovernanceCreated').args.governance
          const timelockAddr = expectInReceipt(receipt, 'GovernanceCreated').args.timelock
          governor = <Governance>await ethers.getContractAt('Governance', governanceAddr)
          timelock = <TimelockController>(
            await ethers.getContractAt('TimelockController', timelockAddr)
          )
          expect(await timelock.hasRole(await timelock.EXECUTOR_ROLE(), governor.address)).to.equal(
            true
          )
        })

        it('Should setup owner, freezer and pauser correctly', async () => {
          expect(await main.hasRole(OWNER, timelock.address)).to.equal(true)
          expect(await main.hasRole(SHORT_FREEZER, timelock.address)).to.equal(false)
          expect(await main.hasRole(LONG_FREEZER, timelock.address)).to.equal(false)
          expect(await main.hasRole(PAUSER, timelock.address)).to.equal(false)

          expect(await main.hasRole(OWNER, addr1.address)).to.equal(false)
          expect(await main.hasRole(SHORT_FREEZER, addr1.address)).to.equal(true)
          expect(await main.hasRole(LONG_FREEZER, addr1.address)).to.equal(false)
          expect(await main.hasRole(PAUSER, addr1.address)).to.equal(true)

          expect(await main.hasRole(OWNER, addr2.address)).to.equal(false)
          expect(await main.hasRole(SHORT_FREEZER, addr2.address)).to.equal(false)
          expect(await main.hasRole(LONG_FREEZER, addr2.address)).to.equal(false)
          expect(await main.hasRole(PAUSER, addr2.address)).to.equal(false)

          expect(await main.hasRole(OWNER, facadeWrite.address)).to.equal(false)
          expect(await main.hasRole(SHORT_FREEZER, facadeWrite.address)).to.equal(false)
          expect(await main.hasRole(LONG_FREEZER, facadeWrite.address)).to.equal(false)
          expect(await main.hasRole(PAUSER, facadeWrite.address)).to.equal(false)

          expect(await main.hasRole(OWNER, deployerUser.address)).to.equal(false)
          expect(await main.hasRole(SHORT_FREEZER, deployerUser.address)).to.equal(false)
          expect(await main.hasRole(LONG_FREEZER, deployerUser.address)).to.equal(false)
          expect(await main.hasRole(PAUSER, deployerUser.address)).to.equal(false)

          expect(await main.frozen()).to.equal(false)
          expect(await main.tradingPaused()).to.equal(false)
          expect(await main.tradingPausedOrFrozen()).to.equal(false)
          expect(await main.issuancePaused()).to.equal(false)
          expect(await main.issuancePausedOrFrozen()).to.equal(false)
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
        const newGovRoles = { ...govRoles }
        newGovRoles.guardian = addr1.address
        newGovRoles.pausers.push(addr2.address)

        // Deploy RToken via FacadeWrite
        await snapshotGasCost(
          await facadeWrite
            .connect(deployerUser)
            .setupGovernance(rToken.address, false, false, govParams, newGovRoles)
        )
      })

      it('Phase 2 - Deploy governance', async () => {
        const newGovRoles = { ...govRoles }
        newGovRoles.owner = ZERO_ADDRESS
        newGovRoles.guardian = addr1.address
        newGovRoles.pausers.push(addr2.address)

        // Deploy RToken via FacadeWrite
        await snapshotGasCost(
          await facadeWrite
            .connect(deployerUser)
            .setupGovernance(rToken.address, true, true, govParams, newGovRoles)
        )
      })
    })
  })
})
