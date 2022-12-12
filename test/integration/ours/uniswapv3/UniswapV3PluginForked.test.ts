import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { BigNumber, BigNumberish, Wallet } from "ethers"
import hre, { ethers, waffle } from "hardhat"
import { defaultFixture, IMPLEMENTATION } from "../../../fixtures"
import { getChainId } from "../../../../common/blockchain-utils"
import { IConfig, IGovParams, networkConfig } from "../../../../common/configuration"
import { bn, fp, pow10 } from "../../../../common/numbers"
import {
    Asset,
    ERC20Mock,
    FacadeRead,
    FacadeTest,
    FacadeWrite,
    IAssetRegistry,
    IBasketHandler,
    INonfungiblePositionManager,
    ISwapRouter,
    IUniswapV3Factory,
    IUniswapV3Pool,
    MockV3Aggregator,
    OracleLib,
    RTokenAsset,
    TestIBackingManager,
    TestIDeployer,
    TestIMain,
    TestIRToken,
    UniswapV3UsdCollateral,
    UniswapV3UsdCollateral__factory,
    UniswapV3Wrapper,
    UniswapV3WrapperMock,
    USDCMock,
} from "../../../../typechain"
import { whileImpersonating } from "../../../utils/impersonation"
import { waitForTx } from "../../utils"
import { expect } from "chai"
import { CollateralStatus, MAX_UINT256, ZERO_ADDRESS } from "../../../../common/constants"
import { UniswapV3Collateral__factory } from "@typechain/factories/UniswapV3Collateral__factory"
import { UniswapV3Collateral } from "@typechain/UniswapV3Collateral"
import {
    closeDeadline,
    defaultMintParams,
    deployUniswapV3Wrapper,
    encodePath,
    FeeAmount,
    holderDAI,
    holderUSDC,
    holderUSDT,
    logBalances,
    p999,
    sendTokenAs,
    sortedTokens,
    TMintParams,
} from "../common"
import { anyUint, anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs"
import { ORACLE_TIMEOUT } from "../../fixtures"
import { getContractAt } from "@nomiclabs/hardhat-ethers/internal/helpers"

const createFixtureLoader = waffle.createFixtureLoader

const describeFork = process.env.FORK ? describe : describe.skip
describeFork(`UniswapV3Plugin - Integration - Mainnet Forking P${IMPLEMENTATION}`, function () {
    const initialBal = 10 ** 7 // 10M initial balance of each token to each addr
    const TARGET_NAME = "USD"
    const DEFAULT_THRESHOLD = pow10(16).mul(5) //5%
    const DELAY_UNTIL_DEFAULT = bn("86400") // 24h

    let config: IConfig
    let owner: SignerWithAddress
    let addr1: SignerWithAddress
    let addr2: SignerWithAddress
    let addr3: SignerWithAddress

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

    let mockChainlinkFeed0: MockV3Aggregator
    let mockChainlinkFeed1: MockV3Aggregator

    let UniswapV3UsdCollateralContractFactory: UniswapV3UsdCollateral__factory
    let NonfungiblePositionManager: INonfungiblePositionManager

    let UniswapV3Wrapper: UniswapV3Wrapper
    let UniswapV3Pool: IUniswapV3Pool
    let UniswapV3Router: ISwapRouter
    let UniswapV3UsdCollateral: UniswapV3UsdCollateral
    let rsr: ERC20Mock
    let rsrAsset: Asset

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

    let loadFixture: ReturnType<typeof createFixtureLoader>
    let wallet: Wallet

    let chainId: number

    before(async () => {
        ;[wallet] = (await ethers.getSigners()) as unknown as Wallet[]
        loadFixture = createFixtureLoader([wallet])

        chainId = await getChainId(hre)
        if (!networkConfig[chainId]) {
            throw new Error(`Missing network configuration for ${hre.network.name}`)
        }
    })

    beforeEach(async () => {
        ;[owner, addr1, addr2, addr3] = await ethers.getSigners()
        ;({
            config,
            rsr,
            rsrAsset,
            deployer,
            facade,
            facadeTest,
            facadeWrite,
            oracleLib,
            govParams,
        } = await loadFixture(defaultFixture))

        UniswapV3UsdCollateralContractFactory = (
            await ethers.getContractFactory("UniswapV3UsdCollateral", {
                libraries: { OracleLib: oracleLib.address },
            })
        ).connect(owner)
        NonfungiblePositionManager = await ethers.getContractAt(
            "INonfungiblePositionManager",
            networkConfig[chainId].UNISWAP_V3_NFT_POSITION_MANAGER || ""
        )
        UniswapV3Router = await ethers.getContractAt(
            "ISwapRouter",
            networkConfig[chainId].UNISWAP_V3_ROUTER || ""
        )

        const MockV3AggregatorFactory = (
            await ethers.getContractFactory("MockV3Aggregator")
        ).connect(owner)
        mockChainlinkFeed0 = await MockV3AggregatorFactory.deploy(8, bn("1e8"))
        mockChainlinkFeed1 = await MockV3AggregatorFactory.deploy(8, bn("1e8"))

        dai = await ethers.getContractAt("ERC20Mock", networkConfig[chainId].tokens.DAI!)
        const daiDecimals = await dai.decimals()
        ofDai = (amount: BigNumberish) => pow10(daiDecimals).mul(amount)
        await sendTokenAs(dai, holderDAI, addr1, ofDai(initialBal))
        await sendTokenAs(dai, holderDAI, addr2, ofDai(initialBal))
        await sendTokenAs(dai, holderDAI, owner, ofDai(initialBal))

        usdc = await ethers.getContractAt("ERC20Mock", networkConfig[chainId].tokens.USDC!)
        const usdcDecimals = await usdc.decimals()
        ofUsdc = (amount: BigNumberish) => pow10(usdcDecimals).mul(amount)
        await sendTokenAs(usdc, holderUSDC, addr1, ofUsdc(initialBal))
        await sendTokenAs(usdc, holderUSDC, addr2, ofUsdc(initialBal))
        await sendTokenAs(usdc, holderUSDC, owner, ofUsdc(initialBal))

        usdt = await ethers.getContractAt("ERC20Mock", networkConfig[chainId].tokens.USDT || "")
        const usdtDecimals = await usdt.decimals()
        ofUsdt = (amount: BigNumberish) => pow10(usdtDecimals).mul(amount)
        await sendTokenAs(usdt, holderUSDT, addr1, ofUsdt(initialBal))
        await sendTokenAs(usdt, holderUSDT, addr2, ofUsdt(initialBal))
        await sendTokenAs(usdt, holderUSDT, owner, ofUsdt(initialBal))

        ofTokenMap = {
            [dai.address]: ofDai,
            [usdc.address]: ofUsdc,
            [usdt.address]: ofUsdt,
        }
    })

    describe("Deployment", () => {
        it("UniswapV3Wrapper can be minted", async () => {
            // assets must be sorted alphabetically by address
            const [asset0, asset1] = sortedTokens(dai, usdc)
            const [wrongOrderAsset0, wrongOrderAsset1] = [asset1, asset0]
            const wrongOrderMintParams0: TMintParams = await defaultMintParams(
                wrongOrderAsset0,
                wrongOrderAsset1,
                ofToken(wrongOrderAsset0)(100),
                ofToken(wrongOrderAsset1)(100)
            )
            const mintParams0: TMintParams = await defaultMintParams(
                asset0,
                asset1,
                ofToken(asset0)(100),
                ofToken(asset1)(100)
            )

            // won't work with the wrong order of assets
            try {
                await deployUniswapV3Wrapper(
                    wrongOrderAsset0,
                    wrongOrderAsset0,
                    owner,
                    wrongOrderMintParams0,
                    addr1
                )
            } catch (e) {
                expect(e).to.be.instanceOf(Error)
            }

            const uniswapV3Wrapper0: UniswapV3Wrapper = await deployUniswapV3Wrapper(
                asset0,
                asset1,
                owner,
                mintParams0,
                addr1
            )

            const [asset2, asset3] = sortedTokens(usdt, usdc)
            const mintParams1: TMintParams = await defaultMintParams(
                asset2,
                asset3,
                ofToken(asset2)(3000),
                ofToken(asset3)(3000)
            )
            const uniswapV3Wrapper1: UniswapV3Wrapper = await deployUniswapV3Wrapper(
                asset2,
                asset3,
                owner,
                mintParams1,
                addr1
            )
        })
    })

    describe("RefPerTok non-decreasing over time", () => {
        beforeEach(async () => {
            setTokens(dai, usdc)
            const mintParams0: TMintParams = await defaultMintParams(
                asset0,
                asset1,
                ofToken(asset0)(10 ** 5),
                ofToken(asset1)(10 ** 5)
            )
            UniswapV3Wrapper = await deployUniswapV3Wrapper(
                asset0,
                asset1,
                owner,
                mintParams0,
                owner
            )
            UniswapV3Pool = await ethers.getContractAt(
                "IUniswapV3Pool",
                await UniswapV3Wrapper.pool()
            )
            await waitForTx(
                await asset0
                    .connect(addr1)
                    .approve(UniswapV3Wrapper.address, await asset0.totalSupply())
            )
            await waitForTx(
                await asset1
                    .connect(addr1)
                    .approve(UniswapV3Wrapper.address, await asset1.totalSupply())
            )
            await waitForTx(
                await asset0
                    .connect(addr2)
                    .approve(NonfungiblePositionManager.address, await asset0.totalSupply())
            )
            await waitForTx(
                await asset1
                    .connect(addr2)
                    .approve(NonfungiblePositionManager.address, await asset1.totalSupply())
            )
            await waitForTx(
                await asset0
                    .connect(addr2)
                    .approve(UniswapV3Router.address, await asset0.totalSupply())
            )
            await waitForTx(
                await asset1
                    .connect(addr2)
                    .approve(UniswapV3Router.address, await asset1.totalSupply())
            )
            const fallbackPrice = fp("1")
            UniswapV3UsdCollateral = await UniswapV3UsdCollateralContractFactory.deploy(
                fallbackPrice,
                fallbackPrice,
                mockChainlinkFeed0.address,
                mockChainlinkFeed1.address,
                UniswapV3Wrapper.address,
                config.rTokenMaxTradeVolume,
                ORACLE_TIMEOUT,
                ethers.utils.formatBytes32String(TARGET_NAME),
                DEFAULT_THRESHOLD,
                100,
                DELAY_UNTIL_DEFAULT
            )
        })

        it("refPerTok remains unchanged after increaseLiquidity/decreaseLiquidity", async () => {
            await waitForTx(await UniswapV3UsdCollateral.refresh())
            const status = await UniswapV3UsdCollateral.status()
            console.log("status", status)
            expect(status).to.equal(CollateralStatus.SOUND)

            // Initial refPerTok
            const refPerTok0 = await UniswapV3UsdCollateral.refPerTok()
            console.log("initialRefPerTok", refPerTok0.toString())

            await logBalances(
                "Balances before increaseLiquidity:",
                [owner, addr1],
                [asset0, asset1, UniswapV3Wrapper]
            )

            // Increase liquidity by ~500k,500k
            const incLiqAmount0 = ofToken(asset0)(5 * 10 ** 5)
            const incLiqAmount1 = ofToken(asset1)(5 * 10 ** 5)
            await waitForTx(
                await UniswapV3Wrapper.connect(addr1).increaseLiquidity(
                    incLiqAmount0,
                    incLiqAmount1,
                    p999(incLiqAmount0),
                    p999(incLiqAmount1),
                    await closeDeadline()
                )
            )

            await waitForTx(await UniswapV3UsdCollateral.refresh())
            expect(await UniswapV3UsdCollateral.status()).to.equal(CollateralStatus.SOUND)

            await logBalances(
                "Balances after increaseLiquidity:",
                [owner, addr1],
                [asset0, asset1, UniswapV3Wrapper]
            )

            const refPerTok1 = await UniswapV3UsdCollateral.refPerTok()
            console.log("refPerTok1", refPerTok1.toString())
            expect(refPerTok1).to.be.closeTo(refPerTok0, fp("0.001"))

            // Decrease liquidity by ~300k,300k
            const decLiquidity = (await UniswapV3Wrapper.balanceOf(addr1.address)).mul(3).div(5)
            const decLiqAmount0 = ofToken(asset0)(3 * 10 ** 5)
            const decLiqAmount1 = ofToken(asset1)(3 * 10 ** 5)
            await waitForTx(
                await UniswapV3Wrapper.connect(addr1).decreaseLiquidity(
                    decLiquidity,
                    p999(decLiqAmount0),
                    p999(decLiqAmount1),
                    await closeDeadline()
                )
            )

            await waitForTx(await UniswapV3UsdCollateral.refresh())
            expect(await UniswapV3UsdCollateral.status()).to.equal(CollateralStatus.SOUND)

            await logBalances(
                "Balances after decreaseLiquidity:",
                [owner, addr1],
                [asset0, asset1, UniswapV3Wrapper]
            )
            const refPerTok2 = await UniswapV3UsdCollateral.refPerTok()
            console.log("refPerTok2", refPerTok2)
            expect(refPerTok2).to.be.closeTo(refPerTok0, fp("0.001"))

            // Increase liquidity by ~800k,800k through Uniswap directly
            // not using the wrapper

            const tokenId = await UniswapV3Wrapper.tokenId()
            const incLiqAmount0Direct = ofToken(asset0)(8 * 10 ** 5)
            const incLiqAmount1Direct = ofToken(asset1)(8 * 10 ** 5)
            await waitForTx(
                await NonfungiblePositionManager.connect(addr2).increaseLiquidity({
                    tokenId,
                    amount0Desired: incLiqAmount0Direct,
                    amount1Desired: incLiqAmount1Direct,
                    amount0Min: p999(incLiqAmount0Direct),
                    amount1Min: p999(incLiqAmount1Direct),
                    deadline: await closeDeadline(),
                })
            )

            await waitForTx(await UniswapV3UsdCollateral.refresh())
            expect(await UniswapV3UsdCollateral.status()).to.equal(CollateralStatus.SOUND)

            await logBalances(
                "Balances after increaseLiquidity through Uniswap directly:",
                [owner, addr1, addr2],
                [asset0, asset1, UniswapV3Wrapper]
            )
            const refPerTok3 = await UniswapV3UsdCollateral.refPerTok()
            console.log("refPerTok3", refPerTok3)
            expect(refPerTok3).to.be.closeTo(refPerTok0, fp("0.001"))
        })

        it("refPerTok grows on swaps", async () => {
            // Initial refPerTok
            const refPerTok0 = await UniswapV3UsdCollateral.refPerTok()
            console.log("initialRefPerTok", refPerTok0.toString())

            await logBalances("Balances after swap:", [addr2], [asset0, asset1])
            // swap ~100k asset0 for asset1

            console.log("allowance0", await asset0.allowance(addr2.address, UniswapV3Pool.address))
            console.log("allowance1", await asset1.allowance(addr2.address, UniswapV3Pool.address))
            const swapAmount0 = ofToken(asset0)(10 ** 7)
            console.log("swapAmount0", swapAmount0.toString())
            await waitForTx(
                await UniswapV3Router.connect(addr2).exactInputSingle({
                    tokenIn: asset0.address,
                    tokenOut: asset1.address,
                    fee: await UniswapV3Pool.fee(),
                    recipient: addr2.address,
                    deadline: await closeDeadline(),
                    amountIn: swapAmount0,
                    amountOutMinimum: 0,
                    sqrtPriceLimitX96: 0,
                })
            )

            await waitForTx(await UniswapV3UsdCollateral.refresh())
            expect(await UniswapV3UsdCollateral.status()).to.equal(CollateralStatus.SOUND)

            const refPerTok1 = await UniswapV3UsdCollateral.refPerTok()
            console.log("refPerTok1", refPerTok1.toString())
            expect(refPerTok1).to.be.closeTo(refPerTok0, fp("0.001"))
            await logBalances("Balances after swap:", [addr2], [asset0, asset1])
            //TODO assert that refPerTok has grown
        })
    })
})
