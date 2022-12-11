import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import hre, { ethers, network, waffle } from "hardhat"
import { BigNumber, BigNumberish, Wallet } from "ethers"
import { defaultFixture, IMPLEMENTATION } from "../../../fixtures"
import { getChainId } from "../../../../common/blockchain-utils"
import { networkConfig } from "../../../../common/configuration"
import { bn, fp, pow10, ZERO } from "../../../../common/numbers"
import { ERC20Mock, USDCMock, IBooster, Collateral, OracleLib } from "../../../../typechain"
import { whileImpersonating } from "../../../utils/impersonation"
import { waitForTx } from "../../utils"
import { expect } from "chai"
import { CollateralStatus, MAX_UINT256 } from "../../../../common/constants"
import { ICurvePool3Assets } from "@typechain/ICurvePool3Assets"
import { logBalances, logBalancesAddr } from "../common"
import forkBlockNumber from "../../fork-block-numbers"

const createFixtureLoader = waffle.createFixtureLoader

// Relevant addresses (Mainnet)
const holderDAI = "0x16b34ce9a6a6f7fc2dd25ba59bf7308e7b38e186"
const holderUSDT = "0xf977814e90da44bfa03b6295a0616a897441acec"
const holderUSDC = "0x0a59649758aa4d66e25f08dd01271e891fe52199"
// Complex Basket holders
const holderWBTC = "0xbf72da2bd84c5170618fbe5914b0eca9638d5eb5"
const holderWETH = "0xf04a5cc80b1e94c69b48f5ee68a08cd2f09a7c3e"

