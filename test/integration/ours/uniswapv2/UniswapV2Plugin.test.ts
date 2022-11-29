//
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { BigNumber, BigNumberish, Wallet } from 'ethers'
import hre, { ethers, waffle } from 'hardhat'
import { defaultFixture, IMPLEMENTATION } from '../../../fixtures'
import { getChainId } from '../../../../common/blockchain-utils'
import { networkConfig } from '../../../../common/configuration'
import { bn, fp, pow10 } from '../../../../common/numbers'
import { ERC20Mock, MockV3Aggregator, USDCMock } from '../../../../typechain'
import { whileImpersonating } from '../../../utils/impersonation'
import { waitForTx } from '../../utils'
import { expect } from 'chai'
import { defaultMintParams, logBalances, TMintParams } from '../common'
import { CollateralStatus, MAX_UINT256 } from '../../../../common/constants'
import { UniswapV2Collateral__factory } from '@typechain/factories/UniswapV2Collateral__factory'
import { UniswapV2Collateral } from '@typechain/UniswapV2Collateral'
import {Token, CurrencyAmount} from '@uniswap/sdk-core'
import {Pair} from '@uniswap/v2-sdk'

const createFixtureLoader = waffle.createFixtureLoader

// Relevant addresses (Mainnet)
const holderDAI = '0x16b34ce9a6a6f7fc2dd25ba59bf7308e7b38e186'
const holderUSDT = '0xf977814e90da44bfa03b6295a0616a897441acec'
const holderUSDC = '0x0a59649758aa4d66e25f08dd01271e891fe52199'

const describeFork = process.env.FORK ? describe : describe.skip
describeFork(`UniswapV2Plugin - Integration - Mainnet Forking P${IMPLEMENTATION}`, function () {
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
                const decimals = await dai.decimals()
                const p = (value: BigNumberish) => pow10(decimals).mul(value)
                await dai.connect(daiSigner).transfer(addr1.address, p(initialBal))
            })
            usdc = <USDCMock>await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.USDC!)
            await whileImpersonating(holderUSDC, async (usdcSigner) => {
                const decimals = await usdc.decimals()
                const p = (value: BigNumberish) => pow10(decimals).mul(value)
                await usdc.connect(usdcSigner).transfer(addr1.address, p(initialBal))
            })
            usdt = <USDCMock>await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.USDT || '')
            await whileImpersonating(holderUSDT, async (usdtSigner) => {
                const decimals = await usdt.decimals()
                const p = (value: BigNumberish) => pow10(decimals).mul(value)
                await usdt.connect(usdtSigner).transfer(addr1.address, p(initialBal))
            })
            dai = <ERC20Mock>await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.DAI!)
            await whileImpersonating(holderDAI, async (daiSigner) => {
                const decimals = await dai.decimals()
                const p = (value: BigNumberish) => pow10(decimals).mul(value)
                await dai.connect(daiSigner).transfer(owner.address, p(initialBal))
            })
            usdc = <USDCMock>await ethers.getContractAt('ERC20Mock', networkConfig[chainId].tokens.USDC!)
            await whileImpersonating(holderUSDC, async (usdcSigner) => {
                const decimals = await usdc.decimals()
                const p = (value: BigNumberish) => pow10(decimals).mul(value)
                await usdc.connect(usdcSigner).transfer(owner.address, p(initialBal))
            })
        })

        it('U2C can be deployed', async () => {
            const asset0 = dai
            const asset1 = usdc

            const decimals0 = await asset0.decimals()
            const decimals1 = await asset1.decimals()

            const p0 = (value: BigNumberish) => pow10(decimals0).mul(value)
            const p1 = (value: BigNumberish) => pow10(decimals1).mul(value)

            console.log(chainId, asset1.address, decimals1)
            const token1 = new Token(chainId, asset1.address, decimals1)
            const token0 = new Token(chainId, asset0.address, decimals0)

            const pair = new Pair(
                CurrencyAmount.fromRawAmount(token0, p0(100).toString()),
                CurrencyAmount.fromRawAmount(token1, p1(100).toString())
            )

        const DELAY_UNTIL_DEFAULT = bn('86400') // 24h
        const ORACLE_TIMEOUT = bn('281474976710655').div(2) // type(uint48).max / 2
        const RTOKEN_MAX_TRADE_VALUE = fp('1e6')

        const MockV3AggregatorFactory = await ethers.getContractFactory('MockV3Aggregator')
        const mockChainlinkFeed0 = <MockV3Aggregator>(
            await MockV3AggregatorFactory.connect(addr1).deploy(8, bn('1e8'))
        )
        const mockChainlinkFeed1 = <MockV3Aggregator>(
            await MockV3AggregatorFactory.connect(addr1).deploy(8, bn('1e8'))
        )

        const uniswapV2CollateralContractFactory: UniswapV2Collateral__factory = await ethers.getContractFactory(
            'UniswapV2Collateral'
        )

        const fallbackPrice = fp('1')
        const targetName = ethers.utils.formatBytes32String('USD')
        const uniswapV2Collateral: UniswapV2Collateral = <UniswapV2Collateral>(
            await uniswapV2CollateralContractFactory
                .connect(addr1)
                .deploy(
                    fallbackPrice,
                    mockChainlinkFeed0.address,
                    mockChainlinkFeed1.address,
                    Pair.getAddress(token0, token1),
                    RTOKEN_MAX_TRADE_VALUE,
                    ORACLE_TIMEOUT,
                    targetName,
                    DELAY_UNTIL_DEFAULT
                )
        )

        expect(await uniswapV2Collateral.isCollateral()).to.equal(true)
        expect(await uniswapV2Collateral.erc20()).to.equal(Pair.getAddress(token0, token1))
        expect(await uniswapV2Collateral.erc20Decimals()).to.equal(18)
        expect(await uniswapV2Collateral.targetName()).to.equal(ethers.utils.formatBytes32String('USD'))
        expect(await uniswapV2Collateral.status()).to.equal(CollateralStatus.SOUND)
        expect(await uniswapV2Collateral.whenDefault()).to.equal(MAX_UINT256)
        //expect(await uniswapV2Collateral.defaultThreshold()).to.equal(DEFAULT_THRESHOLD)
        expect(await uniswapV2Collateral.delayUntilDefault()).to.equal(DELAY_UNTIL_DEFAULT)
        expect(await uniswapV2Collateral.maxTradeVolume()).to.equal(RTOKEN_MAX_TRADE_VALUE)
        expect(await uniswapV2Collateral.oracleTimeout()).to.equal(ORACLE_TIMEOUT)
        expect(await uniswapV2Collateral.refPerTok()).to.equal(fp('1'))
        expect(await uniswapV2Collateral.targetPerRef()).to.equal(fp('1'))
        expect(await uniswapV2Collateral.pricePerTarget()).to.equal(fp('1'))
        //expect(await uniswapV2Collateral.strictPrice()).closeTo(fp('200').div(pair.getLiquidityValue())), 10)
        //expect(await uniswapV2Collateral.strictPrice()).to.equal(await uniswapV2Collateral._fallbackPrice())
        //TODO
        //expect(await uniswapV2Collateral.getClaimCalldata()).to.eql([ZERO_ADDRESS, '0x'])
        // expect(await uniswapV2Collateral.bal(addr1.address)).to.equal(
        //   await adjustedAmout(uniswapV2Wrapper, 100)
        // )
    })
})
})