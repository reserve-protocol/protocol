import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { expect } from 'chai'
import { BigNumber, ContractFactory, Wallet } from 'ethers'
import hre, { ethers, waffle } from 'hardhat'
import { IMPLEMENTATION } from '../../fixtures'
import { defaultFixture, ORACLE_TIMEOUT } from '../individual-collateral/fixtures'
import { getChainId } from '../../../common/blockchain-utils'
import {
    IConfig,
    IGovParams,
    IRevenueShare,
    IRTokenConfig,
    IRTokenSetup,
    networkConfig,
} from '../../../common/configuration'
import { CollateralStatus, MAX_UINT256, ZERO_ADDRESS } from '../../../common/constants'
import { expectEvents, expectInIndirectReceipt } from '../../../common/events'
import { bn, fp, toBNDecimals } from '../../../common/numbers'
import { whileImpersonating } from '../../utils/impersonation'
import { setOraclePrice } from '../../utils/oracles'
import { advanceBlocks, advanceTime, advanceToTimestamp, getLatestBlockNumber, getLatestBlockTimestamp } from '../../utils/time'
import {
    Asset,
    ERC20Mock,
    FacadeRead,
    FacadeTest,
    FacadeWrite,
    IAssetRegistry,
    IBasketHandler,
    InvalidMockV3Aggregator,
    OracleLib,
    MockV3Aggregator,
    RTokenAsset,
    TestIBackingManager,
    TestIDeployer,
    TestIMain,
    TestIRToken,
    CBEthMock,
    CbEthCollateral,
    IStakedToken,
    CbEthCollateral__factory,
} from '../../../typechain'

const createFixtureLoader = waffle.createFixtureLoader

// Holder address on Mainnet
// specific flavor of cbEth
const holderCbEth = '0x2f043b4bb857a7f4b6831219184dac3105aca34d'

// specific flavor of cpUSDC
// const holderCpAUR_USDC = '0x9790E2f55C718A3c3d701542072D7c1D3D2E3F5f'
// const holderUSDC = '0x7713974908Be4BEd47172370115e8b1219F4A5f0'
//const clearpoolManager = '0x07B6c7bC3d7dc0f36133b542eA51aA7Ac560E974'

const NO_PRICE_DATA_FEED = '0x51597f405303C4377E36123cBc172b13269EA163'

const describeFork = process.env.FORK ? describe : describe.skip

