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

            await loadFixture(defaultFixture)
    
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

        // Unsafe to use this test 
        // Contracts from fixtures would be broken
        it.skip(`Unsafe investigate virtual price`, async () => {
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
    })
})
