import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { BigNumber, BigNumberish, Wallet } from 'ethers'
import hre, { ethers, waffle } from 'hardhat'
import { defaultFixture, IMPLEMENTATION } from '../../fixtures'
import { getChainId } from '../../../common/blockchain-utils'
import { networkConfig } from '../../../common/configuration'
import { bn, fp, pow10, toBNDecimals } from '../../../common/numbers'
import { ERC20Mock, MockV3Aggregator, UniswapV3Wrapper, UniswapV3WrapperMock, USDCMock } from '../../../typechain'
import { whileImpersonating } from '../../utils/impersonation'
import { waitForTx } from '../utils'
import { expect } from 'chai'
import {
    adjustedAmout as adjustedAmount,
    deployUniswapV3Wrapper,
    logBalances,
    MAX_TICK,
    MIN_TICK,
    TMintParams,
} from './common'
import { CollateralStatus, MAX_UINT256, ZERO_ADDRESS } from '../../../common/constants'
import { UniswapV3Collateral__factory } from '@typechain/factories/UniswapV3Collateral__factory'
import { UniswapV3Collateral } from '@typechain/UniswapV3Collateral'

const createFixtureLoader = waffle.createFixtureLoader

const P18 = BigNumber.from(10).pow(18)
const P6 = BigNumber.from(10).pow(6)

// Relevant addresses (Mainnet)
const holderDAI = '0x16b34ce9a6a6f7fc2dd25ba59bf7308e7b38e186'
const holderUSDT = '0xf977814e90da44bfa03b6295a0616a897441acec'
const holderUSDC = '0x0a59649758aa4d66e25f08dd01271e891fe52199'

