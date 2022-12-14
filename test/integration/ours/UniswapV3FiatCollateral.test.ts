import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { expect } from "chai"
import { BigNumber, BigNumberish, ContractFactory, Wallet } from "ethers"
import hre, { ethers, waffle } from "hardhat"
import { IMPLEMENTATION } from "../../fixtures"
import { defaultFixture, ORACLE_TIMEOUT } from "../individual-collateral/fixtures"
import { getChainId } from "../../../common/blockchain-utils"
import {
    IConfig,
    IGovParams,
    IRevenueShare,
    IRTokenConfig,
    IRTokenSetup,
    networkConfig,
} from "../../../common/configuration"
import { CollateralStatus, MAX_UINT256, ZERO_ADDRESS } from "../../../common/constants"
import { expectEvents, expectInIndirectReceipt } from "../../../common/events"
import { bn, fp, pow10, toBNDecimals } from "../../../common/numbers"
import { whileImpersonating } from "../../utils/impersonation"
import { setOraclePrice } from "../../utils/oracles"
import { advanceBlocks, advanceTime, getLatestBlockTimestamp } from "../../utils/time"
import {
    Asset,
    ComptrollerMock,
    UniswapV3UsdCollateral,
    CTokenMock,
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
    USDCMock,
    UniswapV3Wrapper,
    UniswapV3UsdCollateral__factory,
} from "../../../typechain"
import { useEnv } from "#/utils/env"
import {
    defaultMintParams,
    deployUniswapV3Wrapper,
    holderDAI,
    holderUSDC,
    holderUSDT,
    sendTokenAs,
    sortedTokens,
    TMintParams,
} from "./common"

const createFixtureLoader = waffle.createFixtureLoader

const NO_PRICE_DATA_FEED = "0x51597f405303C4377E36123cBc172b13269EA163"

const describeFork = useEnv("FORK") ? describe : describe.skip

