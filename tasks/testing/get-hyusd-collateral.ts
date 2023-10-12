
import { task } from 'hardhat/config'
import { bn, fp } from '#/common/numbers'
import { whileImpersonating } from '#/utils/impersonation'

task('get-hyusd', 'Mints hyUSD collateral to a target address')
    .addParam('address', 'Ethereum address to receive the tokens')
    .setAction(async (params, hre) => {
        const eoa = params.address

        // '0x465a5a630482f3abD6d3b84B39B29b07214d19e5', fusdc
        // '0x3BECE5EC596331033726E5C6C188c313Ff4E3fE5', stkcvxeusd
        // '0xaA91d24c2F7DBb6487f61869cD8cd8aFd5c5Cab2', morpho usdt
        // '0x83F20F44975D03b1b09e64809B757c47f942BEeA', sdai

        // Steal fUSDC
        const fusdc = await hre.ethers.getContractAt(
            'ERC20Mock',
            '0x465a5a630482f3abD6d3b84B39B29b07214d19e5'
        )
        const fusdcWhale = '0x43fC188f003e444e9e538189Fc675acDfB8f5d12'

        await whileImpersonating(hre, fusdcWhale, async (signer) => {
            await fusdc.connect(signer).transfer(eoa, bn('10000000e6'))
        })

        console.log('fusdc balance:', await fusdc.balanceOf(eoa))

        // Steal stkcvxeusd
        const eusdlp = await hre.ethers.getContractAt(
            'ERC20Mock',
            '0x8e074d44aaBC1b3b4406fE03Da7ceF787ea85938'
        )
        const eusdlpWhale = '0xB468dB2E478885B87D7ce0C8DA1D4373A756C138'

        await whileImpersonating(hre, eusdlpWhale, async (signer) => {
            await eusdlp.connect(signer).transfer(eoa, fp(1_000_000))
        })

        const eusdlpWrapper = await hre.ethers.getContractAt(
            'ConvexStakingWrapper',
            '0x3BECE5EC596331033726E5C6C188c313Ff4E3fE5'
        )

        await whileImpersonating(hre, eoa, async (signer) => {
            await eusdlp.connect(signer).approve(eusdlpWrapper.address, fp(1_000_000))
            await eusdlpWrapper.connect(signer).stake(fp(1_000_000), eoa)
        })

        console.log('eusdlpWrapper balance:', await eusdlpWrapper.balanceOf(eoa))

        // Steal Morpho USDT

        const usdt = await hre.ethers.getContractAt(
            'ERC20Mock',
            '0xdAC17F958D2ee523a2206206994597C13D831ec7'
        )
        const usdtWhale = '0xF977814e90dA44bFA03b6295A0616a897441aceC'

        await whileImpersonating(hre, usdtWhale, async (signer) => {
            await usdt.connect(signer).transfer(eoa, bn('10000000e6'))
        })

        const musdtWrapper = await hre.ethers.getContractAt(
            'MorphoAaveV2TokenisedDeposit',
            '0xaA91d24c2F7DBb6487f61869cD8cd8aFd5c5Cab2'
        )
        await whileImpersonating(hre, eoa, async (signer) => {
            await usdt.connect(signer).approve(musdtWrapper.address, bn('10000000e6'))
            await musdtWrapper.connect(signer).deposit(bn('10000000e6'), eoa)
        })

        console.log('musdtWrapper balance:', await musdtWrapper.balanceOf(eoa))

        // Steal sdai

        const sdai = await hre.ethers.getContractAt(
            'ERC20Mock',
            '0x83f20f44975d03b1b09e64809b757c47f942beea'
        )
        const sdaiWhale = '0x4C612E3B15b96Ff9A6faED838F8d07d479a8dD4c'

        await whileImpersonating(hre, sdaiWhale, async (signer) => {
            await sdai.connect(signer).transfer(eoa, bn('10000000e18'))
        })

        console.log('sdai balance:', await sdai.balanceOf(eoa))
    })