const describeFork = process.env.FORK ? describe : describe.skip
describeFork(`UniconvexPlugin - Integration - Mainnet Forking P${IMPLEMENTATION}`, function () {
    const initialBal = 20000
    let owner: SignerWithAddress
    let addr1: SignerWithAddress
    let addr2: SignerWithAddress

    // Tokens and Assets
    let dai: ERC20Mock
    let usdc: ERC20Mock
    let usdt: ERC20Mock

    let weth: ERC20Mock
    let wbtc: ERC20Mock

    let loadFixture: ReturnType<typeof createFixtureLoader>
    let wallet: Wallet

    let chainId: number
    let oracleLib: OracleLib

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

            const loadedFixture = await loadFixture(defaultFixture)
            oracleLib = loadedFixture.oracleLib

            const tokens = networkConfig[chainId].tokens
            ;[weth, wbtc, dai, usdt, usdc] = await Promise.all(
                [tokens.WETH!, tokens.WBTC!, tokens.DAI!, tokens.USDT!, tokens.USDC!].map(
                    async (address) => await ethers.getContractAt("ERC20Mock", address)
                )
            )

            const holders: [ERC20Mock, string][] = [
                [weth, holderWETH],
                [wbtc, holderWBTC],
                [dai, holderDAI],
                [usdt, holderUSDT],
                [usdc, holderUSDC],
            ]
            await Promise.all(
                holders.map(async ([asset, holder]) => {
                    await whileImpersonating(holder, async (signer) => {
                        const decimals = await asset.decimals()
                        const p = (value: BigNumberish) => pow10(decimals).mul(value)
                        await asset.connect(signer).transfer(addr1.address, p(initialBal))
                    })
                })
            )
        })

        it(`investigate virtual price`, async () => {
            let prevVirtualPrice = ZERO
            let prevTotalSupply = ZERO

            for (let index = 0; index < 3; index++) {
                await network.provider.request({
                    method: "hardhat_reset",
                    params: [
                        {
                            forking: {
                                jsonRpcUrl:
                                    process.env.MAINNET_RPC_URL ||
                                    process.env.ALCHEMY_MAINNET_RPC_URL ||
                                    "",
                                blockNumber:
                                    (process.env.MAINNET_BLOCK
                                        ? Number(process.env.MAINNET_BLOCK)
                                        : forkBlockNumber["default"]) +
                                    index * 100,
                            },
                        },
                    ],
                })

                const asset0 = dai
                const asset1 = usdc
                const asset2 = usdt

                const decimals0 = await asset0.decimals()
                const decimals1 = await asset1.decimals()
                const decimals2 = await asset2.decimals()

                const p0 = (value: BigNumberish) => pow10(decimals0).mul(value)
                const p1 = (value: BigNumberish) => pow10(decimals1).mul(value)
                const p2 = (value: BigNumberish) => pow10(decimals2).mul(value)

                const curveContractV2 = "0x6c3F90f043a72FA612cbac8115EE7e52BDe6E490"
                // LiquidityGauge: 0xbFcF63294aD7105dEa65aA58F8AE5BE2D9d0952A
                const stableSwap3PoolAddress = "0xbebc44782c7db0a1a60cb6fe97d0b483032ff1c7"
                const stableSwap3Pool: ICurvePool3Assets = await ethers.getContractAt(
                    "ICurvePool3Assets",
                    stableSwap3PoolAddress
                )

                const lpTokenAddress = curveContractV2

                const lpToken = await ethers.getContractAt("ERC20Mock", lpTokenAddress)

                let virtualPrice = await stableSwap3Pool.connect(addr1).get_virtual_price()

                let totalSupply = await lpToken.connect(addr1).totalSupply()

                console.log({
                    virtualPrice,
                    totalSupply,
                    div: BigNumber.from(10).pow(18).mul(virtualPrice).div(totalSupply),
                })

                if (prevTotalSupply.gt(0)) {
                    console.log({
                        diffPrice: virtualPrice.sub(prevVirtualPrice),
                        diffSupply: totalSupply.sub(prevTotalSupply),
                        diffDiv: BigNumber.from(10)
                            .pow(18)
                            .mul(prevVirtualPrice)
                            .div(prevTotalSupply)
                            .sub(BigNumber.from(10).pow(18).mul(virtualPrice).div(totalSupply)),
                    })
                }

                prevVirtualPrice = virtualPrice
                prevTotalSupply = totalSupply
            }
        })

        for (const poolName of ["StableSwap3", "TriCrypto"]) {
            it(`Convex Collateral can be deployed with curve ${poolName}`, async () => {
                // TODO: need we always raising on mint invariant?
                // https://github.com/curvefi/curve-contract/blob/b0bbf77f8f93c9c5f4e415bce9cd71f0cdee960e/contracts/pools/3pool/StableSwap3Pool.vy#L317

                // Zap depositor can be used to wrap/unwrap tokens on deposit/withdrawal
                // Deployer would use custom oracle feeds for wrapped tokens
                // https://github.com/curvefi/curve-factory/blob/b6655de2bf9c447b6e80a4e60ed1b3d20b786b34/contracts/zaps/DepositZapUSD.vy#L66
                const TriCryptoDepositZap = "0x331aF2E331bd619DefAa5DAc6c038f53FCF9F785"

                // https://curve.readthedocs.io/ref-addresses.html
                const pools = {
                    // https://github.com/curvefi/curve-contract/blob/master/contracts/pools/3pool/StableSwap3Pool.vy
                    // StableSwap3Pool for DAI, USDC, and USDT
                    StableSwap3: {
                        asset0: dai,
                        asset1: usdc,
                        asset2: usdt,
                        // CurveTokenV2
                        lpTokenAddress: "0x6c3F90f043a72FA612cbac8115EE7e52BDe6E490",
                        curvePoolAddress: "0xbebc44782c7db0a1a60cb6fe97d0b483032ff1c7",
                        feedPrices: [bn("1e8"), bn("17000e8"), bn("1300e8")],
                        mockFeedDecimals: 8,
                    },
                    // Pool for USDT/BTC/ETH or similar
                    // USD-like asset should be first, ETH should be last
                    //https://github.com/curvefi/curve-crypto-contract/blob/master/contracts/tricrypto/CurveCryptoSwap.vy
                    TriCrypto: {
                        asset0: usdt,
                        asset1: wbtc,
                        asset2: weth,
                        // CurveTokenV4
                        lpTokenAddress: "0xcA3d75aC011BF5aD07a98d02f18225F9bD9A6BDF",
                        curvePoolAddress: "0x80466c64868E1ab14a1Ddf27A676C3fcBE638Fe5",
                        feedPrices: [bn("1e8"), bn("17000e8"), bn("1300e8")],
                        mockFeedDecimals: 8,
                    },
                }

                const {
                    asset0,
                    asset1,
                    asset2,
                    lpTokenAddress,
                    curvePoolAddress,
                    feedPrices,
                    mockFeedDecimals,
                } = pools[poolName]

                const decimals0 = await asset0.decimals()
                const decimals1 = await asset1.decimals()
                const decimals2 = await asset2.decimals()

                const p0 = (value: BigNumberish) => pow10(decimals0).mul(value)
                const p1 = (value: BigNumberish) => pow10(decimals1).mul(value)
                const p2 = (value: BigNumberish) => pow10(decimals2).mul(value)

                //curve view

                const curvePool3Assets: ICurvePool3Assets = await ethers.getContractAt(
                    "ICurvePool3Assets",
                    curvePoolAddress
                )

                const lpToken = await ethers.getContractAt("ERC20Mock", lpTokenAddress)

                await waitForTx(
                    await asset0.connect(addr1).approve(curvePool3Assets.address, p0(1000))
                )
                await waitForTx(
                    await asset1.connect(addr1).approve(curvePool3Assets.address, p1(10))
                )
                await waitForTx(
                    await asset2.connect(addr1).approve(curvePool3Assets.address, p2(100))
                )

                await waitForTx(
                    await curvePool3Assets.connect(addr1).add_liquidity(
                        [p0(1000), p1(10), p2(100)],
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

                // on deploy better to use constant address
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

                await waitForTx(
                    await lpToken.connect(addr1).approve(booster.address, lpTokenBalance1)
                )

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

                const mockV3AggregatorFactory = await ethers.getContractFactory("MockV3Aggregator")

                const mockChainlinkFeeds = await Promise.all(
                    feedPrices.map(async (feedPrice) => {
                        return await mockV3AggregatorFactory
                            .connect(addr1)
                            .deploy(mockFeedDecimals, feedPrice)
                    })
                )

                const uniconvexCollateral3ContractFactory = await ethers.getContractFactory(
                    "UniconvexCollateral3",
                    {
                        libraries: { OracleLib: oracleLib.address },
                    }
                )

                const fallbackPrice = fp("1")
                const targetName = ethers.utils.formatBytes32String(`CONVEXLP`)
                const uniconvexCollateral3 = await uniconvexCollateral3ContractFactory
                    .connect(addr1)
                    .deploy(
                        matchedPools[0].index,
                        fallbackPrice,
                        [
                            mockChainlinkFeeds[0].address,
                            mockChainlinkFeeds[1].address,
                            mockChainlinkFeeds[2].address,
                        ],
                        RTOKEN_MAX_TRADE_VALUE,
                        ORACLE_TIMEOUT,
                        targetName,
                        DELAY_UNTIL_DEFAULT
                    )

                const actualStrictPrice = await uniconvexCollateral3.strictPrice()

                await logBalances(
                    "after deploy Collateral",
                    [addr1, uniconvexCollateral3],
                    [asset0, asset1, asset2, lpToken, convexLpToken]
                )

                const convexLpTokenLiquidityBefore = await convexLpToken
                    .connect(addr1)
                    .balanceOf(addr1.address)

                await waitForTx(await booster.connect(addr1).withdrawAll(matchedPools[0].index))

                const convexLpTokenLiquidity = convexLpTokenLiquidityBefore.sub(
                    await convexLpToken.connect(addr1).balanceOf(addr1.address)
                )

                await logBalances(
                    "after withdrawal Convex lp token",
                    [addr1, uniconvexCollateral3],
                    [asset0, asset1, asset2, lpToken, convexLpToken]
                )

                const curveLpTokenLiquidity = await lpToken.connect(addr1).balanceOf(addr1.address)
                const balance0before = await asset0.connect(addr1).balanceOf(addr1.address)
                const balance1before = await asset1.connect(addr1).balanceOf(addr1.address)
                const balance2before = await asset2.connect(addr1).balanceOf(addr1.address)

                await waitForTx(
                    await curvePool3Assets.connect(addr1).remove_liquidity(
                        curveLpTokenLiquidity,
                        [0, 0, 0] //min_mint_amount
                    )
                )

                await logBalances(
                    "after burning Curve LP",
                    [owner, addr1],
                    [asset0, asset1, asset2, lpToken]
                )

                const balance0after = await asset0.connect(addr1).balanceOf(addr1.address)
                const balance1after = await asset1.connect(addr1).balanceOf(addr1.address)
                const balance2after = await asset2.connect(addr1).balanceOf(addr1.address)

                const amount0 = balance0after.sub(balance0before)
                const amount1 = balance1after.sub(balance1before)
                const amount2 = balance2after.sub(balance2before)

                expect(curveLpTokenLiquidity).to.equal(convexLpTokenLiquidity)

                const decimals = await convexLpToken.decimals()

                console.log({ amount0, amount1, amount2, curveLpTokenLiquidity, decimals })

                const price0Adj = pow10(18 - mockFeedDecimals)
                    .mul(amount0)
                    .mul(feedPrices[0])
                    .div(pow10(decimals0))
                const price1Adj = pow10(18 - mockFeedDecimals)
                    .mul(amount1)
                    .mul(feedPrices[1])
                    .div(pow10(decimals1))
                const price2Adj = pow10(18 - mockFeedDecimals)
                    .mul(amount2)
                    .mul(feedPrices[2])
                    .div(pow10(decimals2))

                console.log({ price0Adj, price1Adj, amount2, price2Adj })

                const expectedStrictPrice = price0Adj
                    .add(price1Adj)
                    .add(price2Adj)
                    .mul(pow10(decimals))
                    .div(convexLpTokenLiquidity)

                expect(actualStrictPrice).closeTo(expectedStrictPrice, pow10(18 - 4))

                expect(await uniconvexCollateral3.isCollateral()).to.equal(true)
                expect(await uniconvexCollateral3.erc20()).to.equal(convexLpToken.address)
                expect(await uniconvexCollateral3.erc20Decimals()).to.equal(18)
                expect(await uniconvexCollateral3.targetName()).to.equal(targetName)
                expect(await uniconvexCollateral3.status()).to.equal(CollateralStatus.SOUND)
                expect(await uniconvexCollateral3.whenDefault()).to.equal(MAX_UINT256)
                //expect(await uniconvexCollateral.defaultThreshold()).to.equal(DEFAULT_THRESHOLD)
                expect(await uniconvexCollateral3.delayUntilDefault()).to.equal(DELAY_UNTIL_DEFAULT)
                expect(await uniconvexCollateral3.maxTradeVolume()).to.equal(RTOKEN_MAX_TRADE_VALUE)
                expect(await uniconvexCollateral3.oracleTimeout()).to.equal(ORACLE_TIMEOUT)

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
        }
    })
})