describeFork(`UniswapV3UsdCollateral - Mainnet Forking P${IMPLEMENTATION}`, function () {
    let owner: SignerWithAddress
    let addr1: SignerWithAddress

    // Tokens/Assets
    let uniswapV3Wrapper: UniswapV3Wrapper
    let uniswapV3UsdCollateral: UniswapV3UsdCollateral
    let compToken: ERC20Mock
    let compAsset: Asset
    let comptroller: ComptrollerMock
    let rsr: ERC20Mock
    let rsrAsset: Asset

    // Tokens and Assets
    let dai: ERC20Mock
    let usdc: USDCMock
    let usdt: USDCMock
    let asset0: ERC20Mock | USDCMock
    let asset1: ERC20Mock | USDCMock
    const setTokens = (t0: ERC20Mock | USDCMock, t1: ERC20Mock | USDCMock) => {
        const [a0, a1] = sortedTokens(t0, t1)
        asset0 = a0
        asset1 = a1
    }

    let ofDai: (amount: BigNumberish) => BigNumber
    let ofUsdc: (amount: BigNumberish) => BigNumber
    let ofUsdt: (amount: BigNumberish) => BigNumber

    let ofTokenMap: { [id: string]: (amount: BigNumberish) => BigNumber }
    const ofToken = (token: ERC20Mock | USDCMock) => ofTokenMap[token.address]
    const ofAsset0 = (amount: BigNumberish) => ofToken(asset0)(amount)
    const ofAsset1 = (amount: BigNumberish) => ofToken(asset1)(amount)

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
        minTradeVolume: fp("1e4"), // $10k
        rTokenMaxTradeVolume: fp("1e6"), // $1M
        shortFreeze: bn("259200"), // 3 days
        longFreeze: bn("2592000"), // 30 days
        rewardPeriod: bn("604800"), // 1 week
        rewardRatio: fp("0.02284"), // approx. half life of 30 pay periods
        unstakingDelay: bn("1209600"), // 2 weeks
        tradingDelay: bn("0"), // (the delay _after_ default has been confirmed)
        auctionLength: bn("900"), // 15 minutes
        backingBuffer: fp("0.0001"), // 0.01%
        maxTradeSlippage: fp("0.01"), // 1%
        issuanceRate: fp("0.00025"), // 0.025% per block or ~0.1% per minute
        scalingRedemptionRate: fp("0.05"), // 5%
        redemptionRateFloor: fp("1e6"), // 1M RToken
    }

    const defaultThreshold = fp("0.05") // 5%
    const delayUntilDefault = bn("86400") // 24h

    let initialBal: BigNumber

    let loadFixture: ReturnType<typeof createFixtureLoader>
    let wallet: Wallet

    let chainId: number

    let uniswapV3UsdCollateralContractFactory: UniswapV3UsdCollateral__factory
    let MockV3AggregatorFactory: ContractFactory
    let mockChainlinkFeed0: MockV3Aggregator
    let mockChainlinkFeed1: MockV3Aggregator

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
        ;({ rsr, rsrAsset, deployer, facade, facadeTest, facadeWrite, oracleLib, govParams } =
            await loadFixture(defaultFixture))

        // Get required contracts for uniswapV3Wrapper
        // COMP token
        compToken = <ERC20Mock>(
            await ethers.getContractAt("ERC20Mock", networkConfig[chainId].tokens.COMP || "")
        )
        // Compound Comptroller
        comptroller = await ethers.getContractAt(
            "ComptrollerMock",
            networkConfig[chainId].COMPTROLLER || ""
        )
        // DAI token
        dai = <ERC20Mock>(
            await ethers.getContractAt("ERC20Mock", networkConfig[chainId].tokens.DAI || "")
        )

        // DAI token
        usdc = <ERC20Mock>(
            await ethers.getContractAt("ERC20Mock", networkConfig[chainId].tokens.USDC || "")
        )

        // Setup balances for addr1 - Transfer from Mainnet holder
        initialBal = bn("2000000")

        dai = await ethers.getContractAt("ERC20Mock", networkConfig[chainId].tokens.DAI!)
        const daiDecimals = await dai.decimals()
        ofDai = (amount: BigNumberish) => pow10(daiDecimals).mul(amount)
        await sendTokenAs(dai, holderDAI, addr1, ofDai(initialBal))
        await sendTokenAs(dai, holderDAI, owner, ofDai(initialBal))

        usdc = await ethers.getContractAt("ERC20Mock", networkConfig[chainId].tokens.USDC!)
        const usdcDecimals = await usdc.decimals()
        ofUsdc = (amount: BigNumberish) => pow10(usdcDecimals).mul(amount)
        await sendTokenAs(usdc, holderUSDC, addr1, ofUsdc(initialBal))
        await sendTokenAs(usdc, holderUSDC, owner, ofUsdc(initialBal))

        usdt = await ethers.getContractAt("ERC20Mock", networkConfig[chainId].tokens.USDT || "")
        const usdtDecimals = await usdt.decimals()
        ofUsdt = (amount: BigNumberish) => pow10(usdtDecimals).mul(amount)
        await sendTokenAs(usdt, holderUSDT, addr1, ofUsdt(initialBal))
        await sendTokenAs(usdt, holderUSDT, owner, ofUsdt(initialBal))

        ofTokenMap = {
            [dai.address]: ofDai,
            [usdc.address]: ofUsdc,
            [usdt.address]: ofUsdt,
        }

        setTokens(dai, usdc)

        // Create COMP asset
        compAsset = <Asset>(
            await (
                await ethers.getContractFactory("Asset")
            ).deploy(
                fp("1"),
                networkConfig[chainId].chainlinkFeeds.COMP || "",
                compToken.address,
                config.rTokenMaxTradeVolume,
                ORACLE_TIMEOUT
            )
        )

        // Deploy uniswapV3Wrapper collateral plugin
        uniswapV3UsdCollateralContractFactory = await ethers.getContractFactory(
            "UniswapV3UsdCollateral",
            {
                libraries: { OracleLib: oracleLib.address },
            }
        )

        const MockV3AggregatorFactory = (
            await ethers.getContractFactory("MockV3Aggregator")
        ).connect(owner)
        mockChainlinkFeed0 = await MockV3AggregatorFactory.deploy(8, bn("1e8"))
        mockChainlinkFeed1 = await MockV3AggregatorFactory.deploy(8, bn("1e8"))

        const mintParams0: TMintParams = await defaultMintParams(
            asset0,
            asset1,
            ofToken(asset0)(100000),
            ofToken(asset1)(100000)
        )

        uniswapV3Wrapper = await deployUniswapV3Wrapper(asset0, asset1, owner, mintParams0, addr1)

        const fallbackPrice = fp("1")
        uniswapV3UsdCollateral = await uniswapV3UsdCollateralContractFactory.deploy(
            fallbackPrice,
            fallbackPrice,
            mockChainlinkFeed0.address,
            mockChainlinkFeed1.address,
            uniswapV3Wrapper.address,
            config.rTokenMaxTradeVolume,
            ORACLE_TIMEOUT,
            ethers.utils.formatBytes32String("USD"),
            defaultThreshold,
            100,
            delayUntilDefault
        )

        // uniswapV3UsdCollateral = <UniswapV3UsdCollateral>(
        //     await uniswapV3UsdCollateralContractFactory.deploy(
        //         fp("0.02"),
        //         networkConfig[chainId].chainlinkFeeds.DAI as string,
        //         uniswapV3Wrapper.address,
        //         config.rTokenMaxTradeVolume,
        //         ORACLE_TIMEOUT,
        //         ethers.utils.formatBytes32String("USD"),
        //         defaultThreshold,
        //         delayUntilDefault,
        //         (await dai.decimals()).toString(),
        //         comptroller.address
        //     )
        // )

        // Set parameters
        const rTokenConfig: IRTokenConfig = {
            name: "RTKN RToken",
            symbol: "RTKN",
            mandate: "mandate",
            params: config,
        }

        // Set primary basket
        const rTokenSetup: IRTokenSetup = {
            assets: [compAsset.address],
            primaryBasket: [uniswapV3UsdCollateral.address],
            weights: [fp("1")],
            backups: [],
            beneficiaries: [],
        }

        // Deploy RToken via FacadeWrite
        const receipt = await (
            await facadeWrite.connect(owner).deployRToken(rTokenConfig, rTokenSetup)
        ).wait()

        // Get Main
        const mainAddr = expectInIndirectReceipt(receipt, deployer.interface, "RTokenCreated").args
            .main
        main = <TestIMain>await ethers.getContractAt("TestIMain", mainAddr)

        // Get core contracts
        assetRegistry = <IAssetRegistry>(
            await ethers.getContractAt("IAssetRegistry", await main.assetRegistry())
        )
        backingManager = <TestIBackingManager>(
            await ethers.getContractAt("TestIBackingManager", await main.backingManager())
        )
        basketHandler = <IBasketHandler>(
            await ethers.getContractAt("IBasketHandler", await main.basketHandler())
        )
        rToken = <TestIRToken>await ethers.getContractAt("TestIRToken", await main.rToken())
        rTokenAsset = <RTokenAsset>(
            await ethers.getContractAt("RTokenAsset", await assetRegistry.toAsset(rToken.address))
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

        mockChainlinkFeed0 = <MockV3Aggregator>await MockV3AggregatorFactory.deploy(8, bn("1e8"))
    })

    describe("Deployment", () => {
        // Check the initial state
        it("Should setup RToken, Assets, and Collateral correctly", async () => {
            // Check Rewards assets (if applies)
            // COMP Asset
            expect(await compAsset.isCollateral()).to.equal(false)
            expect(await compAsset.erc20()).to.equal(compToken.address)
            expect(await compAsset.erc20()).to.equal(networkConfig[chainId].tokens.COMP)
            expect(await compToken.decimals()).to.equal(18)
            expect(await compAsset.strictPrice()).to.be.closeTo(fp("58"), fp("0.5")) // Close to $58 USD - June 2022
            await expect(compAsset.claimRewards()).to.not.emit(compAsset, "RewardsClaimed")
            expect(await compAsset.maxTradeVolume()).to.equal(config.rTokenMaxTradeVolume)

            // Check Collateral plugin
            // uniswapV3Wrapper (UniswapV3UsdCollateral)
            expect(await uniswapV3UsdCollateral.isCollateral()).to.equal(true)
            expect(await uniswapV3UsdCollateral.erc20()).to.equal(uniswapV3Wrapper.address)
            expect(await uniswapV3Wrapper.decimals()).to.equal(18)
            expect(await uniswapV3UsdCollateral.targetName()).to.equal(
                ethers.utils.formatBytes32String("USD")
            )
            // Should setup contracts
            expect(main.address).to.not.equal(ZERO_ADDRESS)
        })

        // Check assets/collaterals in the Asset Registry
        it("Should register ERC20s and Assets/Collateral correctly", async () => {
            // Check assets/collateral
            const ERC20s = await assetRegistry.erc20s()
            expect(ERC20s[0]).to.equal(rToken.address)
            expect(ERC20s[1]).to.equal(rsr.address)
            expect(ERC20s[2]).to.equal(compToken.address)
            expect(ERC20s[3]).to.equal(uniswapV3Wrapper.address)
            expect(ERC20s.length).to.eql(4)

            // Assets
            expect(await assetRegistry.toAsset(ERC20s[0])).to.equal(rTokenAsset.address)
            expect(await assetRegistry.toAsset(ERC20s[1])).to.equal(rsrAsset.address)
            expect(await assetRegistry.toAsset(ERC20s[2])).to.equal(compAsset.address)
            expect(await assetRegistry.toAsset(ERC20s[3])).to.equal(uniswapV3UsdCollateral.address)

            // Collaterals
            expect(await assetRegistry.toColl(ERC20s[3])).to.equal(uniswapV3UsdCollateral.address)
        })

        // Check RToken basket
        it("Should register Basket correctly", async () => {
            // Basket
            expect(await basketHandler.fullyCollateralized()).to.equal(true)
            const backing = await facade.basketTokens(rToken.address)
            expect(backing[0]).to.equal(uniswapV3Wrapper.address)
            expect(backing.length).to.equal(1)

            // Check other values
            expect(await basketHandler.nonce()).to.be.gt(bn(0))
            expect(await basketHandler.timestamp()).to.be.gt(bn(0))
            expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
            expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(0)
            const [isFallback, price] = await basketHandler.price(true)
            expect(isFallback).to.equal(false)
            expect(price).to.be.closeTo(fp("1"), fp("0.015"))

            // Check RToken price
            const issueAmount: BigNumber = bn("10000e18")
            await uniswapV3Wrapper.connect(addr1).approve(rToken.address, issueAmount.mul(100))
            await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, "Issuance")
            expect(await rTokenAsset.strictPrice()).to.be.closeTo(fp("1"), fp("0.015"))
        })
    })

    describe("Issuance/Appreciation/Redemption", () => {
        const MIN_ISSUANCE_PER_BLOCK = bn("10000e18")

        // Issuance and redemption, making the collateral appreciate over time
        it("Should issue, redeem, and handle appreciation rates correctly", async () => {
            const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK // instant issuance

            // Provide approvals for issuances
            await uniswapV3Wrapper.connect(addr1).approve(rToken.address, issueAmount.mul(100))

            // Issue rTokens
            await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, "Issuance")

            // Check RTokens issued to user
            expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

            // Store Balances after issuance
            const balanceAddr1cDai: BigNumber = await uniswapV3Wrapper.balanceOf(addr1.address)

            // Check rates and prices
            const cDaiPrice1: BigNumber = await uniswapV3UsdCollateral.strictPrice()
            const cDaiRefPerTok1: BigNumber = await uniswapV3UsdCollateral.refPerTok()

            // Check total asset value
            const totalAssetValue1: BigNumber = await facadeTest.callStatic.totalAssetValue(
                rToken.address
            )
            expect(totalAssetValue1).to.be.closeTo(issueAmount, fp("150")) // approx 10K in value

            // Advance time and blocks slightly, causing refPerTok() to increase
            await advanceTime(10000)
            await advanceBlocks(10000)

            // Refresh cToken manually (required)
            await uniswapV3UsdCollateral.refresh()
            expect(await uniswapV3UsdCollateral.status()).to.equal(CollateralStatus.SOUND)

            // Check rates and prices - Have changed, slight inrease
            const cDaiPrice2: BigNumber = await uniswapV3UsdCollateral.strictPrice()
            const cDaiRefPerTok2: BigNumber = await uniswapV3UsdCollateral.refPerTok()

            // Check rates and price increase
            expect(cDaiPrice2).to.be.gte(cDaiPrice1)
            expect(cDaiRefPerTok2).to.be.gte(cDaiRefPerTok1)

            // Check total asset value increased
            const totalAssetValue2: BigNumber = await facadeTest.callStatic.totalAssetValue(
                rToken.address
            )
            expect(totalAssetValue2).to.be.gte(totalAssetValue1)

            // Advance time and blocks slightly, causing refPerTok() to increase
            await advanceTime(100000000)
            await advanceBlocks(100000000)

            // Refresh cToken manually (required)
            await uniswapV3UsdCollateral.refresh()
            expect(await uniswapV3UsdCollateral.status()).to.equal(CollateralStatus.SOUND)

            // Check rates and prices - Have changed significantly
            const cDaiPrice3: BigNumber = await uniswapV3UsdCollateral.strictPrice()
            const cDaiRefPerTok3: BigNumber = await uniswapV3UsdCollateral.refPerTok()

            // Check rates and price increase
            expect(cDaiPrice3).to.be.gte(cDaiPrice2)
            expect(cDaiRefPerTok3).to.be.gte(cDaiRefPerTok2)

            // Check total asset value increased
            const totalAssetValue3: BigNumber = await facadeTest.callStatic.totalAssetValue(
                rToken.address
            )
            expect(totalAssetValue3).to.be.gte(totalAssetValue2)

            // Redeem Rtokens with the updated rates
            await expect(rToken.connect(addr1).redeem(issueAmount)).to.emit(rToken, "Redemption")

            // Check funds were transferred
            expect(await rToken.balanceOf(addr1.address)).to.equal(0)
            expect(await rToken.totalSupply()).to.equal(0)

            // Check balances - Fewer cTokens should have been sent to the user
            const newBalanceAddr1cDai: BigNumber = await uniswapV3Wrapper.balanceOf(addr1.address)

            // Check received tokens represent ~10K in value at current prices
            expect(newBalanceAddr1cDai.sub(balanceAddr1cDai)).to.be.closeTo(
                bn("50000000e8"),
                bn("8e7")
            )

            // Check remainders in Backing Manager
            expect(await uniswapV3Wrapper.balanceOf(backingManager.address)).to.be.closeTo(
                bn(0),
                bn("5e7")
            )

            //  Check total asset value (remainder)
            expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
                fp(0),
                fp("0.5")
            )
        })
    })

    // Note: Even if the collateral does not provide reward tokens, this test should be performed to check that
    // claiming calls throughout the protocol are handled correctly and do not revert.
    describe("Rewards", () => {
        it("Should be able to claim rewards (if applicable)", async () => {
            const MIN_ISSUANCE_PER_BLOCK = bn("10000e18")
            const issueAmount: BigNumber = MIN_ISSUANCE_PER_BLOCK

            // Try to claim rewards at this point - Nothing for Backing Manager
            expect(await compToken.balanceOf(backingManager.address)).to.equal(0)

            // No emit event if zero rewards
            // await expectEvents(backingManager.claimRewards(), [
            //     {
            //         contract: backingManager,
            //         name: "RewardsClaimed",
            //         args: [compToken.address, bn(0)],
            //         emitted: true,
            //     },
            // ])

            // No rewards so far
            expect(await compToken.balanceOf(backingManager.address)).to.equal(0)

            // Provide approvals for issuances
            await uniswapV3Wrapper.connect(addr1).approve(rToken.address, issueAmount.mul(100))

            // Issue rTokens
            await expect(rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, "Issuance")

            // Check RTokens issued to user
            expect(await rToken.balanceOf(addr1.address)).to.equal(issueAmount)

            // Now we can claim rewards - check initial balance still 0
            expect(await compToken.balanceOf(backingManager.address)).to.equal(0)

            // Advance Time
            await advanceTime(8000)

            await backingManager.claimRewards()
            // Claim rewards
            // await expect(backingManager.claimRewards()).to.emit(backingManager, "RewardsClaimed")

            const rewardsDAI: BigNumber = await dai.balanceOf(backingManager.address)

            expect(rewardsDAI).to.be.gte(0)

            // Keep moving time
            await advanceTime(3600)

            await backingManager.claimRewards()
            // Get additional rewards
            // await expect(backingManager.claimRewards()).to.emit(backingManager, "RewardsClaimed")

            const DAI: BigNumber = await compToken.balanceOf(backingManager.address)

            expect(DAI.sub(rewardsDAI)).to.be.gte(0)
        })
    })

    describe("Price Handling", () => {
        it("Should handle invalid/stale Price", async () => {
            // Reverts with stale price
            await advanceTime(ORACLE_TIMEOUT.toString())

            // Compound
            await expect(uniswapV3UsdCollateral.strictPrice()).to.be.revertedWith("StalePrice()")

            // Fallback price is returned
            const [isFallback, price] = await uniswapV3UsdCollateral.price(true)
            expect(isFallback).to.equal(true)
            expect(price).to.equal(fp("1"))

            // Refresh should mark status IFFY
            await uniswapV3UsdCollateral.refresh()
            expect(await uniswapV3UsdCollateral.status()).to.equal(CollateralStatus.IFFY)

            // CTokens Collateral with no price
            const fallbackPrice = fp("1")
            const nonpriceCtokenCollateral: UniswapV3UsdCollateral = <UniswapV3UsdCollateral>await (
                await ethers.getContractFactory("UniswapV3UsdCollateral", {
                    libraries: { OracleLib: oracleLib.address },
                })
            ).deploy(
                fallbackPrice,
                fallbackPrice,
                NO_PRICE_DATA_FEED,
                mockChainlinkFeed1.address,
                uniswapV3Wrapper.address,
                config.rTokenMaxTradeVolume,
                ORACLE_TIMEOUT,
                ethers.utils.formatBytes32String("USD"),
                defaultThreshold,
                100,
                delayUntilDefault
            )

            // CTokens - Collateral with no price info should revert
            await expect(nonpriceCtokenCollateral.strictPrice()).to.be.reverted

            // Refresh should also revert - status is not modified
            await expect(nonpriceCtokenCollateral.refresh()).to.be.reverted
            expect(await nonpriceCtokenCollateral.status()).to.equal(CollateralStatus.SOUND)

            // Reverts with a feed with zero price
            const invalidpriceCtokenCollateral: UniswapV3UsdCollateral = <UniswapV3UsdCollateral>(
                await (
                    await ethers.getContractFactory("UniswapV3UsdCollateral", {
                        libraries: { OracleLib: oracleLib.address },
                    })
                ).deploy(
                  fallbackPrice,
                  fallbackPrice,
                  mockChainlinkFeed0.address,
                  mockChainlinkFeed1.address,
                  uniswapV3Wrapper.address,
                  config.rTokenMaxTradeVolume,
                  ORACLE_TIMEOUT,
                  ethers.utils.formatBytes32String("USD"),
                  defaultThreshold,
                  100,
                  delayUntilDefault
              )
            )

            await setOraclePrice(invalidpriceCtokenCollateral.address, bn(0))

            // Reverts with zero price
            await expect(invalidpriceCtokenCollateral.strictPrice()).to.be.revertedWith(
                "PriceOutsideRange()"
            )

            // Refresh should mark status IFFY
            await invalidpriceCtokenCollateral.refresh()
            expect(await invalidpriceCtokenCollateral.status()).to.equal(CollateralStatus.IFFY)
        })
    })

    // Note: Here the idea is to test all possible statuses and check all possible paths to default
    // soft default = SOUND -> IFFY -> DISABLED due to sustained misbehavior
    // hard default = SOUND -> DISABLED due to an invariant violation
    // This may require to deploy some mocks to be able to force some of these situations
    describe("Collateral Status", () => {
        // Test for soft default
        it("Updates status in case of soft default", async () => {
            // Redeploy plugin using a Chainlink mock feed where we can change the price
            const fallbackPrice = fp("1")
            const newUniswapV3UsdCollateral: UniswapV3UsdCollateral = <UniswapV3UsdCollateral>await (
                await ethers.getContractFactory("UniswapV3UsdCollateral", {
                    libraries: { OracleLib: oracleLib.address },
                })
            ).deploy(
              fallbackPrice,
              fallbackPrice,
              mockChainlinkFeed0.address,
              mockChainlinkFeed1.address,
              uniswapV3Wrapper.address,
              config.rTokenMaxTradeVolume,
              ORACLE_TIMEOUT,
              ethers.utils.formatBytes32String("USD"),
              defaultThreshold,
              100,
              delayUntilDefault
          )

            // Check initial state
            expect(await newUniswapV3UsdCollateral.status()).to.equal(CollateralStatus.SOUND)
            expect(await newUniswapV3UsdCollateral.whenDefault()).to.equal(MAX_UINT256)

            // Depeg one of the underlying tokens - Reducing price 20%
            await setOraclePrice(newUniswapV3UsdCollateral.address, bn("8e7")) // -20%

            // Force updates - Should update whenDefault and status
            await expect(newUniswapV3UsdCollateral.refresh())
                .to.emit(newUniswapV3UsdCollateral, "CollateralStatusChanged")
                .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
            expect(await newUniswapV3UsdCollateral.status()).to.equal(CollateralStatus.IFFY)

            const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp()).add(
                delayUntilDefault
            )
            expect(await newUniswapV3UsdCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)

            // Move time forward past delayUntilDefault
            await advanceTime(Number(delayUntilDefault))
            expect(await newUniswapV3UsdCollateral.status()).to.equal(CollateralStatus.DISABLED)

            // Nothing changes if attempt to refresh after default
            // CToken
            const prevWhenDefault: BigNumber = await newUniswapV3UsdCollateral.whenDefault()
            await expect(newUniswapV3UsdCollateral.refresh()).to.not.emit(
                newUniswapV3UsdCollateral,
                "CollateralStatusChanged"
            )
            expect(await newUniswapV3UsdCollateral.status()).to.equal(CollateralStatus.DISABLED)
            expect(await newUniswapV3UsdCollateral.whenDefault()).to.equal(prevWhenDefault)
        })

        // Test for hard default
        // it("Updates status in case of hard default", async () => {
        //     // Note: In this case requires to use a CToken mock to be able to change the rate
        //     const CTokenMockFactory: ContractFactory = await ethers.getContractFactory("CTokenMock")
        //     const symbol = await uniswapV3Wrapper.symbol()
        //     const cDaiMock: CTokenMock = <CTokenMock>(
        //         await CTokenMockFactory.deploy(symbol + " Token", symbol, dai.address)
        //     )
        //     // Set initial exchange rate to the new uniswapV3Wrapper Mock
        //     await cDaiMock.setExchangeRate(fp("0.02"))

        //     // Redeploy plugin using the new uniswapV3Wrapper mock
        //     const fallbackPrice = fp("1")
        //     const newUniswapV3UsdCollateral: UniswapV3UsdCollateral = <UniswapV3UsdCollateral>await (
        //         await ethers.getContractFactory("UniswapV3UsdCollateral", {
        //             libraries: { OracleLib: oracleLib.address },
        //         })
        //     ).deploy(
        //       fallbackPrice,
        //       fallbackPrice,
        //       cDaiMock.address,
        //       mockChainlinkFeed1.address,
        //       uniswapV3Wrapper.address,
        //       config.rTokenMaxTradeVolume,
        //       ORACLE_TIMEOUT,
        //       ethers.utils.formatBytes32String("USD"),
        //       defaultThreshold,
        //       100,
        //       delayUntilDefault
        //   )

        //     // Check initial state
        //     expect(await newUniswapV3UsdCollateral.status()).to.equal(CollateralStatus.SOUND)
        //     expect(await newUniswapV3UsdCollateral.whenDefault()).to.equal(MAX_UINT256)

        //     // Decrease rate for uniswapV3Wrapper, will disable collateral immediately
        //     await cDaiMock.setExchangeRate(fp("0.019"))

        //     // Force updates - Should update whenDefault and status for Atokens/CTokens
        //     await expect(newUniswapV3UsdCollateral.refresh())
        //         .to.emit(newUniswapV3UsdCollateral, "CollateralStatusChanged")
        //         .withArgs(CollateralStatus.SOUND, CollateralStatus.DISABLED)

        //     expect(await newUniswapV3UsdCollateral.status()).to.equal(CollateralStatus.DISABLED)
        //     const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp())
        //     expect(await newUniswapV3UsdCollateral.whenDefault()).to.equal(expectedDefaultTimestamp)
        // })

        it("Reverts if oracle reverts or runs out of gas, maintains status", async () => {
            const InvalidMockV3AggregatorFactory = await ethers.getContractFactory(
                "InvalidMockV3Aggregator"
            )
            const invalidChainlinkFeed: InvalidMockV3Aggregator = <InvalidMockV3Aggregator>(
                await InvalidMockV3AggregatorFactory.deploy(8, bn("1e8"))
            )

            const fallbackPrice = fp("1")
            const invalidCTokenCollateral: UniswapV3UsdCollateral = <UniswapV3UsdCollateral>(
                await uniswapV3UsdCollateralContractFactory.deploy(
                  fallbackPrice,
                  fallbackPrice,
                  invalidChainlinkFeed.address,
                  mockChainlinkFeed1.address,
                  uniswapV3Wrapper.address,
                  config.rTokenMaxTradeVolume,
                  ORACLE_TIMEOUT,
                  ethers.utils.formatBytes32String("USD"),
                  defaultThreshold,
                  100,
                  delayUntilDefault
              )
            )

            // Reverting with no reason
            await invalidChainlinkFeed.setSimplyRevert(true)
            await expect(invalidCTokenCollateral.refresh()).to.be.revertedWith("")
            expect(await invalidCTokenCollateral.status()).to.equal(CollateralStatus.SOUND)

            // Runnning out of gas (same error)
            await invalidChainlinkFeed.setSimplyRevert(false)
            await expect(invalidCTokenCollateral.refresh()).to.be.revertedWith("")
            expect(await invalidCTokenCollateral.status()).to.equal(CollateralStatus.SOUND)
        })
    })
})
