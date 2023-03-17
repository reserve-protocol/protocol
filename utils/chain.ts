import { HardhatRuntimeEnvironment } from 'hardhat/types';

export const resetFork = async (hre: HardhatRuntimeEnvironment, forkBlock: Number) => {
    await hre.network.provider.request({
        method: 'hardhat_reset',
        params: [
            {
                forking: {
                jsonRpcUrl: process.env.MAINNET_RPC_URL,
                blockNumber: forkBlock,
                },
            },
        ],
    })
}

