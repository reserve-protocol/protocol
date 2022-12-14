import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { BigNumberish, Wallet } from "ethers"
import hre, { ethers, waffle } from "hardhat"
import { defaultFixture, IMPLEMENTATION } from "../../../fixtures"
import { getChainId } from "../../../../common/blockchain-utils"
import { networkConfig } from "../../../../common/configuration"
import { bn, fp, pow10 } from "../../../../common/numbers"
import {
    ERC20Mock,
    MockV3Aggregator,
    USDCMock,
    IUniswapV2Router02,
    IUniswapV2Factory,
    IUniswapV2Pair,
    UniswapV2FiatCollateral__factory,
    UniswapV2FiatCollateral,
    OracleLib,
} from "../../../../typechain"
import { whileImpersonating } from "../../../utils/impersonation"
import { waitForTx } from "../../utils"
import { expect } from "chai"
import { CollateralStatus, MAX_UINT256 } from "../../../../common/constants"
import { UniswapV2NonFiatCollateral__factory } from "@typechain/factories/UniswapV2NonFiatCollateral__factory"
import { UniswapV2NonFiatCollateral } from "@typechain/UniswapV2NonFiatCollateral"
import { getLatestBlockTimestamp } from "../../../utils/time"
import { closeDeadline, sqrt } from "../common"

const createFixtureLoader = waffle.createFixtureLoader

// Relevant addresses (Mainnet)
const holderDAI = "0x16b34ce9a6a6f7fc2dd25ba59bf7308e7b38e186"
const holderUSDT = "0xf977814e90da44bfa03b6295a0616a897441acec"
const holderUSDC = "0x0a59649758aa4d66e25f08dd01271e891fe52199"

const UniswapV2Router02address = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D"

