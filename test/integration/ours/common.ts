import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { ERC20Mock } from "@typechain/ERC20Mock"
import { UniswapV3Wrapper } from "@typechain/UniswapV3Wrapper"
import { UniswapV3WrapperMock } from "@typechain/UniswapV3WrapperMock"
import { USDCMock } from "@typechain/USDCMock"
import { BigNumber, BigNumberish } from "ethers"
import hre, { ethers } from "hardhat"
import { getContractAddress } from "@ethersproject/address"
import { ZERO_ADDRESS } from "../../../common/constants"
import { waitForTx } from "../utils"
import { whileImpersonating } from "../../utils/impersonation"
import { IUniswapV2Pair } from "@typechain/IUniswapV2Pair"

/// @dev The minimum tick that may be passed to #getSqrtRatioAtTick computed from log base 1.0001 of 2**-128
export const MIN_TICK = -887272
/// @dev The maximum tick that may be passed to #getSqrtRatioAtTick computed from log base 1.0001 of 2**128
export const MAX_TICK = -MIN_TICK

// Relevant addresses (Mainnet)
export const holderDAI = "0x16b34ce9a6a6f7fc2dd25ba59bf7308e7b38e186"
export const holderUSDT = "0xf977814e90da44bfa03b6295a0616a897441acec"
export const holderUSDC = "0x0a59649758aa4d66e25f08dd01271e891fe52199"

export type TMintParams = {
    token0: string
    token1: string
    fee: BigNumberish
    tickLower: BigNumberish
    tickUpper: BigNumberish
    amount0Desired: BigNumberish
    amount1Desired: BigNumberish
    amount0Min: BigNumberish
    amount1Min: BigNumberish
    recipient: string
    deadline: BigNumberish
}

export async function defaultMintParams(
    asset0: ERC20Mock | USDCMock,
    asset1: ERC20Mock | USDCMock,
    amount0: BigNumberish,
    amount1: BigNumberish
): Promise<TMintParams> {
    return {
        token0: asset0.address,
        token1: asset1.address,
        fee: 100,
        tickLower: MIN_TICK,
        tickUpper: MAX_TICK,
        amount0Desired: amount0,
        amount1Desired: amount1,
        amount0Min: 0, // TODO require(amount0 >= params.amount0Min && amount1 >= params.amount1Min, 'Price slippage check');
        amount1Min: 0,
        recipient: ZERO_ADDRESS,
        deadline: 0, //rewrite in constructor
    }
}

export async function deployUniswapV3WrapperMock(
    asset0: ERC20Mock | USDCMock,
    asset1: ERC20Mock | USDCMock,
    signer: SignerWithAddress,
    mintParams: TMintParams,
    liquiDityProvider: SignerWithAddress = signer
): Promise<UniswapV3WrapperMock> {
    const uniswapV3WrapperContractFactory = await ethers.getContractFactory("UniswapV3WrapperMock")
    const transactionCount = await signer.getTransactionCount()

    // just in case we want to deploy it with
    // the same address for deployer and liquidity provider
    const futureAddress = getContractAddress({
        from: signer.address,
        nonce: transactionCount + (liquiDityProvider == signer ? 2 : 0),
    })

    await waitForTx(
        await asset0.connect(liquiDityProvider).approve(futureAddress, mintParams.amount0Desired)
    )
    await waitForTx(
        await asset1.connect(liquiDityProvider).approve(futureAddress, mintParams.amount1Desired)
    )

    const uniswapV3WrapperMock = await uniswapV3WrapperContractFactory
        .connect(signer)
        .deploy("UniswapV3WrapperToken", "U3W", mintParams, liquiDityProvider.address)
    if (liquiDityProvider != signer) {
        await waitForTx(
            await uniswapV3WrapperMock
                .connect(signer)
                .transfer(liquiDityProvider.address, await uniswapV3WrapperMock.totalSupply())
        )
    }
    return uniswapV3WrapperMock
}

