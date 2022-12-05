import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import hre, { ethers, waffle } from "hardhat"
import { BigNumberish, ContractTransaction, Wallet } from "ethers"
import { defaultFixture, IMPLEMENTATION } from "../../../fixtures"
import { getChainId } from "../../../../common/blockchain-utils"
import { networkConfig } from "../../../../common/configuration"
import { bn, fp, pow10 } from "../../../../common/numbers"
import { ERC20Mock, MockV3Aggregator, USDCMock, IBooster } from "../../../../typechain"
import { whileImpersonating } from "../../../utils/impersonation"
import { waitForTx } from "../../utils"
import { expect } from "chai"
import { CollateralStatus, MAX_UINT256 } from "../../../../common/constants"
import { UniconvexCollateral } from "@typechain/UniconvexCollateral"
import { UniconvexCollateral__factory } from "@typechain/factories/UniconvexCollateral__factory"
import { getLatestBlockTimestamp } from "../../../utils/time"
import { ICurvePool3Assets } from "@typechain/ICurvePool3Assets"
import { logBalances, sqrt } from "../common"

const createFixtureLoader = waffle.createFixtureLoader

// Relevant addresses (Mainnet)
const holderDAI = "0x16b34ce9a6a6f7fc2dd25ba59bf7308e7b38e186"
const holderUSDT = "0xf977814e90da44bfa03b6295a0616a897441acec"
const holderUSDC = "0x0a59649758aa4d66e25f08dd01271e891fe52199"