describeFork(`CbEthCollateral - Mainnet Forking P${IMPLEMENTATION}`, function () {
    let owner: SignerWithAddress
    let addr1: SignerWithAddress

    // Tokens/Assets
    let cbEth: CBEthMock
    let cbEthCollateral: CbEthCollateral

    // let cpUsdc: IClearpoolToken
    // let cbEthCollateral: ClearpoolTokenCollateral

    let rsr: ERC20Mock
    let rsrAsset: Asset

    // Core Contracts
    let main: TestIMain
    let rToken: TestIRToken
    let rTokenAsset: RTokenAsset
    let assetRegistry: IAssetRegistry
    let backingManager: TestIBackingManager
    let basketHandler: IBasketHandler

    let deployer: TestIDeployer
    let facade: FacadeRead
    let facadeTest: FacadeTest
    let facadeWrite: FacadeWrite
    let oracleLib: OracleLib
    let govParams: IGovParams

    // RToken Configuration
    const dist: IRevenueShare = {
        rTokenDist: bn(40), // 2/5 RToken
        rsrDist: bn(60), // 3/5 RSR
    }

    const config: IConfig = {
        dist: dist,
        minTradeVolume: fp('1e4'), // $10k
        rTokenMaxTradeVolume: fp('1e6'), // $1M
        shortFreeze: bn('259200'), // 3 days
        longFreeze: bn('2592000'), // 30 days
        rewardPeriod: bn('604800'), // 1 week
        rewardRatio: fp('0.02284'), // approx. half life of 30 pay periods
        unstakingDelay: bn('1209600'), // 2 weeks
        tradingDelay: bn('0'), // (the delay _after_ default has been confirmed)
        auctionLength: bn('900'), // 15 minutes
        backingBuffer: fp('0.0001'), // 0.01%
        maxTradeSlippage: fp('0.01'), // 1%
        issuanceRate: fp('0.00025'), // 0.025% per block or ~0.1% per minute
        scalingRedemptionRate: fp('0.05'), // 5%
        redemptionRateFloor: fp('1e6'), // 1M RToken
    }

    const defaultThreshold = fp('0.05') // 5%
    const delayUntilDefault = bn('86400') // 24h

    let initialBal: BigNumber

    let loadFixture: ReturnType<typeof createFixtureLoader>
    let wallet: Wallet

    let chainId: number

    let cbEthCollateralFactory: CbEthCollateral__factory
    let MockV3AggregatorFactory: ContractFactory
    let mockChainlinkFeed: MockV3Aggregator

    before(async () => {
        ;[wallet] = (await ethers.getSigners()) as unknown as Wallet[]
        loadFixture = createFixtureLoader([wallet])

        chainId = await getChainId(hre)
        if (!networkConfig[chainId]) {
            throw new Error(`Missing network configuration for ${hre.network.name}`)
        }
    })

    beforeEach(async () => {
        ;[owner, addr1] = await ethers.getSigners()
            ; ({ rsr, rsrAsset, deployer, facade, facadeTest, facadeWrite, oracleLib, govParams } =
                await loadFixture(defaultFixture))


        // Setup required token contracts
        // cbEth token
        cbEth = <CBEthMock>(
            await ethers.getContractAt('CBEthMock', networkConfig[chainId].tokens.cbETH || '')
        )

        const masterMinter = await cbEth.masterMinter()
        // mint 20000 cbEth for holder 
        await whileImpersonating(masterMinter, async (mm) => {
            await cbEth.connect(mm).configureMinter(mm.address, fp('200000'))
            await cbEth.connect(mm).mint(holderCbEth, fp('200000'))
        })
        // const oracle = await cbEth.oracle()
        // await whileImpersonating(oracle, async (oracle) => {
        //     await cbEth.connect(oracle).updateExchangeRate(fp('1.01'))
        // })

        // Deploy cbEth collateral plugin
        cbEthCollateralFactory = await ethers.getContractFactory('CbEthCollateral', {
            libraries: { OracleLib: oracleLib.address },
        })
        cbEthCollateral = <CbEthCollateral>(
            await cbEthCollateralFactory.deploy(
                fp('1'),
                networkConfig[chainId].chainlinkFeeds.ETH as string,
                cbEth.address,
                config.rTokenMaxTradeVolume,
                ORACLE_TIMEOUT,
                ethers.utils.formatBytes32String('ETH'),
                delayUntilDefault
            )
        )

        // Setup balances for addr1 - Transfer from Mainnet holder cbEth to addr1
        // credited with 20000 cbEth
        initialBal = fp('20000') //bn('200000e18')

        const bal = await cbEth.balanceOf(holderCbEth)// toBNDecimals(initialBal, 18))

        await whileImpersonating(holderCbEth, async (cbEthSigner) => {
            await cbEth.connect(cbEthSigner).transfer(addr1.address, initialBal)// toBNDecimals(initialBal, 18))
        })

        // Set parameters
        const rTokenConfig: IRTokenConfig = {
            name: 'RTKN RToken',
            symbol: 'RTKN',
            mandate: 'mandate',
            params: config,
        }

        // Set primary basket
        const rTokenSetup: IRTokenSetup = {
            assets: [],
            primaryBasket: [cbEthCollateral.address],
            weights: [fp('1')],
            backups: [],
            beneficiary: ZERO_ADDRESS,
            revShare: { rTokenDist: bn('0'), rsrDist: bn('0') },
        }
        // Deploy RToken via FacadeWrite
        const receipt = await (
            await facadeWrite.connect(owner).deployRToken(rTokenConfig, rTokenSetup)
        ).wait()

        // Get Main
        const mainAddr = expectInIndirectReceipt(receipt, deployer.interface, 'RTokenCreated').args.main
        main = <TestIMain>await ethers.getContractAt('TestIMain', mainAddr)

        // Get core contracts
        assetRegistry = <IAssetRegistry>(
            await ethers.getContractAt('IAssetRegistry', await main.assetRegistry())
        )
        backingManager = <TestIBackingManager>(
            await ethers.getContractAt('TestIBackingManager', await main.backingManager())
        )
        basketHandler = <IBasketHandler>(
            await ethers.getContractAt('IBasketHandler', await main.basketHandler())
        )
        rToken = <TestIRToken>await ethers.getContractAt('TestIRToken', await main.rToken())
        rTokenAsset = <RTokenAsset>(
            await ethers.getContractAt('RTokenAsset', await assetRegistry.toAsset(rToken.address))
        )

        // Setup owner and unpause
        await facadeWrite.connect(owner).setupGovernance(
            rToken.address,
            false, // do not deploy governance
            true, // unpaused
            govParams, // mock values, not relevant
            owner.address, // owner
            ZERO_ADDRESS, // no guardian
            ZERO_ADDRESS // no pauser
        )

        // Setup mock chainlink feed for some of the tests (so we can change the value)
        MockV3AggregatorFactory = await ethers.getContractFactory('MockV3Aggregator')
        mockChainlinkFeed = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn('1e8'))
    })

    describe('Deployment', () => {
        // Check the initial state
        it('Should setup RToken, Assets, and Collateral correctly', async () => {
            // Check Collateral plugin
            // cbEthCollateral
            expect(await cbEthCollateral.isCollateral()).to.equal(true)

            expect(await cbEthCollateral.erc20()).to.equal(cbEth.address)
            expect(await cbEth.decimals()).to.equal(18)
            expect(await cbEthCollateral.targetName()).to.equal(ethers.utils.formatBytes32String('ETH'))
            expect(await cbEthCollateral.refPerTok()).to.be.closeTo(fp('1.01'), fp('0.01'))
            expect(await cbEthCollateral.targetPerRef()).to.equal(fp('1'))
            expect(await cbEthCollateral.pricePerTarget()).to.equal(fp('1859.17')) // for pined block 14916729
            expect(await cbEthCollateral.prevReferencePrice()).to.be.closeTo(
                await cbEthCollateral.refPerTok(),
                fp('11859.17')
            )

            expect(await cbEthCollateral.strictPrice()).to.be.closeTo(fp('1859.17'), fp('100')) // delta 100$

            // Check claim data
            await expect(await cbEthCollateral.claimRewards())
                .to.emit(cbEthCollateral, 'RewardsClaimed')
                .withArgs(cbEth.address, fp('0'))
            expect(await cbEthCollateral.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)

            // Should setup contracts
            expect(main.address).to.not.equal(ZERO_ADDRESS)
        })

        // Check assets/collaterals in the Asset Registry
        it('Should register ERC20s and Assets/Collateral correctly', async () => {
            // Check assets/collateral
            const ERC20s = await assetRegistry.erc20s()
            expect(ERC20s[0]).to.equal(rToken.address)
            expect(ERC20s[1]).to.equal(rsr.address)
            expect(ERC20s[2]).to.equal(cbEth.address)
            expect(ERC20s.length).to.equal(3)

            // Assets
            expect(await assetRegistry.toAsset(ERC20s[0])).to.equal(rTokenAsset.address)
            expect(await assetRegistry.toAsset(ERC20s[1])).to.equal(rsrAsset.address)
            expect(await assetRegistry.toAsset(ERC20s[2])).to.equal(cbEthCollateral.address)

            // Collaterals
            expect(await assetRegistry.toColl(ERC20s[2])).to.equal(cbEthCollateral.address)
        })

        // Check RToken basket
        it('Should register Basket correctly', async () => {
            // Basket
            expect(await basketHandler.fullyCollateralized()).to.equal(true)
            const backing = await facade.basketTokens(rToken.address)
            expect(backing[0]).to.equal(cbEth.address)
            expect(backing.length).to.equal(1)

            // Check other values
            expect(await basketHandler.nonce()).to.be.gt(bn(0))
            expect(await basketHandler.timestamp()).to.be.gt(bn(0))
            expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
            expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(0)
            const [isFallback, price] = await basketHandler.price(true)
            expect(isFallback).to.equal(false)
            // expect(price).to.be.closeTo(fp('1859.17'), fp('0.015'))

            // Check RToken price
            const issueAmount: BigNumber = bn('20000')
            await cbEth.connect(addr1).approve(rToken.address, issueAmount)
            await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')
            expect(await rTokenAsset.strictPrice()).to.be.closeTo(fp('1859.17'), fp('0.015'))
        })

        describe('Issuance/Appreciation/Redemption', () => {
            const MIN_ISSUANCE_PER_BLOCK = bn('10000e18')

            // Issuance and redemption, making the collateral appreciate over time
            it('Should issue, redeem, and handle appreciation rates correctly', async () => {
                const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK // instant issuance

                // Provide approvals for issuances
                await cbEth.connect(addr1).approve(rToken.address, toBNDecimals(issueAmount, 18).mul(100))

                // Issue rTokens
                await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

                // Check RTokens issued to user
                expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

                // Store Balances after issuance
                const balanceAddr1cbEth: BigNumber = await cbEth.balanceOf(addr1.address)

                // Check rates and prices
                const cbEthPrice1: BigNumber = await cbEthCollateral.strictPrice() // ~ 1859.17 USD
                const cbEthRefPerTok1: BigNumber = await cbEthCollateral.refPerTok() // ~ 1859.17 USD

                expect(cbEthPrice1).to.be.closeTo(fp('1859.17'), fp('100'))
                expect(cbEthRefPerTok1).to.be.gt(fp('1'))

                // Check total asset value
                const totalAssetValue1: BigNumber = await facadeTest.callStatic.totalAssetValue(
                    rToken.address
                )
                expect(totalAssetValue1).to.be.closeTo(issueAmount.mul(1860), fp('10000')) // ~  approx 2000K in value

                // Advance time and blocks slightly, causing refPerTok() to increase
                await advanceTime(10000)
                await advanceBlocks(10000)

                // change exchange rate for this block
                const oracle = await cbEth.oracle()
                await whileImpersonating(oracle, async (oracle) => {
                    await cbEth.connect(oracle).updateExchangeRate(fp('1.037'))
                })

                // Refresh cbEthCollateral manually (required)
                await cbEthCollateral.refresh()
                expect(await cbEthCollateral.status()).to.equal(CollateralStatus.SOUND)

                // Check rates and prices - Have changed, slight inrease
                const cbEthPrice2: BigNumber = await cbEthCollateral.strictPrice() // ~1.0354 cents
                const cbEthRefPerTok2: BigNumber = await cbEthCollateral.refPerTok() // ~1.0354 cents

                // Advance time and blocks by 30 days, causing loan to go into WARNING
                await advanceTime(2592000)
                await advanceBlocks(2592000)

                // Refresh cpToken manually (required)
                await cbEthCollateral.refresh()
                // expect(await cbEthCollateral.status()).to.equal(CollateralStatus.IFFY)

                // Check rates and increase
                expect(cbEthRefPerTok2).to.be.gt(cbEthRefPerTok1)

                // Still close to the original values
                expect(cbEthPrice2).to.be.closeTo(fp('1928.82'), fp('10')) // 1860 * 1.037 = 1928.82 USD ~ 2k
                expect(cbEthRefPerTok2).to.be.closeTo(fp('1.035'), fp('0.03'))

                // Check total asset value increased
                const totalAssetValue2: BigNumber = await facadeTest.callStatic.totalAssetValue(
                    rToken.address
                )
                expect(totalAssetValue2).to.be.gt(totalAssetValue1)

                // Refresh cpToken - everything should be fine now
                await cbEthCollateral.refresh()
                expect(await cbEthCollateral.status()).to.equal(CollateralStatus.SOUND)

                // Redeem Rtokens with the updated rates
                await expect(rToken.connect(addr1).redeem(issueAmount)).to.emit(rToken, 'Redemption')

                // Check funds were transferred
                expect(await rToken.balanceOf(addr1.address)).to.equal(0)
                expect(await rToken.totalSupply()).to.equal(0)

                // Check balances - Fewer cpTokens should have been sent to the user
                const newBalanceAddr1cbEth: BigNumber = await cbEth.balanceOf(addr1.address)

                // Check received tokens represent ~10K in value at current prices
                expect(newBalanceAddr1cbEth.sub(balanceAddr1cbEth)).to.be.closeTo(fp('10000'), fp('1000')) // ~1.037 * 9.643 ~= 10K (100% of basket)

                // Check remainders in Backing Manager
                expect(await cbEth.balanceOf(backingManager.address)).to.be.closeTo(fp('320'), fp('1')) // ~=  320  ceth

                //  Check total asset value (remainder)
                expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
                    fp('617222'), // ~= 320 eth * usd/eth * cbeth /eth = 617222 USD
                    fp('1000')
                )
            })

            it('Should mark collateral as DISABLED if the cbEth excahngeRate decreases', async () => {
                await cbEthCollateral.refresh()
                expect(await cbEthCollateral.status()).to.equal(CollateralStatus.SOUND)
                // Advance time by another 100 days, causing loan to go into DEFAULT

                // manualy update exchange rate to a lower value
                const oracle = await cbEth.oracle()
                await whileImpersonating(oracle, async (oracle) => {
                    await cbEth.connect(oracle).updateExchangeRate(fp('1'))
                })
                await advanceTime(8640000)
                await advanceBlocks(8640000)

                await cbEthCollateral.refresh()
                expect(await cbEthCollateral.status()).to.equal(CollateralStatus.DISABLED)
            })
        })

        // Note: Even if the collateral does not provide reward tokens, this test should be performed to check that
        // claiming calls throughout the protocol are handled correctly and do not revert.
        describe('Rewards', () => {
            it('Should be able to claim rewards (if applicable)', async () => {
                // Only checking to see that claim call does not revert
                await expectEvents(backingManager.claimRewards(), [])
            })
        })

        describe('Price Handling', () => {
            it('Should handle invalid/stale Price', async () => {
                // Reverts with a feed with zero price
                const invalidpriceCbEthCollateral: CbEthCollateral = <CbEthCollateral>(
                    await (
                        await ethers.getContractFactory('CbEthCollateral', {
                            libraries: { OracleLib: oracleLib.address },
                        })
                    ).deploy(
                        fp('1'),
                        mockChainlinkFeed.address,
                        cbEth.address,
                        config.rTokenMaxTradeVolume,
                        ORACLE_TIMEOUT,
                        ethers.utils.formatBytes32String('ETH'),
                        delayUntilDefault
                    )
                )
                await setOraclePrice(invalidpriceCbEthCollateral.address, bn(0))
                
                // Reverts with zero price
                await expect(invalidpriceCbEthCollateral.strictPrice()).to.be.revertedWith('PriceOutsideRange()')
                
                // Refresh should mark status IFFY
                await invalidpriceCbEthCollateral.refresh()
                expect(await invalidpriceCbEthCollateral.status()).to.equal(CollateralStatus.IFFY)

                // Reverts with stale price
                await advanceTime(ORACLE_TIMEOUT.toString())
                await expect(cbEthCollateral.strictPrice()).to.be.revertedWith('StalePrice()')

                // Fallback price is returned
                const [isFallback, price] = await cbEthCollateral.price(true)
                expect(isFallback).to.equal(true)
                expect(price).to.equal(fp('1'))

                // Refresh should mark status DISABLED
                await cbEthCollateral.refresh()
                expect(await cbEthCollateral.status()).to.equal(CollateralStatus.IFFY)
                await advanceBlocks(100000)
                await cbEthCollateral.refresh()
                expect(await cbEthCollateral.status()).to.equal(CollateralStatus.DISABLED)

                // ClearpoolToken Collateral with no price
                const nonpriceCpTokenCollateral: CbEthCollateral = <CbEthCollateral>(
                    await (
                        await ethers.getContractFactory('CbEthCollateral', {
                            libraries: { OracleLib: oracleLib.address },
                        })
                    ).deploy(
                        fp('1'),
                        NO_PRICE_DATA_FEED,
                        cbEth.address,
                        config.rTokenMaxTradeVolume,
                        ORACLE_TIMEOUT,
                        ethers.utils.formatBytes32String('ETH'),
                        delayUntilDefault
                    ))

                // Collateral with no price info should revert
                await expect(nonpriceCpTokenCollateral.strictPrice()).to.be.reverted

                expect(await nonpriceCpTokenCollateral.status()).to.equal(CollateralStatus.SOUND)
            })
        })

        // Note: Here the idea is to test all possible statuses and check all possible paths to default
        // soft default = SOUND -> IFFY -> DISABLED due to sustained misbehavior
        // hard default = SOUND -> DISABLED due to an invariant violation
        // This may require to deploy some mocks to be able to force some of these situations
        describe('Collateral Status', () => {
            // Test for soft default
            it.skip('No Updates status in case of soft default because there is no soft reset', async () => {
                // Redeploy plugin using a Chainlink mock feed where we can change the price
                const newcbEthCollateral: CbEthCollateral = <CbEthCollateral>(
                    await (
                        await ethers.getContractFactory('CbEthCollateral', {
                            libraries: { OracleLib: oracleLib.address },
                        })
                    ).deploy(
                        fp('1'),
                        mockChainlinkFeed.address,
                        await cbEthCollateral.erc20(),
                        await cbEthCollateral.maxTradeVolume(),
                        await cbEthCollateral.oracleTimeout(),
                        await cbEthCollateral.targetName(),
                        await cbEthCollateral.delayUntilDefault()
                    ))

                // Check initial state
                expect(await newcbEthCollateral.status()).to.equal(CollateralStatus.SOUND)
                expect(await newcbEthCollateral.whenDefault()).to.equal(MAX_UINT256)

                // Depeg one of the underlying tokens - Reducing price 20%
                await setOraclePrice(newcbEthCollateral.address, fp('8e7')) // -20%

                // Force updates - Should update whenDefault and status
                await expect(newcbEthCollateral.refresh())
                    .to.emit(newcbEthCollateral, 'DefaultStatusChanged')
                    .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
                expect(await newcbEthCollateral.status()).to.equal(CollateralStatus.IFFY)

                const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp()).add(
                    delayUntilDefault
                )
                expect(await newcbEthCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)

                // Move time forward past delayUntilDefault
                await advanceTime(Number(delayUntilDefault))
                expect(await newcbEthCollateral.status()).to.equal(CollateralStatus.DISABLED)

                // Nothing changes if attempt to refresh after default
                // ClearpoolToken
                const prevWhenDefault: BigNumber = await newcbEthCollateral.whenDefault()
                await expect(newcbEthCollateral.refresh()).to.not.emit(
                    newcbEthCollateral,
                    'DefaultStatusChanged'
                )
                expect(await newcbEthCollateral.status()).to.equal(CollateralStatus.DISABLED)
                expect(await newcbEthCollateral.whenDefault()).to.equal(prevWhenDefault)
            })

            // Test for hard default
            it('Updates status in case of hard default', async () => {
                // Note: In this case requires to use a cbEth mock to be able to change the rate
                // to hard default
                const cbEthOracle = (await ethers.getSigners())[3]
                const CbEthMockFactory = await ethers.getContractFactory(
                    'CBEthMock'
                )
                const cbEthMock: CBEthMock = <CBEthMock>(
                    await CbEthMockFactory.deploy(cbEthOracle.address, fp('1'))
                )
                // Set initial exchange rate to the new cbEth Mock
                await cbEthMock.connect(cbEthOracle).updateExchangeRate(fp('1.02'))

                // Redeploy plugin using the new cbEth mock
                const newcbEthCollateral: CbEthCollateral = <CbEthCollateral>await (
                    await ethers.getContractFactory('CbEthCollateral', {
                        libraries: { OracleLib: oracleLib.address },
                    })
                ).deploy(
                    fp('1'),
                    await cbEthCollateral.chainlinkFeed(),
                    cbEthMock.address,
                    await cbEthCollateral.maxTradeVolume(),
                    await cbEthCollateral.oracleTimeout(),
                    await cbEthCollateral.targetName(),
                    await cbEthCollateral.delayUntilDefault()
                )

                // Check initial state
                expect(await newcbEthCollateral.status()).to.equal(CollateralStatus.SOUND)
                expect(await newcbEthCollateral.whenDefault()).to.equal(MAX_UINT256)

                // Decrease rate for cbEth, will disable collateral immediately
                await cbEthMock.connect(cbEthOracle).updateExchangeRate(fp('1.01'))

                // Force updates - Should update whenDefault and status
                await expect(newcbEthCollateral.refresh())
                    .to.emit(newcbEthCollateral, 'DefaultStatusChanged')
                    .withArgs(CollateralStatus.SOUND, CollateralStatus.DISABLED)

                expect(await newcbEthCollateral.status()).to.equal(CollateralStatus.DISABLED)
                const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp())
                expect(await newcbEthCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)
            })

            it('Reverts if oracle reverts or runs out of gas, maintains status', async () => {
                const InvalidMockV3AggregatorFactory = await ethers.getContractFactory(
                    'InvalidMockV3Aggregator'
                )
                const invalidChainlinkFeed: InvalidMockV3Aggregator = <InvalidMockV3Aggregator>(
                    await InvalidMockV3AggregatorFactory.deploy(8, bn('1e8'))
                )

                const invalidCbEthCollateral: CbEthCollateral = <CbEthCollateral>(
                    await cbEthCollateralFactory.deploy(
                        fp('1'),
                        invalidChainlinkFeed.address,
                        await cbEthCollateral.erc20(),
                        await cbEthCollateral.maxTradeVolume(),
                        await cbEthCollateral.oracleTimeout(),
                        await cbEthCollateral.targetName(),
                        await cbEthCollateral.delayUntilDefault()
                    )
                )

                // Reverting with no reason
                await invalidChainlinkFeed.setSimplyRevert(true)
                await expect(invalidCbEthCollateral.refresh()).to.be.revertedWith('')
                expect(await invalidCbEthCollateral.status()).to.equal(CollateralStatus.SOUND)

                // Runnning out of gas (same error)
                await invalidChainlinkFeed.setSimplyRevert(false)
                await expect(invalidCbEthCollateral.refresh()).to.be.revertedWith('')
                expect(await invalidCbEthCollateral.status()).to.equal(CollateralStatus.SOUND)
            })
        })
    })
})