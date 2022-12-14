import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { BigNumber, BigNumberish, Wallet } from "ethers"
import hre, { ethers, waffle } from "hardhat"
import { defaultFixture, IMPLEMENTATION } from "../../../fixtures"
import { getChainId } from "../../../../common/blockchain-utils"
import { networkConfig } from "../../../../common/configuration"
import { bn, fp, pow10 } from "../../../../common/numbers"
import {
    ERC20Mock,
    MockV3Aggregator,
    OracleLib,
    UniswapV3Wrapper,
    UniswapV3WrapperMock,
    USDCMock,
} from "../../../../typechain"
import { whileImpersonating } from "../../../utils/impersonation"
import { waitForTx } from "../../utils"
import { expect } from "chai"
import { CollateralStatus, MAX_UINT256 } from "../../../../common/constants"
import { UniswapV3UsdCollateral__factory } from "@typechain/factories/UniswapV3UsdCollateral__factory"
import { UniswapV3UsdCollateral } from "@typechain/UniswapV3UsdCollateral"
import {
    closeDeadline,
    defaultMintParams,
    deployUniswapV3WrapperMock,
    holderDAI,
    holderUSDC,
    holderUSDT,
    logBalances,
    p999,
    TMintParams,
} from "../common"
import { anyUint, anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs"

const createFixtureLoader = waffle.createFixtureLoader

const describeFork = process.env.FORK ? describe : describe.skip
describeFork(`UniswapV3Plugin - Integration - Mainnet Forking P${IMPLEMENTATION}`, function () {
    const initialBal = 20000
    let owner: SignerWithAddress
    let addr1: SignerWithAddress
    let addr2: SignerWithAddress

    let oracleLib: OracleLib

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

        it("U3W can be minted", async () => {
            const asset0 = dai
            const asset1 = usdc

            const decimals0 = await asset0.decimals()
            const decimals1 = await asset1.decimals()

            const p0 = (value: BigNumberish) => pow10(decimals0).mul(value)
            const p1 = (value: BigNumberish) => pow10(decimals1).mul(value)

            const mintParams: TMintParams = await defaultMintParams(
                asset0,
                asset1,
                p0(100),
                p1(100)
            )
            const uniswapV3Wrapper: UniswapV3Wrapper = await deployUniswapV3WrapperMock(
                dai,
                usdc,
                owner,
                mintParams,
                addr1
            )
        })

        it("Holders can remove liquidity permissionlessly", async () => {
            const asset0 = dai
            const asset1 = usdc

            const decimals0 = await asset0.decimals()
            const decimals1 = await asset1.decimals()

            const p0 = (value: BigNumberish) => pow10(decimals0).mul(value)
            const p1 = (value: BigNumberish) => pow10(decimals1).mul(value)

            await logBalances("Balances before UniswapV3Wrapper mint:", [addr1], [asset0, asset1])
            expect(await asset0.balanceOf(addr1.address)).to.be.eq(p0(initialBal))
            expect(await asset0.balanceOf(addr2.address)).to.be.eq(bn("0"))
            expect(await asset1.balanceOf(addr1.address)).to.be.eq(p1(initialBal))
            expect(await asset1.balanceOf(addr2.address)).to.be.eq(bn("0"))

            const mintParams: TMintParams = await defaultMintParams(
                asset0,
                asset1,
                p0(100),
                p1(100)
            )
            const uniswapV3Wrapper: UniswapV3Wrapper = await deployUniswapV3WrapperMock(
                asset0,
                asset1,
                owner,
                mintParams,
                addr1
            )

            await logBalances(
                "Balances after UniswapV3Wrapper mint:",
                [addr1],
                [asset0, asset1, uniswapV3Wrapper]
            )

            expect(await asset0.balanceOf(addr1.address)).to.be.closeTo(p0(19900), p0(1))
            expect(await asset0.balanceOf(addr2.address)).to.be.eq(bn("0"))
            expect(await asset1.balanceOf(addr1.address)).to.be.closeTo(p1(19900), p1(1))

            expect(await asset1.balanceOf(addr2.address)).to.be.eq(bn("0"))

            const liquidity = await uniswapV3Wrapper.totalSupply()
            const liquidityToTransfer = liquidity.div(4)

            const uniswapV3WrapperA1 = uniswapV3Wrapper.connect(addr1)
            await expect(uniswapV3WrapperA1.transfer(addr2.address, liquidityToTransfer))
                .to.emit(uniswapV3Wrapper, "Transfer")
                .withArgs(addr1.address, addr2.address, liquidityToTransfer)

            await logBalances(
                "Balances after liquidity transfer:",
                [addr1, addr2],
                [asset0, asset1, uniswapV3Wrapper]
            )

            const balance1 = await uniswapV3Wrapper.balanceOf(addr1.address)
            expect(balance1).to.be.eq(liquidity.sub(liquidityToTransfer))

            expect(await uniswapV3Wrapper.balanceOf(addr2.address)).to.be.eq(liquidityToTransfer)

            const tokenId = uniswapV3Wrapper.tokenId

            const returnedAmount0 = p0(25)
            const returnedAmount1 = p1(25)
            await expect(
                uniswapV3WrapperA1.decreaseLiquidity(
                    liquidityToTransfer,
                    p999(returnedAmount0),
                    p999(returnedAmount1),
                    await closeDeadline()
                )
            )
                .to.emit(uniswapV3Wrapper, "DecreaseWrappedLiquidity")
                .withArgs(tokenId, liquidityToTransfer, anyUint, anyUint)
            await logBalances(
                "add1 decreased liquidity:",
                [addr1, addr2],
                [asset0, asset1, uniswapV3Wrapper]
            )

            expect(await uniswapV3Wrapper.balanceOf(addr1.address)).to.be.closeTo(
                liquidity.div(2),
                10 ** 6
            )

            expect(await asset0.balanceOf(addr1.address)).to.be.closeTo(p0(19925), p0(1))

            expect(await asset1.balanceOf(addr1.address)).to.be.closeTo(p1(19925), p1(1))

            await expect(
                uniswapV3Wrapper
                    .connect(addr2)
                    .decreaseLiquidity(
                        liquidityToTransfer,
                        p999(returnedAmount0),
                        p999(returnedAmount1),
                        await closeDeadline()
                    )
            )
                .to.emit(uniswapV3Wrapper, "DecreaseWrappedLiquidity")
                .withArgs(tokenId, liquidityToTransfer, anyUint, anyUint)

            await logBalances(
                "add2 decreased liquidity:",
                [addr1, addr2],
                [dai, usdc, uniswapV3Wrapper]
            )

            expect(await uniswapV3Wrapper.balanceOf(addr2.address)).to.be.eq(bn("0"))

            expect(await asset0.balanceOf(addr2.address)).to.be.closeTo(p0(25), p0(1))
            expect(await asset1.balanceOf(addr2.address)).to.be.closeTo(p1(25), p1(1))
        })

        it("U3C can be deployed", async () => {
            const asset0 = dai
            const asset1 = usdc

            const decimals0 = await asset0.decimals()
            const decimals1 = await asset1.decimals()

            const p0 = (value: BigNumberish) => pow10(decimals0).mul(value)
            const p1 = (value: BigNumberish) => pow10(decimals1).mul(value)

            const DELAY_UNTIL_DEFAULT = bn("86400") // 24h
            const ORACLE_TIMEOUT = bn("281474976710655").div(2) // type(uint48).max / 2
            const RTOKEN_MAX_TRADE_VALUE = fp("1e6")

            const mintParams: TMintParams = await defaultMintParams(
                asset0,
                asset1,
                p0(100),
                p1(100)
            )
            const uniswapV3WrapperMock: UniswapV3WrapperMock = await deployUniswapV3WrapperMock(
                asset0,
                asset1,
                owner,
                mintParams,
                addr1
            )

            const MockV3AggregatorFactory = await ethers.getContractFactory("MockV3Aggregator")
            const mockChainlinkFeed0 = <MockV3Aggregator>(
                await MockV3AggregatorFactory.connect(addr1).deploy(8, bn("1e8"))
            )
            const mockChainlinkFeed1 = <MockV3Aggregator>(
                await MockV3AggregatorFactory.connect(addr1).deploy(8, bn("1e8"))
            )

            const UniswapV3UsdCollateralContractFactory: UniswapV3UsdCollateral__factory =
                await ethers.getContractFactory("UniswapV3UsdCollateral", {
                    libraries: { OracleLib: oracleLib.address },
                })

            const fallbackPrice = fp("1")
            const targetName = ethers.utils.formatBytes32String("UNIV3SQRT")
            const UniswapV3UsdCollateral: UniswapV3UsdCollateral =
                await UniswapV3UsdCollateralContractFactory.connect(addr1).deploy(
                    fallbackPrice,
                    fallbackPrice,
                    mockChainlinkFeed0.address,
                    mockChainlinkFeed1.address,
                    uniswapV3WrapperMock.address,
                    RTOKEN_MAX_TRADE_VALUE,
                    ORACLE_TIMEOUT,
                    targetName,
                    pow10(16).mul(5), //5%
                    100,
                    DELAY_UNTIL_DEFAULT
                )

            expect(await UniswapV3UsdCollateral.isCollateral()).to.equal(true)
            expect(await UniswapV3UsdCollateral.erc20()).to.equal(uniswapV3WrapperMock.address)
            expect(await UniswapV3UsdCollateral.erc20Decimals()).to.equal(18)
            expect(await UniswapV3UsdCollateral.targetName()).to.equal(targetName)
            expect(await UniswapV3UsdCollateral.status()).to.equal(CollateralStatus.SOUND)
            expect(await UniswapV3UsdCollateral.whenDefault()).to.equal(MAX_UINT256)
            expect(await UniswapV3UsdCollateral.defaultThreshold()).to.equal(pow10(16).mul(5))
            expect(await UniswapV3UsdCollateral.delayUntilDefault()).to.equal(DELAY_UNTIL_DEFAULT)
            expect(await UniswapV3UsdCollateral.maxTradeVolume()).to.equal(RTOKEN_MAX_TRADE_VALUE)
            expect(await UniswapV3UsdCollateral.oracleTimeout()).to.equal(ORACLE_TIMEOUT)
            expect(await UniswapV3UsdCollateral.refPerTok()).to.equal(fp("1"))
            expect(await UniswapV3UsdCollateral.pricePerTarget()).to.equal(fp("1"))
            const positions = await uniswapV3WrapperMock.positions()
            expect(await UniswapV3UsdCollateral.strictPrice()).closeTo(
                fp("200").mul(bn("1e18")).div(positions.liquidity),
                bn("1e19")
            )
            expect(await UniswapV3UsdCollateral.targetPerRef()).closeTo(pow10(24).mul(2), bn("1e17"))
            expect(await UniswapV3UsdCollateral.strictPrice()).to.be.closeTo(
                await UniswapV3UsdCollateral._fallbackPrice(), bn("1e17")
            )

            await expect(
              await UniswapV3UsdCollateral
                    .connect(addr1)
                    .claimRewards()
                )
              .not.to.emit(UniswapV3UsdCollateral, "RewardsClaimed")
        })

        it("Token holders obtain fees pro-rata of their balances", async () => {
            // Operation
            // 0. addr1 creates position and mints 200 U3W
            // 1. then burns 20 U3W and obtains liquidity back
            // 2. then transfers 100 U3W to addr2
            // 3. addr2 burns 20 U3W
            // 4. addr2 tranfers 20 U3W to addr1
            // 5. they collect fees
            // 6. addr1 mints 20 U3W
            // 7. addr2 mints 20 U3W
            // 8. they collect fees

            const asset0 = dai
            const asset1 = usdc

            const decimals0 = await asset0.decimals()
            const decimals1 = await asset1.decimals()

            const p0 = (value: BigNumberish) => pow10(decimals0).mul(value)
            const p1 = (value: BigNumberish) => pow10(decimals1).mul(value)
            const d0 = (value: BigNumberish) => pow10(decimals0 - 4).mul(value)
            const d1 = (value: BigNumberish) => pow10(decimals1 - 4).mul(value)

            const fees = [
                [10, 20],
                [10, 20],
                [10, 20],
                [10, 20],
                [10, 20],
                [10, 20],
                [10, 20],
                [10, 20],
            ]

            const liquidities = [200, 180, 180, 160, 160, 160, 180, 200, 200]

            const balances = [
                [200, 0],
                [180, 0],
                [80, 100],
                [80, 80],
                [100, 60],
                [100, 60],
                [120, 60],
                [120, 80],
                [120, 80],
            ]

            function proportio(step: number): [BigNumber, BigNumber, BigNumber, BigNumber] {
                return [
                    p0(balances[step][0]).div(liquidities[step]),
                    p1(balances[step][0]).div(liquidities[step]),
                    p0(balances[step][1]).div(liquidities[step]),
                    p1(balances[step][1]).div(liquidities[step]),
                ]
            }

            function expectedFees(step: number): [BigNumber, BigNumber, BigNumber, BigNumber] {
                return [
                    proportio(step)[0].mul(fees[step][0]),
                    proportio(step)[1].mul(fees[step][1]),
                    proportio(step)[2].mul(fees[step][0]),
                    proportio(step)[3].mul(fees[step][1]),
                ]
            }

            function accFees(stepTo: number, stepFrom: number = 0): [number, number] {
                const result: [number, number] = [0, 0]
                for (let i = stepFrom; i < stepTo; i++) {
                    result[0] += fees[i][0]
                    result[1] += fees[i][1]
                }
                return result
            }

            async function setFees(stepTo: number, stepFrom: number = 0) {
                console.log(
                    "setFees",
                    p0(accFees(stepTo, stepFrom)[0]),
                    p1(accFees(stepTo, stepFrom)[1])
                )
                await waitForTx(
                    await uniswapV3WrapperMock
                        .connect(owner)
                        .setFees(p0(accFees(stepTo, stepFrom)[0]), p1(accFees(stepTo, stepFrom)[1]))
                )
            }

            async function claimFees(addr: SignerWithAddress) {
                await waitForTx(await uniswapV3WrapperMock.connect(addr).claimRewards(addr.address))
            }

            async function accExpectedFees(
                stepTo: number,
                stepFrom: number = 0
            ): Promise<[BigNumber, BigNumber, BigNumber, BigNumber]> {
                const result: [BigNumber, BigNumber, BigNumber, BigNumber] = [
                    fp(0),
                    fp(0),
                    fp(0),
                    fp(0),
                ]
                for (let i = stepFrom; i < stepTo; i++) {
                    result[0] = result[0].add(expectedFees(i)[0])
                    result[1] = result[1].add(expectedFees(i)[1])
                    result[2] = result[2].add(expectedFees(i)[2])
                    result[3] = result[3].add(expectedFees(i)[3])
                }
                console.log("accExpectedFees", stepFrom, stepTo, result)
                return result
            }

            //1. addr1 creates position and mints 200U3W
            const mintParams: TMintParams = await defaultMintParams(
                asset0,
                asset1,
                p0(100),
                p1(100)
            )
            const balance0Before = await asset0.balanceOf(addr1.address)
            const balance1Before = await asset1.balanceOf(addr1.address)

            const uniswapV3WrapperMock: UniswapV3WrapperMock = await deployUniswapV3WrapperMock(
                asset0,
                asset1,
                owner,
                mintParams,
                addr1
            )
            const amount0SpentOnMint = balance0Before.sub(await asset0.balanceOf(addr1.address))
            const amount1SpentOnMint = balance1Before.sub(await asset1.balanceOf(addr1.address))

            // approve assets for mock rewards payouts
            const asset0Owner = await asset0.connect(owner)
            const asset1Owner = await asset1.connect(owner)
            await waitForTx(
                await asset0Owner.approve(uniswapV3WrapperMock.address, await asset0.totalSupply())
            )
            await waitForTx(
                await asset1Owner.approve(uniswapV3WrapperMock.address, await asset1.totalSupply())
            )

            const positions = await uniswapV3WrapperMock.positions()
            const minted200 = positions.liquidity

            // 2. then transfers 100 U3W to addr2
            await logBalances(
                "0. A creates position and mints 200 U3W",
                [addr1, addr2],
                [uniswapV3WrapperMock, asset0, asset1]
            )

            // 1. then burns 20 U3W and obtains liquidity back  // Accumulated Fees are 10 20 on position at the moment
            await setFees(1)

            await expect(
                uniswapV3WrapperMock
                    .connect(addr1)
                    .decreaseLiquidity(
                        minted200.div(10),
                        p999(p0(10)),
                        p999(p1(10)),
                        await closeDeadline()
                    )
            )
                .to.emit(uniswapV3WrapperMock, "DecreaseWrappedLiquidity")
                .withArgs(await uniswapV3WrapperMock.tokenId(), minted200.div(10), anyUint, anyUint)

            {
                const [value1, value2, value3, value4] = await accExpectedFees(1)
                expect(await uniswapV3WrapperMock.unclaimedRewards0(addr1.address)).closeTo(
                    value1,
                    d0(1)
                )
                expect(await uniswapV3WrapperMock.unclaimedRewards1(addr1.address)).closeTo(
                    value2,
                    d1(1)
                )
                expect(await uniswapV3WrapperMock.unclaimedRewards0(addr2.address)).closeTo(
                    value3,
                    d0(1)
                )
                expect(await uniswapV3WrapperMock.unclaimedRewards1(addr2.address)).closeTo(
                    value4,
                    d1(1)
                )
            }

            await logBalances(
                "1. B burns 20 U3W and obtains DAI and USDC back",
                [addr1, addr2],
                [uniswapV3WrapperMock, asset0, asset1]
            )

            // 2. A transfers 100 U3W to B, up till now A had 100% of liquidity
            await setFees(2)
            await waitForTx(
                await uniswapV3WrapperMock.connect(addr1).transfer(addr2.address, minted200.div(2))
            )
            await logBalances(
                "2. A transfers 100 U3W to B",
                [addr1, addr2],
                [uniswapV3WrapperMock, asset0, asset1]
            )

            // When a single address holds all the wrapper balance, this address gets all the fees
            {
                const [value1, value2, value3, value4] = await accExpectedFees(2)
                expect(await uniswapV3WrapperMock.unclaimedRewards0(addr1.address)).closeTo(
                    value1,
                    d0(1)
                )
                expect(await uniswapV3WrapperMock.unclaimedRewards1(addr1.address)).closeTo(
                    value2,
                    d1(1)
                )
                expect(await uniswapV3WrapperMock.unclaimedRewards0(addr2.address)).closeTo(
                    value3,
                    d0(1)
                )
                expect(await uniswapV3WrapperMock.unclaimedRewards1(addr2.address)).closeTo(
                    value4,
                    d1(1)
                )
            }

            // 3. addr 2 burns 20 U3W
            await setFees(3)
            await waitForTx(
                await uniswapV3WrapperMock
                    .connect(addr2)
                    .decreaseLiquidity(minted200.div(10), 0, 0, await closeDeadline())
            )

            // addr1 did not participate in the last balance-changing operation, same as before
            {
                const [value1, value2, ,] = await accExpectedFees(2)
                expect(await uniswapV3WrapperMock.unclaimedRewards0(addr1.address)).closeTo(
                    value1,
                    d0(1)
                )
                expect(await uniswapV3WrapperMock.unclaimedRewards1(addr1.address)).closeTo(
                    value2,
                    d1(1)
                )
            }

            await waitForTx(await uniswapV3WrapperMock.connect(addr2).updateUser(addr2.address))
            {
                const [, , value3, value4] = await accExpectedFees(3)
                expect(await uniswapV3WrapperMock.unclaimedRewards0(addr2.address)).closeTo(
                    value3,
                    d0(1)
                )
                expect(await uniswapV3WrapperMock.unclaimedRewards1(addr2.address)).closeTo(
                    value4,
                    d1(1)
                )
            }

            // 4. addr 2 tranfer 20U3W to addr1
            await setFees(4)
            await waitForTx(
                await uniswapV3WrapperMock.connect(addr2).transfer(addr1.address, minted200.div(10))
            )

            {
                const [value1, value2, value3, value4] = await accExpectedFees(4)
                expect(await uniswapV3WrapperMock.unclaimedRewards0(addr1.address)).closeTo(
                    value1,
                    d0(1)
                )
                expect(await uniswapV3WrapperMock.unclaimedRewards1(addr1.address)).closeTo(
                    value2,
                    d1(1)
                )
                expect(await uniswapV3WrapperMock.unclaimedRewards0(addr2.address)).closeTo(
                    value3,
                    d0(1)
                )
                expect(await uniswapV3WrapperMock.unclaimedRewards1(addr2.address)).closeTo(
                    value4,
                    d1(1)
                )
            }
            // 5. they collect fees
            await setFees(5)

            await waitForTx(await uniswapV3WrapperMock.connect(owner).setFeesSender(owner.address))

            await logBalances(
                "Balances before claim:",
                [addr1, addr2],
                [asset0, asset1, uniswapV3WrapperMock]
            )

            await claimFees(addr1)
            await claimFees(addr2)

            {
                const [value1, value2, value3, value4] = await accExpectedFees(0)
                expect(await uniswapV3WrapperMock.unclaimedRewards0(addr1.address)).closeTo(
                    value1,
                    d0(1)
                )
                expect(await uniswapV3WrapperMock.unclaimedRewards1(addr1.address)).closeTo(
                    value2,
                    d1(1)
                )
                expect(await uniswapV3WrapperMock.unclaimedRewards0(addr2.address)).closeTo(
                    value3,
                    d0(1)
                )
                expect(await uniswapV3WrapperMock.unclaimedRewards1(addr2.address)).closeTo(
                    value4,
                    d1(1)
                )
            }
            await logBalances(
                "Balances after claim:",
                [addr1, addr2],
                [asset0, asset1, uniswapV3WrapperMock]
            )

            {
                const [value1, value2, value3, value4] = await accExpectedFees(5)
                expect(await asset0.balanceOf(addr1.address)).closeTo(
                    value1
                        .add(p0(10)) // burned
                        .add(p0(initialBal))
                        .sub(amount0SpentOnMint),
                    d0(1)
                )
                expect(await asset1.balanceOf(addr1.address)).closeTo(
                    value2
                        .add(p1(10)) //burned
                        .add(p1(initialBal))
                        .sub(amount1SpentOnMint),
                    d1(100)
                )
                expect(await asset0.balanceOf(addr2.address)).closeTo(value3.add(p0(10)), d0(1))
                expect(await asset1.balanceOf(addr2.address)).closeTo(value4.add(p1(10)), d1(100))
            }

            // 6. addr1 mints 20 U3W
            await setFees(6, 5)
            await waitForTx(
                await asset0.connect(addr1).approve(uniswapV3WrapperMock.address, p0(10))
            )
            await waitForTx(
                await asset1.connect(addr1).approve(uniswapV3WrapperMock.address, p1(10))
            )
            const amount0 = p0(10)
            const amount1 = p1(10)
            const deadline = (await hre.ethers.provider.getBlock("latest")).timestamp + 600
            await waitForTx(
                await uniswapV3WrapperMock
                    .connect(addr1)
                    .increaseLiquidity(
                        amount0,
                        amount1,
                        amount0.mul(999).div(1000),
                        amount1.mul(999).div(1000),
                        deadline
                    )
            )
            {
                const [value1, value2, ,] = await accExpectedFees(6, 5)
                expect(await uniswapV3WrapperMock.unclaimedRewards0(addr1.address)).closeTo(
                    value1,
                    d0(1)
                )
                expect(await uniswapV3WrapperMock.unclaimedRewards1(addr1.address)).closeTo(
                    value2,
                    d1(1)
                )
            }

            // addr2 did not participate in the last balance-changing operation, same as before
            {
                const [, , value3, value4] = await accExpectedFees(0)
                expect(await uniswapV3WrapperMock.unclaimedRewards0(addr2.address)).closeTo(
                    value3,
                    d0(1)
                )
                expect(await uniswapV3WrapperMock.unclaimedRewards1(addr2.address)).closeTo(
                    value4,
                    d1(1)
                )
            }

            // 7. addr2 mints 20 U3W
            await setFees(7, 5)
            await waitForTx(
                await asset0.connect(addr2).approve(uniswapV3WrapperMock.address, p0(10))
            )
            await waitForTx(
                await asset1.connect(addr2).approve(uniswapV3WrapperMock.address, p1(10))
            )
            const amount02 = p0(10)
            const amount12 = p1(10)
            const deadline2 = (await hre.ethers.provider.getBlock("latest")).timestamp + 600
            const tokenId = uniswapV3WrapperMock.tokenId
            await expect(
                uniswapV3WrapperMock
                    .connect(addr2)
                    .increaseLiquidity(
                        amount02,
                        amount12,
                        amount02.mul(999).div(1000),
                        amount12.mul(999).div(1000),
                        deadline2
                    )
            ) //emit IncreaseWrappedLiquidity(tokenId, liquidity, amount0, amount1);
                .to.emit(uniswapV3WrapperMock, "IncreaseWrappedLiquidity")
                .withArgs(tokenId, anyUint, anyUint, anyUint)

            // addr1 did not participate in the last balance-changing operation, same as before
            {
                const [value1, value2, ,] = await accExpectedFees(6, 5)
                expect(await uniswapV3WrapperMock.unclaimedRewards0(addr1.address)).closeTo(
                    value1,
                    d0(1)
                )
                expect(await uniswapV3WrapperMock.unclaimedRewards1(addr1.address)).closeTo(
                    value2,
                    d1(1)
                )
            }

            {
                const [, , value3, value4] = await accExpectedFees(7, 5)
                expect(await uniswapV3WrapperMock.unclaimedRewards0(addr2.address)).closeTo(
                    value3,
                    d0(1)
                )
                expect(await uniswapV3WrapperMock.unclaimedRewards1(addr2.address)).closeTo(
                    value4,
                    d1(1)
                )
            }

            // 8. they collect fees
            await setFees(8, 5)

            //todo map holder signer asset
            await whileImpersonating(holderDAI, async (daiSigner) => {
                await asset0
                    .connect(daiSigner)
                    .transfer(uniswapV3WrapperMock.address, p0(initialBal))
            })
            await whileImpersonating(holderUSDC, async (usdcSigner) => {
                await asset1
                    .connect(usdcSigner)
                    .transfer(uniswapV3WrapperMock.address, p1(initialBal))
            })

            await logBalances(
                "Balances before claim:",
                [addr1, addr2],
                [asset0, asset1, uniswapV3WrapperMock]
            )

            await claimFees(addr1)
            await claimFees(addr2)

            {
                const [value1, value2, value3, value4] = await accExpectedFees(0)
                expect(await uniswapV3WrapperMock.unclaimedRewards0(addr1.address)).closeTo(
                    value1,
                    d0(1)
                )
                expect(await uniswapV3WrapperMock.unclaimedRewards1(addr1.address)).closeTo(
                    value2,
                    d1(1)
                )
                expect(await uniswapV3WrapperMock.unclaimedRewards0(addr2.address)).closeTo(
                    value3,
                    d0(1)
                )
                expect(await uniswapV3WrapperMock.unclaimedRewards1(addr2.address)).closeTo(
                    value4,
                    d1(1)
                )
            }
            await logBalances(
                "Balances after claim:",
                [addr1, addr2],
                [asset0, asset1, uniswapV3WrapperMock]
            )

            {
                const [value1, value2, value3, value4] = await accExpectedFees(8, 0)
                expect(await asset0.balanceOf(addr1.address)).closeTo(
                    value1
                        .add(p0(10)) // burned
                        .sub(p0(10)) // minted
                        .add(p0(initialBal))
                        .sub(mintParams.amount0Desired),
                    d0(100)
                )
                expect(await asset1.balanceOf(addr1.address)).closeTo(
                    value2
                        .add(p1(10)) //burned
                        .sub(p1(10)) // minted
                        .add(p1(initialBal))
                        .sub(mintParams.amount1Desired),
                    d1(100)
                )
                expect(await asset0.balanceOf(addr2.address)).closeTo(
                    value3
                        .add(p0(10)) // burned
                        .sub(p0(10)), // minted
                    d0(100)
                )
                expect(await asset1.balanceOf(addr2.address)).closeTo(
                    value4
                        .add(p1(10)) //burned
                        .sub(p1(10)), // minted
                    d1(100)
                )
            }
        })
    })
})

//TODO check that fees earned remain intact after decreaseLiquidity calls
//TODO @etsvigun cleanup helpers