const describeFork = process.env.FORK ? describe : describe.skip
describeFork(`UniconvexPlugin - Integration - Mainnet Forking P${IMPLEMENTATION}`, function () {
    const initialBal = 20000
    let owner: SignerWithAddress
    let addr1: SignerWithAddress
    let addr2: SignerWithAddress

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
        })

        beforeEach(async () => {
            ;[owner, , addr1, addr2] = await ethers.getSigners()

            await loadFixture(defaultFixture)
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

        it("Convex Collateral can be deployed", async () => {
            const asset0 = dai
            const asset1 = usdc
            const asset2 = usdt

            const decimals0 = await asset0.decimals()
            const decimals1 = await asset1.decimals()
            const decimals2 = await asset2.decimals()

            const p0 = (value: BigNumberish) => pow10(decimals0).mul(value)
            const p1 = (value: BigNumberish) => pow10(decimals1).mul(value)
            const p2 = (value: BigNumberish) => pow10(decimals2).mul(value)

            //curve view
            //NOTE it's one of AMM contracts
            //StableSwap3Pool for DAI, USDC, and USDT

            // https://curve.readthedocs.io/ref-addresses.html
            const curveContractV2 = "0x6c3F90f043a72FA612cbac8115EE7e52BDe6E490"
            // LiquidityGauge: 0xbFcF63294aD7105dEa65aA58F8AE5BE2D9d0952A
            const stableSwap3PoolAddress = "0xbebc44782c7db0a1a60cb6fe97d0b483032ff1c7"
            const stableSwap3Pool: ICurvePool3Assets = await ethers.getContractAt(
                "ICurvePool3Assets",
                stableSwap3PoolAddress
            )

            // token not always public or implemented
            // const lpTokenAddress = await stableSwap3Pool.token();
            const lpTokenAddress = curveContractV2

            const lpToken = await ethers.getContractAt("ERC20Mock", lpTokenAddress)

            await waitForTx(await asset0.connect(addr1).approve(stableSwap3Pool.address, p0(100)))
            await waitForTx(await asset1.connect(addr1).approve(stableSwap3Pool.address, p1(100)))
            await waitForTx(await asset2.connect(addr1).approve(stableSwap3Pool.address, p2(100)))

            // TODO: need we zap depositor?
            // https://github.com/curvefi/curve-factory/blob/b6655de2bf9c447b6e80a4e60ed1b3d20b786b34/contracts/zaps/DepositZapUSD.vy#L66
            // TODO: need we always raising on mint invariant?
            // https://github.com/curvefi/curve-contract/blob/b0bbf77f8f93c9c5f4e415bce9cd71f0cdee960e/contracts/pools/3pool/StableSwap3Pool.vy#L317

            const receipt = await waitForTx(
                await stableSwap3Pool.connect(addr1).add_liquidity(
                    [p0(100), p1(100), p2(100)],
                    0 //min_mint_amount
                )
            )

            await logBalances(
                "after minting Curve LP",
                [owner, addr1],
                [asset0, asset1, asset2, lpToken]
            )

            // convex view
            // https://docs.convexfinance.com/convexfinance/faq/contract-addresses
            const boosterAddress = "0xF403C135812408BFbE8713b5A23a04b3D48AAE31"
            const booster: IBooster = <IBooster>(
                await ethers.getContractAt("IBooster", boosterAddress)
            )

            // just to investigate api
            // on deploy need to use constant address
            const poolLenght = await booster.connect(owner).poolLength()
            const allPools = []
            const matchedPools = []
            for (let index = 0; index < poolLenght.toNumber(); index++) {
                const poolInfo = await booster.poolInfo(index)
                allPools.push({ index, poolInfo })
                if (poolInfo.lptoken == lpTokenAddress) {
                    matchedPools.push({ index, poolInfo })
                    console.log(matchedPools)
                }
            }

            const lpTokenBalance1 = await lpToken.connect(addr1).balanceOf(addr1.address)

            await waitForTx(await lpToken.connect(addr1).approve(booster.address, lpTokenBalance1))

            await waitForTx(
                await booster.connect(addr1).depositAll(
                    matchedPools[0].index,
                    false //don't stake on deposit
                )
            )

            const convexLpTokenAddress = matchedPools[0].poolInfo.token

            const convexLpToken = await ethers.getContractAt("ERC20Mock", convexLpTokenAddress)

            await logBalances(
                "after minting Convex LP",
                [addr1],
                [asset0, asset1, asset2, lpToken, convexLpToken]
            )

            const DELAY_UNTIL_DEFAULT = bn("86400") // 24h
            const ORACLE_TIMEOUT = bn("281474976710655").div(2) // type(uint48).max / 2
            const RTOKEN_MAX_TRADE_VALUE = fp("1e6")

            const MockV3AggregatorFactory = await ethers.getContractFactory("MockV3Aggregator")
            const mockChainlinkFeed0 = await MockV3AggregatorFactory.connect(addr1).deploy(
                8,
                bn("1e8")
            )

            const mockChainlinkFeed1 = await MockV3AggregatorFactory.connect(addr1).deploy(
                8,
                bn("1e8")
            )

            const mockChainlinkFeed2 = await MockV3AggregatorFactory.connect(addr1).deploy(
                8,
                bn("1e8")
            )

            const uniconvexCollateralContractFactory: UniconvexCollateral__factory =
                await ethers.getContractFactory("UniconvexCollateral")

            const fallbackPrice = fp("1")
            const targetName = ethers.utils.formatBytes32String("USD")
            const uniconvexCollateral: UniconvexCollateral = <UniconvexCollateral>(
                await uniconvexCollateralContractFactory
                    .connect(addr1)
                    .deploy(
                        stableSwap3Pool,
                        fallbackPrice,
                        [
                            mockChainlinkFeed0.address,
                            mockChainlinkFeed1.address,
                            mockChainlinkFeed2.address,
                        ],
                        convexLpToken,
                        RTOKEN_MAX_TRADE_VALUE,
                        ORACLE_TIMEOUT,
                        targetName,
                        DELAY_UNTIL_DEFAULT
                    )
            )

            expect(await uniconvexCollateral.isCollateral()).to.equal(true)
            expect(await uniconvexCollateral.erc20()).to.equal(convexLpToken)
            expect(await uniconvexCollateral.erc20Decimals()).to.equal(18)
            expect(await uniconvexCollateral.targetName()).to.equal(
                ethers.utils.formatBytes32String("USD")
            )
            expect(await uniconvexCollateral.status()).to.equal(CollateralStatus.SOUND)
            expect(await uniconvexCollateral.whenDefault()).to.equal(MAX_UINT256)
            //expect(await uniconvexCollateral.defaultThreshold()).to.equal(DEFAULT_THRESHOLD)
            expect(await uniconvexCollateral.delayUntilDefault()).to.equal(DELAY_UNTIL_DEFAULT)
            expect(await uniconvexCollateral.maxTradeVolume()).to.equal(RTOKEN_MAX_TRADE_VALUE)
            expect(await uniconvexCollateral.oracleTimeout()).to.equal(ORACLE_TIMEOUT)

            // const pair = <IUniconvexPair>await ethers.getContractAt("IUniconvexPair", pairAddress)
            // const {reserve0, reserve1} = await pair.getReserves()
            // const totalSupply = await pair.totalSupply()
            // const expectedRefPerTok = fp(sqrt(reserve0.mul(reserve1))).div(totalSupply)
            // expect(await uniconvexCollateral.refPerTok()).to.equal(expectedRefPerTok)

            // expect(await uniconvexCollateral.targetPerRef()).to.equal(fp("1"))
            // expect(await uniconvexCollateral.pricePerTarget()).to.equal(fp("1"))
            //expect(await uniconvexCollateral.strictPrice()).closeTo(fp('200').div(pair.getLiquidityValue())), 10)
            //expect(await uniconvexCollateral.strictPrice()).to.equal(await uniconvexCollateral._fallbackPrice())
            //TODO
            //expect(await uniconvexCollateral.getClaimCalldata()).to.eql([ZERO_ADDRESS, '0x'])
            // expect(await uniconvexCollateral.bal(addr1.address)).to.equal(
            //   await adjustedAmout(uniconvexWrapper, 100)
            // )
        })
    })
})