const describeFork = process.env.FORK ? describe : describe.skip
describeFork(`UniswapV2Plugin - Integration - Mainnet Forking P${IMPLEMENTATION}`, function () {
    const initialBal = 20000
    let owner: SignerWithAddress
    let addr1: SignerWithAddress
    let addr2: SignerWithAddress

    let oracleLib: OracleLib

    let router: IUniswapV2Router02
    let factory: IUniswapV2Factory

    // Tokens and Assets
    let dai: ERC20Mock
    let usdc: USDCMock
    let usdt: USDCMock

    let loadFixture: ReturnType<typeof createFixtureLoader>
    let wallet: Wallet

    let chainId: number

    describe("Assets/Collateral", () => {
        before(async () => {
            ;[wallet] = (await ethers.getSigners()) as unknown as Wallet[]
            loadFixture = createFixtureLoader([wallet])

            chainId = await getChainId(hre)
            if (!networkConfig[chainId]) {
                throw new Error(`Missing network configuration for ${hre.network.name}`)
            }

            router = <IUniswapV2Router02>(
                await ethers.getContractAt("IUniswapV2Router02", UniswapV2Router02address)
            )
            let factoryAddress = await router.factory()
            factory = <IUniswapV2Factory>(
                await ethers.getContractAt("IUniswapV2Factory", factoryAddress)
            )
            // console.log(factoryAddress, factory)
        })

        beforeEach(async () => {
            ;[owner, , addr1, addr2] = await ethers.getSigners()
            ;({ oracleLib } = await loadFixture(defaultFixture))

            dai = <ERC20Mock>(
                await ethers.getContractAt("ERC20Mock", networkConfig[chainId].tokens.DAI!)
            )
            await whileImpersonating(holderDAI, async (daiSigner) => {
                const decimals = await dai.decimals()
                const p = (value: BigNumberish) => pow10(decimals).mul(value)
                await dai.connect(daiSigner).transfer(addr1.address, p(initialBal))
            })
            usdc = <USDCMock>(
                await ethers.getContractAt("ERC20Mock", networkConfig[chainId].tokens.USDC!)
            )
            await whileImpersonating(holderUSDC, async (usdcSigner) => {
                const decimals = await usdc.decimals()
                const p = (value: BigNumberish) => pow10(decimals).mul(value)
                await usdc.connect(usdcSigner).transfer(addr1.address, p(initialBal))
            })
            usdt = <USDCMock>(
                await ethers.getContractAt("ERC20Mock", networkConfig[chainId].tokens.USDT || "")
            )
            await whileImpersonating(holderUSDT, async (usdtSigner) => {
                const decimals = await usdt.decimals()
                const p = (value: BigNumberish) => pow10(decimals).mul(value)
                await usdt.connect(usdtSigner).transfer(addr1.address, p(initialBal))
            })
            dai = <ERC20Mock>(
                await ethers.getContractAt("ERC20Mock", networkConfig[chainId].tokens.DAI!)
            )
            await whileImpersonating(holderDAI, async (daiSigner) => {
                const decimals = await dai.decimals()
                const p = (value: BigNumberish) => pow10(decimals).mul(value)
                await dai.connect(daiSigner).transfer(owner.address, p(initialBal))
            })
            usdc = <USDCMock>(
                await ethers.getContractAt("ERC20Mock", networkConfig[chainId].tokens.USDC!)
            )
            await whileImpersonating(holderUSDC, async (usdcSigner) => {
                const decimals = await usdc.decimals()
                const p = (value: BigNumberish) => pow10(decimals).mul(value)
                await usdc.connect(usdcSigner).transfer(owner.address, p(initialBal))
            })
        })

        it("U2C non fiat can be deployed", async () => {
            const asset0 = usdt
            const asset1 = usdc

            const decimals0 = await asset0.decimals()
            const decimals1 = await asset1.decimals()

            const p0 = (value: BigNumberish) => pow10(decimals0).mul(value)
            const p1 = (value: BigNumberish) => pow10(decimals1).mul(value)

            await asset0.connect(addr1).transfer(owner.address, p0(100))
            await asset1.connect(addr1).transfer(owner.address, p1(100))

            const pairAddress = await factory.getPair(asset0.address, asset1.address)

            await waitForTx(await asset0.connect(owner).approve(router.address, p0(100)))
            await waitForTx(await asset1.connect(owner).approve(router.address, p1(100)))

            await waitForTx(
                await router
                    .connect(owner)
                    .addLiquidity(
                        asset0.address,
                        asset1.address,
                        p0(100),
                        p1(100),
                        0,
                        0,
                        addr1.address,
                        (await getLatestBlockTimestamp()) + 60
                    )
            )

            const DELAY_UNTIL_DEFAULT = bn("86400") // 24h
            const ORACLE_TIMEOUT = bn("281474976710655").div(2) // type(uint48).max / 2
            const RTOKEN_MAX_TRADE_VALUE = fp("1e6")

            const MockV3AggregatorFactory = await ethers.getContractFactory("MockV3Aggregator")
            const mockChainlinkFeed0 = <MockV3Aggregator>(
                await MockV3AggregatorFactory.connect(addr1).deploy(8, bn("1e8"))
            )
            const mockChainlinkFeed1 = <MockV3Aggregator>(
                await MockV3AggregatorFactory.connect(addr1).deploy(8, bn("1e8"))
            )

            const uniswapV2NonFiatCollateralContractFactory: UniswapV2NonFiatCollateral__factory =
                await ethers.getContractFactory("UniswapV2NonFiatCollateral")

            const fallbackPrice = fp("1")
            const targetName = ethers.utils.formatBytes32String("UNIV2SQRT")
            const uniswapV2NonFiatCollateral: UniswapV2NonFiatCollateral = <
                UniswapV2NonFiatCollateral
            >await uniswapV2NonFiatCollateralContractFactory
                .connect(addr1)
                .deploy(
                    fallbackPrice,
                    mockChainlinkFeed0.address,
                    mockChainlinkFeed1.address,
                    pairAddress,
                    RTOKEN_MAX_TRADE_VALUE,
                    ORACLE_TIMEOUT,
                    targetName,
                    DELAY_UNTIL_DEFAULT
                )

            await waitForTx(await uniswapV2NonFiatCollateral.refresh())
           

            expect(await uniswapV2NonFiatCollateral.isCollateral()).to.equal(true)
            expect(await uniswapV2NonFiatCollateral.erc20()).to.equal(pairAddress)
            expect(await uniswapV2NonFiatCollateral.erc20Decimals()).to.equal(18)
            expect(await uniswapV2NonFiatCollateral.targetName()).to.equal(targetName)
            expect(await uniswapV2NonFiatCollateral.status()).to.equal(CollateralStatus.SOUND)
            expect(await uniswapV2NonFiatCollateral.whenDefault()).to.equal(MAX_UINT256)
            expect(await uniswapV2NonFiatCollateral.delayUntilDefault()).to.equal(
                DELAY_UNTIL_DEFAULT
            )
            expect(await uniswapV2NonFiatCollateral.maxTradeVolume()).to.equal(
                RTOKEN_MAX_TRADE_VALUE
            )
            expect(await uniswapV2NonFiatCollateral.oracleTimeout()).to.equal(ORACLE_TIMEOUT)

            const pair = <IUniswapV2Pair>await ethers.getContractAt("IUniswapV2Pair", pairAddress)
            const liquidity = await pair.balanceOf(addr1.address)
            const { reserve0, reserve1 } = await pair.getReserves()
            const totalSupply = await pair.totalSupply()
            const expectedRefPerTok = fp(sqrt(reserve0.mul(reserve1))).div(totalSupply)
            expect(await uniswapV2NonFiatCollateral.refPerTok()).to.equal(expectedRefPerTok)

            expect(await uniswapV2NonFiatCollateral.targetPerRef()).to.equal(fp("1"))
            expect(await uniswapV2NonFiatCollateral.pricePerTarget()).to.equal(await uniswapV2NonFiatCollateral.strictPrice())
            expect(await uniswapV2NonFiatCollateral.strictPrice()).closeTo(pow10(18).mul(fp('200')).div(liquidity), pow10(32))
        })

        it("U2C fiat can be deployed", async () => {
            const asset0 = usdt
            const asset1 = usdc

            const decimals0 = await asset0.decimals()
            const decimals1 = await asset1.decimals()

            const p0 = (value: BigNumberish) => pow10(decimals0).mul(value)
            const p1 = (value: BigNumberish) => pow10(decimals1).mul(value)

            await asset0.connect(addr1).transfer(owner.address, p0(100))
            await asset1.connect(addr1).transfer(owner.address, p1(100))

            const pairAddress = await factory.getPair(asset0.address, asset1.address)

            await waitForTx(await asset0.connect(owner).approve(router.address, p0(100)))
            await waitForTx(await asset1.connect(owner).approve(router.address, p1(100)))

            await waitForTx(
                await router
                    .connect(owner)
                    .addLiquidity(
                        asset0.address,
                        asset1.address,
                        p0(100),
                        p1(100),
                        0,
                        0,
                        addr1.address,
                        (await getLatestBlockTimestamp()) + 60
                    )
            )

            const DEFAULT_THRESHOLD = fp("0.05") // 5%
            const DELAY_UNTIL_DEFAULT = bn("86400") // 24h
            const ORACLE_TIMEOUT = bn("281474976710655").div(2) // type(uint48).max / 2
            const RTOKEN_MAX_TRADE_VALUE = fp("1e6")

            const MockV3AggregatorFactory = await ethers.getContractFactory("MockV3Aggregator")
            const mockChainlinkFeed0 = <MockV3Aggregator>(
                await MockV3AggregatorFactory.connect(addr1).deploy(8, bn("1e8"))
            )
            const mockChainlinkFeed1 = <MockV3Aggregator>(
                await MockV3AggregatorFactory.connect(addr1).deploy(8, bn("1e8"))
            )

            const uniswapV2FiatCollateralContractFactory: UniswapV2FiatCollateral__factory =
                await ethers.getContractFactory("UniswapV2FiatCollateral", {
                    libraries: { OracleLib: oracleLib.address },
                })

            const fallbackPrice = fp("1")
            const targetName = ethers.utils.formatBytes32String("UNIV2SQRT")
            const uniswapV2FiatCollateral: UniswapV2FiatCollateral =
                await uniswapV2FiatCollateralContractFactory
                    .connect(addr1)
                    .deploy(
                        fallbackPrice,
                        mockChainlinkFeed0.address,
                        mockChainlinkFeed1.address,
                        pairAddress,
                        RTOKEN_MAX_TRADE_VALUE,
                        ORACLE_TIMEOUT,
                        targetName,
                        DEFAULT_THRESHOLD,
                        DELAY_UNTIL_DEFAULT
                    )

        
            await waitForTx(await uniswapV2FiatCollateral.refresh())

            expect(await uniswapV2FiatCollateral.isCollateral()).to.equal(true)
            expect(await uniswapV2FiatCollateral.erc20()).to.equal(pairAddress)
            expect(await uniswapV2FiatCollateral.erc20Decimals()).to.equal(18)
            expect(await uniswapV2FiatCollateral.targetName()).to.equal(targetName)
            expect(await uniswapV2FiatCollateral.status()).to.equal(CollateralStatus.SOUND)
            expect(await uniswapV2FiatCollateral.whenDefault()).to.equal(MAX_UINT256)
            expect(await uniswapV2FiatCollateral.defaultThreshold()).to.equal(DEFAULT_THRESHOLD)
            expect(await uniswapV2FiatCollateral.delayUntilDefault()).to.equal(DELAY_UNTIL_DEFAULT)
            expect(await uniswapV2FiatCollateral.maxTradeVolume()).to.equal(RTOKEN_MAX_TRADE_VALUE)
            expect(await uniswapV2FiatCollateral.oracleTimeout()).to.equal(ORACLE_TIMEOUT)

            const pair = <IUniswapV2Pair>await ethers.getContractAt("IUniswapV2Pair", pairAddress)
            const { reserve0, reserve1 } = await pair.getReserves()
            const totalSupply = await pair.totalSupply()
            const expectedRefPerTok = fp(sqrt(reserve0.mul(reserve1))).div(totalSupply)
            expect(await uniswapV2FiatCollateral.refPerTok()).to.equal(expectedRefPerTok)

            expect(await uniswapV2FiatCollateral.targetPerRef()).to.equal(fp("2e12"))
            expect(await uniswapV2FiatCollateral.pricePerTarget()).to.equal(fp("1"))
            const liquidity = await pair.balanceOf(addr1.address)
            expect(await uniswapV2FiatCollateral.strictPrice()).closeTo(pow10(18).mul(fp('200')).div(liquidity), pow10(32))

            await waitForTx(await mockChainlinkFeed0.updateAnswer(fp("1.06").div(pow10(10))))
            uniswapV2FiatCollateral.refresh()
            expect(await uniswapV2FiatCollateral.status()).to.equal(CollateralStatus.IFFY)

        })

        // it("Try feeds", async () => {
        //     const asset0 = usdt
        //     const asset1 = usdc

        //     const decimals0 = await asset0.decimals()
        //     const decimals1 = await asset1.decimals()

        //     const p0 = (value: BigNumberish) => pow10(decimals0).mul(value)
        //     const p1 = (value: BigNumberish) => pow10(decimals1).mul(value)

        //     const asset0InitialBalance = await asset0.balanceOf(addr1.address)
        //     const asset1InitialBalance = await asset1.balanceOf(addr1.address)

        //     await asset0.connect(addr1).transfer(owner.address, p0(200))
        //     await asset1.connect(addr1).transfer(owner.address, p1(100))

        //     const asset0Balance0 = await asset0.balanceOf(addr1.address)
        //     const asset1Balance0 = await asset1.balanceOf(addr1.address)

        //     //check if balance changes after transfer
        //     expect(asset0Balance0).to.equal(asset0InitialBalance.sub(p0(200)))
        //     expect(asset1Balance0).to.equal(asset1InitialBalance.sub(p0(100)))

        //     const pairAddress = await factory.getPair(asset0.address, asset1.address)

        //     await waitForTx(await asset0.connect(owner).approve(router.address, p0(100)))
        //     await waitForTx(await asset1.connect(owner).approve(router.address, p1(100)))

        //     await waitForTx(
        //         await router
        //             .connect(owner)
        //             .addLiquidity(
        //                 asset0.address,
        //                 asset1.address,
        //                 p0(100),
        //                 p1(100),
        //                 0,
        //                 0,
        //                 addr1.address,
        //                 (await getLatestBlockTimestamp()) + 60
        //             )
        //     )

        //     const DELAY_UNTIL_DEFAULT = bn("86400") // 24h
        //     const ORACLE_TIMEOUT = bn("281474976710655").div(2) // type(uint48).max / 2
        //     const RTOKEN_MAX_TRADE_VALUE = fp("1e6")

        //     const MockV3AggregatorFactory = await ethers.getContractFactory("MockV3Aggregator")

        //     const usdtPrice1 = fp("1")
        //     const usdcPrice1 = fp("1")

        //     let mockChainlinkFeed0 = <MockV3Aggregator>(
        //         await MockV3AggregatorFactory.connect(addr1).deploy(8, usdtPrice1)
        //     )

        //     let mockChainlinkFeed1 = <MockV3Aggregator>(
        //         await MockV3AggregatorFactory.connect(addr1).deploy(8, usdcPrice1)
        //     )

        //     const uniswapV2NonFiatCollateralContractFactory: UniswapV2NonFiatCollateral__factory = await ethers.getContractFactory(
        //         "UniswapV2NonFiatCollateral"
        //     )

        //     const fallbackPrice = fp("1")
        //     const targetName = ethers.utils.formatBytes32String("USD")
        //     const uniswapV2NonFiatCollateral1: UniswapV2NonFiatCollateral = <UniswapV2NonFiatCollateral>(
        //         await uniswapV2NonFiatCollateralContractFactory
        //             .connect(addr1)
        //             .deploy(
        //                 fallbackPrice,
        //                 mockChainlinkFeed0.address,
        //                 mockChainlinkFeed1.address,
        //                 pairAddress,
        //                 RTOKEN_MAX_TRADE_VALUE,
        //                 ORACLE_TIMEOUT,
        //                 targetName,
        //                 DELAY_UNTIL_DEFAULT
        //             )
        //     )

        //     expect(await uniswapV2NonFiatCollateral1.status()).to.equal(CollateralStatus.SOUND)

        //     const strictPrice1 = await uniswapV2NonFiatCollateral1.strictPrice()
        //     console.log("strictPrice1", strictPrice1)

        //     const usdtPrice2 = fp("1.1")
        //     const usdcPrice2 = fp("1.1")

        //     mockChainlinkFeed0 = <MockV3Aggregator>(
        //         await MockV3AggregatorFactory.connect(addr1).deploy(8, usdtPrice2)
        //     )

        //     mockChainlinkFeed1 = <MockV3Aggregator>(
        //         await MockV3AggregatorFactory.connect(addr1).deploy(8, usdcPrice2)
        //     )

        //     const uniswapV2NonFiatCollateral2: UniswapV2NonFiatCollateral = <UniswapV2NonFiatCollateral>(
        //         await uniswapV2NonFiatCollateralContractFactory
        //             .connect(addr1)
        //             .deploy(
        //                 fallbackPrice,
        //                 mockChainlinkFeed0.address,
        //                 mockChainlinkFeed1.address,
        //                 pairAddress,
        //                 RTOKEN_MAX_TRADE_VALUE,
        //                 ORACLE_TIMEOUT,
        //                 targetName,
        //                 DELAY_UNTIL_DEFAULT
        //             )
        //     )

        //     const strictPrice2 = await uniswapV2NonFiatCollateral2.strictPrice()
        //     const refPerTor2 = await uniswapV2NonFiatCollateral2.refPerTok()
        //     const refPerTok1 = await uniswapV2NonFiatCollateral1.refPerTok()

        //     console.log(refPerTok1, refPerTor2)

        //     // check if strictPrice of collateral depends on currency price
        //     expect(strictPrice1).to.not.equal(strictPrice2)
        //     expect(strictPrice2).to.above(strictPrice1)
        //     expect(refPerTok1).to.equal(refPerTor2)

        //     await asset0.connect(addr1).transfer(owner.address, p0(200))
        //     await asset1.connect(addr1).transfer(owner.address, p1(100))

        //     await waitForTx(await asset0.connect(owner).approve(router.address, p0(100)))
        //     await waitForTx(await asset1.connect(owner).approve(router.address, p1(100)))

        //     await waitForTx(
        //         await router
        //             .connect(owner)
        //             .addLiquidity(
        //                 asset0.address,
        //                 asset1.address,
        //                 p0(100),
        //                 p1(100),
        //                 0,
        //                 0,
        //                 addr1.address,
        //                 (await getLatestBlockTimestamp()) + 60
        //             )
        //     )

        //     // await waitForTx(await asset0.connect(owner).approve(router.address, p0(100)))
        //     // await waitForTx(await asset1.connect(owner).approve(router.address, p1(100)))

        //     await asset0.connect(owner).approve(router.address, p0(100))

        //     await router.swapExactTokensForTokens(
        //         p0(100),
        //         0,
        //         [asset0.address, asset1.address],
        //         addr1.address,
        //         await closeDeadline())

        //     // console.log(await uniswapV2Coƒllateral2.refPerTok())

        //})
    })
})