const describeFork = process.env.FORK ? describe : describe.skip
describeFork(`UniswapV3Plugin - Integration - Mainnet Forking P${IMPLEMENTATION}`, function () {
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

    describe('Assets/Collateral', () => {
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
            dai = <ERC20Mock>await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.DAI!)
            await whileImpersonating(holderDAI, async (daiSigner) => {
                await dai.connect(daiSigner).transfer(addr1.address, await adjustedAmount(dai, initialBal))
            })
            usdc = <USDCMock>await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.USDC!)
            await whileImpersonating(holderUSDC, async (usdcSigner) => {
                await usdc.connect(usdcSigner).transfer(addr1.address, await adjustedAmount(usdc, initialBal))
            })
            usdt = <USDCMock>await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.USDT || '')
            await whileImpersonating(holderUSDT, async (usdtSigner) => {
                await usdt.connect(usdtSigner).transfer(addr1.address, await adjustedAmount(usdt, initialBal))
            })
        })

        it('U3W can be minted', async () => {
            const asset0 = dai
            const asset1 = usdc

            const uniswapV3Wrapper: UniswapV3Wrapper = await deployUniswapV3Wrapper(owner)

            const mintParams: TMintParams = {
                token0: asset0.address,
                token1: asset1.address,
                fee: 100,
                tickLower: MIN_TICK,
                tickUpper: MAX_TICK,
                amount0Desired: await adjustedAmount(asset0, 100),
                amount1Desired: await adjustedAmount(asset1, 100),
                amount0Min: 0, //require(amount0 >= params.amount0Min && amount1 >= params.amount1Min, 'Price slippage check');
                amount1Min: 0,
                recipient: ZERO_ADDRESS,
                deadline: 0, //rewrite in constructor
            }

            await waitForTx(await asset0.connect(addr1).approve(uniswapV3Wrapper.address, mintParams.amount0Desired))
            await waitForTx(await asset1.connect(addr1).approve(uniswapV3Wrapper.address, mintParams.amount1Desired))
            await waitForTx(await uniswapV3Wrapper.connect(addr1).mint(mintParams))
        })

        it('Holders can remove liquidity permissionlessly', async () => {
            const asset0 = dai
            const asset1 = usdc

            const uniswapV3Wrapper: UniswapV3Wrapper = await deployUniswapV3Wrapper(owner)

            const mintParams: TMintParams = {
                token0: asset0.address,
                token1: asset1.address,
                fee: 100,
                tickLower: MIN_TICK,
                tickUpper: MAX_TICK,
                amount0Desired: await adjustedAmount(asset0, 100),
                amount1Desired: await adjustedAmount(asset1, 100),
                amount0Min: 0,
                amount1Min: 0,
                recipient: ZERO_ADDRESS,
                deadline: 0,
            }

            await logBalances('Balances before UniswapV3Wrapper mint:', [addr1], [asset0, asset1, uniswapV3Wrapper])

            expect(await asset0.balanceOf(addr1.address)).to.be.eq(await adjustedAmount(asset0, initialBal))
            expect(await asset0.balanceOf(addr2.address)).to.be.eq(bn('0'))
            expect(await asset1.balanceOf(addr1.address)).to.be.eq(await adjustedAmount(asset1, initialBal))
            expect(await asset1.balanceOf(addr2.address)).to.be.eq(bn('0'))

            await waitForTx(await asset0.connect(addr1).approve(uniswapV3Wrapper.address, mintParams.amount0Desired))
            await waitForTx(await asset1.connect(addr1).approve(uniswapV3Wrapper.address, mintParams.amount1Desired))
            await waitForTx(await uniswapV3Wrapper.connect(addr1).mint(mintParams))

            await logBalances('Balances after UniswapV3Wrapper mint:', [addr1], [asset0, asset1, uniswapV3Wrapper])

            expect(await asset0.balanceOf(addr1.address)).to.be.closeTo(
                await adjustedAmount(asset0, 19900),
                await adjustedAmount(asset0, 1)
            )
            expect(await asset0.balanceOf(addr2.address)).to.be.eq(bn('0'))
            expect(await asset1.balanceOf(addr1.address)).to.be.closeTo(
                await adjustedAmount(asset1, 19900),
                await adjustedAmount(asset1, 1)
            )

            expect(await asset1.balanceOf(addr2.address)).to.be.eq(bn('0'))

            // const positions = await uniswapV3Wrapper.positions()
            const liquidity = await uniswapV3Wrapper.totalSupply()
            const liquidityToTransfer = liquidity.div(4)

            await waitForTx(await uniswapV3Wrapper.connect(addr1).transfer(addr2.address, liquidityToTransfer))
            await logBalances('Balances after liquidity transfer:', [addr1, addr2], [asset0, asset1, uniswapV3Wrapper])

            const balance1 = await uniswapV3Wrapper.balanceOf(addr1.address)
            expect(balance1).to.be.eq(liquidity.sub(liquidityToTransfer))

            expect(await uniswapV3Wrapper.balanceOf(addr2.address)).to.be.eq(liquidityToTransfer)

            await waitForTx(await uniswapV3Wrapper.connect(addr1).decreaseLiquidity(liquidityToTransfer))
            await logBalances('add1 decreased liquidity:', [addr1, addr2], [asset0, asset1, uniswapV3Wrapper])

            expect(await uniswapV3Wrapper.balanceOf(addr1.address)).to.be.closeTo(liquidity.div(2), 10 ** 6)

            expect(await asset0.balanceOf(addr1.address)).to.be.closeTo(
                await adjustedAmount(asset0, 19925),
                await adjustedAmount(asset0, 1)
            )

            expect(await asset1.balanceOf(addr1.address)).to.be.closeTo(
                await adjustedAmount(asset1, 19925),
                await adjustedAmount(asset1, 1)
            )

            await waitForTx(await uniswapV3Wrapper.connect(addr2).decreaseLiquidity(liquidityToTransfer))

            await logBalances('add2 decreased liquidity:', [addr1, addr2], [dai, usdc, uniswapV3Wrapper])

            expect(await uniswapV3Wrapper.balanceOf(addr2.address)).to.be.eq(bn('0'))

            expect(await asset0.balanceOf(addr2.address)).to.be.closeTo(
                await adjustedAmount(asset0, 25),
                await adjustedAmount(asset0, 1)
            )
            expect(await asset1.balanceOf(addr2.address)).to.be.closeTo(
                await adjustedAmount(asset1, 25),
                await adjustedAmount(asset1, 1)
            )
        })

        it('U3C can be deployed', async () => {
            const DELAY_UNTIL_DEFAULT = bn('86400') // 24h
            const ORACLE_TIMEOUT = bn('281474976710655').div(2) // type(uint48).max / 2
            const RTOKEN_MAX_TRADE_VALUE = fp('1e6')

            const uniswapV3Wrapper: UniswapV3Wrapper = await deployUniswapV3Wrapper(owner)
            const asset0 = dai
            const asset1 = usdc

            const mintParams: TMintParams = {
                token0: asset0.address,
                token1: asset1.address,
                fee: 100, //0.01%
                tickLower: MIN_TICK,
                tickUpper: MAX_TICK,
                amount0Desired: await adjustedAmount(asset0, 100),
                amount1Desired: await adjustedAmount(asset1, 100),
                amount0Min: 0,
                amount1Min: 0,
                recipient: ZERO_ADDRESS,
                deadline: 0,
            }
            await waitForTx(await asset0.connect(addr1).approve(uniswapV3Wrapper.address, mintParams.amount0Desired))
            await waitForTx(await asset1.connect(addr1).approve(uniswapV3Wrapper.address, mintParams.amount1Desired))
            await waitForTx(await uniswapV3Wrapper.connect(addr1).mint(mintParams))

            const MockV3AggregatorFactory = await ethers.getContractFactory('MockV3Aggregator')
            const mockChainlinkFeed0 = <MockV3Aggregator>(
                await MockV3AggregatorFactory.connect(addr1).deploy(await dai.decimals(), bn('1e8'))
            )
            const mockChainlinkFeed1 = <MockV3Aggregator>(
                await MockV3AggregatorFactory.connect(addr1).deploy(await usdc.decimals(), bn('1e8'))
            )

            const uniswapV3CollateralContractFactory: UniswapV3Collateral__factory = await ethers.getContractFactory(
                'UniswapV3Collateral'
            )

            const fallbackPrice = fp('1')
            const targetName = ethers.utils.formatBytes32String('USD')
            const uniswapV3Collateral: UniswapV3Collateral = <UniswapV3Collateral>(
                await uniswapV3CollateralContractFactory
                    .connect(addr1)
                    .deploy(
                        fallbackPrice,
                        mockChainlinkFeed0.address,
                        mockChainlinkFeed1.address,
                        uniswapV3Wrapper.address,
                        RTOKEN_MAX_TRADE_VALUE,
                        ORACLE_TIMEOUT,
                        targetName,
                        DELAY_UNTIL_DEFAULT
                    )
            )

            expect(await uniswapV3Collateral.isCollateral()).to.equal(true)
            expect(await uniswapV3Collateral.erc20()).to.equal(uniswapV3Wrapper.address)
            expect(await uniswapV3Collateral.erc20Decimals()).to.equal(18)
            expect(await uniswapV3Collateral.targetName()).to.equal(ethers.utils.formatBytes32String('USD'))
            expect(await uniswapV3Collateral.status()).to.equal(CollateralStatus.SOUND)
            expect(await uniswapV3Collateral.whenDefault()).to.equal(MAX_UINT256)
            //expect(await uniswapV3Collateral.defaultThreshold()).to.equal(DEFAULT_THRESHOLD)
            expect(await uniswapV3Collateral.delayUntilDefault()).to.equal(DELAY_UNTIL_DEFAULT)
            expect(await uniswapV3Collateral.maxTradeVolume()).to.equal(RTOKEN_MAX_TRADE_VALUE)
            expect(await uniswapV3Collateral.oracleTimeout()).to.equal(ORACLE_TIMEOUT)
            expect(await uniswapV3Collateral.refPerTok()).to.equal(fp('1'))
            expect(await uniswapV3Collateral.targetPerRef()).to.equal(fp('1'))
            expect(await uniswapV3Collateral.pricePerTarget()).to.equal(fp('1'))
            // expect(await uniswapV3Collateral.strictPrice()).to.equal(fp('200'))
            //expect(await uniswapV3Collateral.getClaimCalldata()).to.eql([ZERO_ADDRESS, '0x'])
            // expect(await uniswapV3Collateral.bal(addr1.address)).to.equal(
            //   await adjustedAmout(uniswapV3Wrapper, 100)
            // )
        })

        it('Token holders obtain fees pro-rata of their balances', async () => {
            // Operation                                         unclaimed fees for asset0 asset1
            // 0. addr1 creates position and mints 200 U3W                          0      0
            // 1. then burns 20 U3W and obtains liquidity back                     10     20
            // 2. then transfers 100 U3W to addr2                                  20     30
            // 3. addr2 burns 20 U3W                                               30     40
            // 4. addr2 tranfers 20 U3W to addr1                                   40     50
            // 5. they collect fees                                                50     60

            // The expected overall fees
            // 0. addr1 0, 0
            //    addr2 0, 0
            // 1. addr1 200/200 * 10, 200/200 * 20
            //    addr2 0, 0
            // 2. addr1 180/180 * (20 - 10), 180/180 * (30 - 20)
            //    addr2 0, 0     note: addr2 just obtain tokens and don't collect fees before
            // 3. addr1 80/180 * (30 - 20), 80/180 * (40 - 30) note: addr2 just burns 20 tokens but we count prev period
            //    addr2 100/180 * (30 - 20), 100/180 * (40 - 30)
            // 4. addr1 80/160 * (40-30), (80/160) * (50 - 40)
            //    addr2 80/160 * (40-30), (80/160) * (50 - 40)
            // 5. addr1 100/160 * (50-40), (100/160) * (60 - 50)
            //    addr2 60/160 * (50-40), 60/160 * (60-50)
            // Averall collected
            // addr1 sum(column), sum(column)
            // addr1 sum(column), sum(column)



            const asset0 = dai
            const asset1 = usdc

            const decimals0 = await asset0.decimals()
            const decimals1 = await asset1.decimals()

            const p0 = (value: BigNumberish) => pow10(decimals0).mul(value)
            const p1 = (value: BigNumberish) => pow10(decimals1).mul(value)
            const d0 = (value: BigNumberish) => pow10(decimals0 - 5).mul(value)
            const d1 = (value: BigNumberish) => pow10(decimals1 - 5).mul(value)

            const expectedFeesAtStage: [BigNumber, BigNumber, BigNumber, BigNumber][] = [
                [p0(0), p1(0), p0(0), p1(0)],
                [
                    p0(200)
                        .div(200)
                        .mul(10 - 0),
                    p1(200)
                        .div(200)
                        .mul(20 - 0),
                    p0(0),
                    p1(0),
                ],
                [
                    p0(180)
                        .div(180)
                        .mul(20 - 10),
                    p1(180)
                        .div(180)
                        .mul(30 - 20),
                    p0(0),
                    p1(0),
                ],
                [
                    p0(80)
                        .div(180)
                        .mul(30 - 20),
                    p1(80)
                        .div(180)
                        .mul(40 - 30),
                    p0(100)
                        .div(180)
                        .mul(30 - 20),
                    p1(100)
                        .div(180)
                        .mul(40 - 30),
                ],
                [
                    p0(80)
                        .div(160)
                        .mul(40 - 30),
                    p1(80)
                        .div(160)
                        .mul(50 - 40),
                    p0(80)
                        .div(160)
                        .mul(40 - 30),
                    p1(80)
                        .div(160)
                        .mul(50 - 40),
                ],
                [
                    p0(100)
                        .div(160)
                        .mul(50 - 40),
                    p1(100)
                        .div(160)
                        .mul(60 - 50),
                    p0(60)
                        .div(160)
                        .mul(50 - 40),
                    p1(60)
                        .div(160)
                        .mul(60 - 50),
                ],
            ]

            async function accumulatedFees(stage: number): Promise<[BigNumber, BigNumber, BigNumber, BigNumber]> {
                const result: [BigNumber, BigNumber, BigNumber, BigNumber] = [fp(0), fp(0), fp(0), fp(0)]
                for (let i = 0; i <= stage; i++) {
                    result[0] = result[0].add(expectedFeesAtStage[i][0])
                    result[1] = result[1].add(expectedFeesAtStage[i][1])
                    result[2] = result[2].add(expectedFeesAtStage[i][2])
                    result[3] = result[3].add(expectedFeesAtStage[i][3])
                }
                console.log('accumulatedFees', stage, result)
                return result
            }

            //1. addr1 creates position and mints 200U3W     // Accumulated Fees are 0 0 on position at the moment
            const uniswapV3WrapperContractFactory = await ethers.getContractFactory('UniswapV3WrapperMock')
            const uniswapV3WrapperMock: UniswapV3WrapperMock = <UniswapV3WrapperMock>(
                await uniswapV3WrapperContractFactory.connect(owner).deploy('UniswapV3WrapperToken', 'U3W')
            )

            const mintParams: TMintParams = {
                token0: asset0.address,
                token1: asset1.address,
                fee: 100, //0.01%
                tickLower: MIN_TICK,
                tickUpper: MAX_TICK,
                amount0Desired: p0(100),
                amount1Desired: p1(100),
                amount0Min: 0,
                amount1Min: 0,
                recipient: ZERO_ADDRESS,
                deadline: 0,
            }
            await waitForTx(await asset0.connect(addr1).approve(uniswapV3WrapperMock.address, mintParams.amount0Desired))
            await waitForTx(await asset1.connect(addr1).approve(uniswapV3WrapperMock.address, mintParams.amount1Desired))
            await waitForTx(await uniswapV3WrapperMock.connect(addr1).mint(mintParams))

            const positions = await uniswapV3WrapperMock.positions()
            const minted200 = positions.liquidity

            // 0. addr1 creates position and mints 200 U3W      // Accumulated Fees are  0  0 on position at the moment
            // 1. then burns 20 U3W and obtains liquidity back  // 10 20
            // 2. then transfers 100 U3W to addr2               // 20 30
            await logBalances(
                '0. A creates position and mints 200 U3W',
                [addr1, addr2],
                [uniswapV3WrapperMock, asset0, asset1]
            )

            // 1. then burns 20 U3W and obtains liquidity back  // Accumulated Fees are 10 20 on position at the moment
            await waitForTx(await uniswapV3WrapperMock.connect(owner).setFees(p0(10), p1(20)))
            await waitForTx(await uniswapV3WrapperMock.connect(addr1).decreaseLiquidity(minted200.div(10)))
            {
                const [value1, value2, value3, value4] = await accumulatedFees(1)
                expect(await uniswapV3WrapperMock.unclaimedRewards0(addr1.address)).to.closeTo(
                    value1, d0(1))
                expect(await uniswapV3WrapperMock.unclaimedRewards1(addr1.address)).to.closeTo(
                    value2, d1(1))
                expect(await uniswapV3WrapperMock.unclaimedRewards0(addr2.address)).to.closeTo(
                    value3, d0(1))
                expect(await uniswapV3WrapperMock.unclaimedRewards1(addr2.address)).to.closeTo(
                    value4, d1(1))
            }

            await logBalances(
                '1. B burns 20 U3W and obtains DAI and USDC back',
                [addr1, addr2],
                [uniswapV3WrapperMock, asset0, asset1]
            )

            // 2. A transfers 100 U3W to B, up till now A had 100% of liquidity
            await waitForTx(await uniswapV3WrapperMock.connect(owner).setFees(p0(20), p1(30)))
            await waitForTx(await uniswapV3WrapperMock.connect(addr1).transfer(addr2.address, minted200.div(2))) //now addr2 has 100/180 of liquidity
            await logBalances('2. A transfers 100 U3W to B', [addr1, addr2], [uniswapV3WrapperMock, asset0, asset1])

            // When a single address holds all the wrapper balance, this address gets all the fees
            {
                const [value1, value2, value3, value4] = await accumulatedFees(2)
                expect(await uniswapV3WrapperMock.unclaimedRewards0(addr1.address)).to.closeTo(
                    value1, d0(1))
                expect(await uniswapV3WrapperMock.unclaimedRewards1(addr1.address)).to.closeTo(
                    value2, d1(1))
                expect(await uniswapV3WrapperMock.unclaimedRewards0(addr2.address)).to.closeTo(
                    value3, d0(1))
                expect(await uniswapV3WrapperMock.unclaimedRewards1(addr2.address)).to.closeTo(
                    value4, d1(1))
            }

            // 3. addr 2 burns 20 U3W
            await waitForTx(await uniswapV3WrapperMock.connect(owner).setFees(p0(30), p1(40)))
            await waitForTx(await uniswapV3WrapperMock.connect(addr2).decreaseLiquidity(minted200.div(10))) //now B has 50% of liquidity


            // addr1 did not participate in the last balance-changing operation, same as before
            {
                const [value1, value2, ,] = await accumulatedFees(2)
                expect(await uniswapV3WrapperMock.unclaimedRewards0(addr1.address)).to.closeTo(
                    value1, d0(1))
                expect(await uniswapV3WrapperMock.unclaimedRewards1(addr1.address)).to.closeTo(
                    value2, d1(1))
            }

            await waitForTx(await uniswapV3WrapperMock.connect(addr2).updateUser(addr2.address))
            {
                const [, , value3, value4] = await accumulatedFees(3)
                expect(await uniswapV3WrapperMock.unclaimedRewards0(addr2.address)).to.closeTo(
                    value3, d0(1))
                expect(await uniswapV3WrapperMock.unclaimedRewards1(addr2.address)).to.closeTo(
                    value4, d1(1))
            }

            // 4. addr 2 tranfer 20U3W to addr1
            await waitForTx(await uniswapV3WrapperMock.setFees(p0(40), p1(50)))
            await waitForTx(await uniswapV3WrapperMock.connect(addr2).transfer(addr1.address, minted200.div(10)))

            {
                const [value1, value2, value3, value4] = await accumulatedFees(4)
                expect(await uniswapV3WrapperMock.unclaimedRewards0(addr1.address)).to.closeTo(
                    value1, d0(1))
                expect(await uniswapV3WrapperMock.unclaimedRewards1(addr1.address)).to.closeTo(
                    value2, d1(1))
                expect(await uniswapV3WrapperMock.unclaimedRewards0(addr2.address)).to.closeTo(
                    value3, d0(1))
                expect(await uniswapV3WrapperMock.unclaimedRewards1(addr2.address)).to.closeTo(
                    value4, d1(1))
            }
            // 5. they collect fees                           // Accumulated Fees are 50 60 on position at the moment
            await waitForTx(await uniswapV3WrapperMock.setFees(p0(50), p1(60)))

            //todo map holder signer asset
            await whileImpersonating(holderDAI, async (daiSigner) => {
                await asset0
                    .connect(daiSigner)
                    .transfer(uniswapV3WrapperMock.address, await adjustedAmount(asset0, initialBal))
            })
            await whileImpersonating(holderUSDC, async (usdcSigner) => {
                await asset1
                    .connect(usdcSigner)
                    .transfer(uniswapV3WrapperMock.address, await adjustedAmount(asset1, initialBal))
            })

            await logBalances('Balances before claim:', [addr1, addr2], [asset0, asset1, uniswapV3WrapperMock])

            await waitForTx(await uniswapV3WrapperMock.connect(addr1).claimRewards(addr1.address))
            await waitForTx(await uniswapV3WrapperMock.connect(addr2).claimRewards(addr2.address))

            {
                const [value1, value2, value3, value4] = await accumulatedFees(0)
                expect(await uniswapV3WrapperMock.unclaimedRewards0(addr1.address)).to.closeTo(
                    value1, d0(1))
                expect(await uniswapV3WrapperMock.unclaimedRewards1(addr1.address)).to.closeTo(
                    value2, d1(1))
                expect(await uniswapV3WrapperMock.unclaimedRewards0(addr2.address)).to.closeTo(
                    value3, d0(1))
                expect(await uniswapV3WrapperMock.unclaimedRewards1(addr2.address)).to.closeTo(
                    value4, d1(1))
            }
            await logBalances('Balances after claim:', [addr1, addr2], [asset0, asset1, uniswapV3WrapperMock])

            {
                const [value1, value2, value3, value4] = await accumulatedFees(5)
                expect(await asset0.balanceOf(addr1.address)).to.closeTo(
                    value1
                    .add(p0(10)) // burned
                    .add(p0(initialBal)).sub(mintParams.amount0Desired)
                    , d0(1))
                expect(await asset1.balanceOf(addr1.address)).to.closeTo(
                    value2
                    .add(p1(10)) //burned
                    .add(p1(initialBal)).sub(mintParams.amount1Desired)
                    , d1(100))
                expect(await asset0.balanceOf(addr2.address)).to.closeTo(
                    value3
                    .add(p0(10))
                    , d0(1))
                expect(await asset1.balanceOf(addr2.address)).to.closeTo(
                    value4
                    .add(p1(10))
                    , d1(100))
            }

        })
    })
})

//TODO check that fees earned remain intact after decreaseLiquidity calls
//TODO @etsvigun cleanup helpers
