import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { ERC20Mock } from '@typechain/ERC20Mock'
import { UniswapV3Wrapper } from '@typechain/UniswapV3Wrapper'
import { UniswapV3WrapperMock } from '@typechain/UniswapV3WrapperMock'
import { USDCMock } from '@typechain/USDCMock'
import { BigNumber, BigNumberish } from 'ethers'
import { ethers } from 'hardhat'
const { getContractAddress } = require('@ethersproject/address')
import { ITokens, networkConfig } from '../../../common/configuration'
import { ZERO_ADDRESS } from '../../../common/constants'
import { waitForTx } from '../utils'

/// @dev The minimum tick that may be passed to #getSqrtRatioAtTick computed from log base 1.0001 of 2**-128
export const MIN_TICK = -887272
/// @dev The maximum tick that may be passed to #getSqrtRatioAtTick computed from log base 1.0001 of 2**128
export const MAX_TICK = -MIN_TICK

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

export async function defaultMintParams(chainId: number): Promise<TMintParams> {
    const tokens: ITokens = networkConfig[chainId].tokens
    const daiAddress = tokens.DAI!
    const usdcAddress = tokens.USDC!
    const dai = <ERC20Mock>await ethers.getContractAt('ERC20Mock', daiAddress)
    const usdc = <USDCMock>await ethers.getContractAt('ERC20Mock', usdcAddress)

    return {
        token0: daiAddress,
        token1: usdcAddress,
        fee: 100,
        tickLower: MIN_TICK,
        tickUpper: MAX_TICK,
        amount0Desired: await adjustedAmount(dai, 100),
        amount1Desired: await adjustedAmount(usdc, 100),
        amount0Min: 0, //require(amount0 >= params.amount0Min && amount1 >= params.amount1Min, 'Price slippage check');
        amount1Min: 0,
        recipient: ZERO_ADDRESS,
        deadline: 0, //rewrite in constructor
    }
}

export async function deployUniswapV3WrapperMock(
    chainId: number,
    signer: SignerWithAddress,
    mintParams: TMintParams,
    liquiDityProvider: SignerWithAddress = signer
): Promise<UniswapV3WrapperMock> {
    const tokens: ITokens = networkConfig[chainId].tokens
    const daiAddress = tokens.DAI!
    const usdcAddress = tokens.USDC!
    const dai = <ERC20Mock>await ethers.getContractAt('ERC20Mock', daiAddress)
    const usdc = <USDCMock>await ethers.getContractAt('ERC20Mock', usdcAddress)

    const uniswapV3WrapperContractFactory = await ethers.getContractFactory('UniswapV3WrapperMock')
    const transactionCount = await signer.getTransactionCount()

    // just in case we want to deploy it with
    // the same address for deployer and liquidity provider
    const futureAddress = getContractAddress({
        from: signer.address,
        nonce: transactionCount + (liquiDityProvider == signer ? 2 : 0),
    })

    await waitForTx(await dai.connect(liquiDityProvider).approve(futureAddress, mintParams.amount0Desired))
    await waitForTx(await usdc.connect(liquiDityProvider).approve(futureAddress, mintParams.amount1Desired))

    const uniswapV3WrapperMock = await uniswapV3WrapperContractFactory
        .connect(signer)
        .deploy('UniswapV3WrapperToken', 'U3W', mintParams, liquiDityProvider.address)
    if (liquiDityProvider != signer) {
        await waitForTx(
            await uniswapV3WrapperMock
                .connect(signer)
                .transfer(liquiDityProvider.address, await uniswapV3WrapperMock.totalSupply())
        )
    }
    return uniswapV3WrapperMock
}

export async function adjustedAmount(
    asset: ERC20Mock | USDCMock | UniswapV3Wrapper,
    amount: BigNumberish
): Promise<BigNumber> {
    return BigNumber.from(10)
        .pow(await asset.decimals())
        .mul(amount)
}

export async function logBalances(
    prefix: string,
    accounts: SignerWithAddress[],
    assets: (ERC20Mock | USDCMock | UniswapV3Wrapper)[]
) {
    console.log(prefix)
    const table = []
    for (const account of accounts) {
        for (const asset of assets) {
            const address = account.address
            table.push({
                address: address.substring(0, 6),
                asset: await asset.name(),
                balance: (await asset.balanceOf(address)).toString(),
            })
        }
    }
    console.table(table)
}