export async function deployUniswapV3Wrapper(
    asset0: ERC20Mock | USDCMock,
    asset1: ERC20Mock | USDCMock,
    signer: SignerWithAddress,
    mintParams: TMintParams,
    liquiDityProvider: SignerWithAddress = signer
): Promise<UniswapV3Wrapper> {
    const uniswapV3WrapperContractFactory = await ethers.getContractFactory("UniswapV3Wrapper")
    const transactionCount = await signer.getTransactionCount()

    // just in case we want to deploy it with
    // the same address for deployer and liquidity provider
    const futureAddress = getContractAddress({
        from: signer.address,
        nonce: transactionCount + (liquiDityProvider == signer ? 2 : 0),
    })

    await waitForTx(
        await asset0.connect(liquiDityProvider).approve(futureAddress, await asset0.totalSupply())
    )
    await waitForTx(
        await asset1.connect(liquiDityProvider).approve(futureAddress, await asset1.totalSupply())
    )

    const uniswapV3Wrapper = await uniswapV3WrapperContractFactory
        .connect(signer)
        .deploy("UniswapV3WrapperToken", "U3W", mintParams, liquiDityProvider.address)
    if (liquiDityProvider != signer) {
        await waitForTx(
            await uniswapV3Wrapper
                .connect(signer)
                .transfer(liquiDityProvider.address, await uniswapV3Wrapper.totalSupply())
        )
    }
    return uniswapV3Wrapper
}

export async function logBalancesAddr(
    prefix: string,
    adresses: string[],
    assets: (ERC20Mock | USDCMock | UniswapV3Wrapper | IUniswapV2Pair)[]
) {
    console.log(prefix)
    const table = []
    for (const address of adresses) {
        for (const asset of assets) {
            table.push({
                address: address.substring(0, 6),
                asset: await asset.name(),
                balance: (await asset.balanceOf(address)).toString(),
            })
        }
    }
    console.table(table)
}

export async function logBalances(
    prefix: string,
    accounts: { address: string }[],
    assets: (ERC20Mock | USDCMock | UniswapV3Wrapper | IUniswapV2Pair)[]
) {
    return logBalancesAddr(
        prefix,
        accounts.map((account) => account.address),
        assets
    )
}

const ONE = ethers.BigNumber.from(1)
const TWO = ethers.BigNumber.from(2)

export function sqrt(x: BigNumber): BigNumber {
    let z = x.add(ONE).div(TWO)
    let y = x
    while (z.sub(y).isNegative()) {
        y = z
        z = x.div(z).add(z).div(TWO)
    }
    return y
}

export async function closeDeadline(): Promise<number> {
    return (await hre.ethers.provider.getBlock("latest")).timestamp + 600
}

export function p999(x: BigNumber): BigNumber {
    return x.mul(999).div(1000)
}

// https://github.com/Uniswap/v3-periphery/blob/685ca7f164c56fa4eb7620918a9d266714cdf103/test/shared/tokenSort.ts
export function compareToken(a: { address: string }, b: { address: string }): -1 | 1 {
    return a.address.toLowerCase() < b.address.toLowerCase() ? -1 : 1
}

export function sortedTokens(
    a: ERC20Mock | USDCMock,
    b: ERC20Mock | USDCMock
): [ERC20Mock | USDCMock, ERC20Mock | USDCMock] {
    return compareToken(a, b) < 0 ? [a, b] : [b, a]
}

export async function sendTokenAs(
    token: ERC20Mock,
    senderAddr: string,
    recipient: SignerWithAddress,
    amount: BigNumber
) {
    await whileImpersonating(senderAddr, async (sender) => {
        await token.connect(sender).transfer(recipient.address, amount)
    })
}

// https://github.com/Uniswap/v3-periphery/blob/878a58a461ae30680acd84d44499058826bf5f3e/test/shared/path.ts
export enum FeeAmount {
    LOW = 500,
    MEDIUM = 3000,
    HIGH = 10000,
}
const FEE_SIZE = 3
export function encodePath(path: string[], fees: FeeAmount[]): string {
    if (path.length != fees.length + 1) {
        throw new Error("path/fee lengths do not match")
    }

    let encoded = "0x"
    for (let i = 0; i < fees.length; i++) {
        // 20 byte encoding of the address
        encoded += path[i].slice(2)
        // 3 byte encoding of the fee
        encoded += fees[i].toString(16).padStart(2 * FEE_SIZE, "0")
    }
    // encode the final token
    encoded += path[path.length - 1].slice(2)

    return encoded.toLowerCase()
}
